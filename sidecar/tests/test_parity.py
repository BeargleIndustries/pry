"""T12: numerical parity of SAE features and logits against a torch 2.5.1 baseline.

The fixtures ``fixtures/parity_<device>.json`` were recorded under torch
2.5.1 (TL 2.15.4, sae-lens 5.11.0) with this module's ``capture()``, which
goes through the sidecar's own ``REGISTRY.load`` and ``run_generate``. The
test re-captures in the current environment and compares, so a torch (or
TL/sae-lens) upgrade that changes model or SAE numerics fails here.

Per preset and prompt it checks:
  - the top-10 SAE features (ranked by max activation over the prompt) are
    the same set as the baseline;
  - those features' per-token activations are within tolerance;
  - the final-position top-10 logits (token ids and values) match;
  - ``run_generate``'s next-token predictions are the same tokens.

Tolerances (the T12 gate, same on both devices): activations rtol=1e-3 /
atol=1e-4, logits atol=1e-3. Measured drift (experiments/2026-10-11-torch27):
torch 2.5.1 -> 2.7.1 is bit-identical on CPU and on CUDA (cu124 -> cu128,
RTX 4070 SUPER). The largest drift seen anywhere is CPU vs CUDA at 2.5.1:
activations 5e-5 relative, logits 8e-4 absolute (pythia-70m), so CUDA could
need a looser bound on another GPU/driver if cuBLAS picks different kernels.
A wrong model, hook or SAE load moves values by O(1) and fails either way.

Record a fixture (from the repo root, with PRY_PRESETS_PATH=sidecar/presets.json
and pry_sidecar importable):

    python sidecar/tests/test_parity.py --record   # writes parity_<device>.json

Run with ``pytest -m inference tests/test_parity.py``. Skips when the fixture
for the current device or a model's weights are not available locally.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.inference

FIXTURES = Path(__file__).resolve().parent / "fixtures"

PRESETS_UNDER_TEST = {"gpt2-small": "gpt2", "pythia-70m": "EleutherAI/pythia-70m-deduped"}

PROMPTS = [
    "The capital of France is",
    "When Mary and John went to the store, John gave a drink to",
    "def fibonacci(n):\n    return",
    "The quick brown fox jumps over the lazy",
]

TOP_K = 10

TOLERANCES = {
    "cpu": {"act_rtol": 1e-3, "act_atol": 1e-4, "logit_atol": 1e-3},
    "cuda": {"act_rtol": 1e-3, "act_atol": 1e-4, "logit_atol": 1e-3},
}


def _stub_neuronpedia() -> None:
    from pry_sidecar import inference

    inference.fetch_feature_description = lambda *a, **k: (None, "none")
    inference.fetch_top_activating_snippets = lambda *a, **k: ()


def capture(preset_id: str, loaded) -> list[dict]:
    """Per prompt: top-10 SAE features + per-token activations, top-10 logits."""
    import torch

    from pry_sidecar.inference import run_generate, sae_hook_name
    from pry_sidecar.presets import PRESETS
    from pry_sidecar.schemas import GenerateRequest

    model, sae = loaded.model, loaded.sae
    hook = sae_hook_name(PRESETS[preset_id], loaded.sae_layer)
    out = []
    for prompt in PROMPTS:
        tokens = model.to_tokens(prompt)
        with torch.no_grad():
            logits, cache = model.run_with_cache(tokens, names_filter=lambda n: n == hook)
            resid = cache[hook][0]
            resid = resid.to(device=sae.device, dtype=getattr(sae, "dtype", resid.dtype))
            acts = sae.encode(resid).float().cpu()  # [seq, d_sae]
        max_acts = acts.max(dim=0).values
        top = torch.topk(max_acts, TOP_K + 1)
        ids = top.indices[:TOP_K].tolist()
        final = logits[0, -1].float().cpu()
        lt = torch.topk(final, TOP_K + 1)

        resp = run_generate(
            GenerateRequest(preset_id=preset_id, prompt=prompt, top_k_features=TOP_K), loaded
        )
        out.append(
            {
                "prompt": prompt,
                "tokens": [str(t) for t in model.to_str_tokens(prompt)],
                "feature_ids": ids,
                # [seq][TOP_K], same order as feature_ids
                "feature_acts": acts[:, ids].tolist(),
                # gap between the 10th and 11th feature (tie risk for the set check)
                "feature_margin": float(top.values[TOP_K - 1] - top.values[TOP_K]),
                "logit_ids": lt.indices[:TOP_K].tolist(),
                "logit_values": lt.values[:TOP_K].tolist(),
                "logit_margin": float(lt.values[TOP_K - 1] - lt.values[TOP_K]),
                "predictions": [p.token for p in resp.top_predictions],
                "per_token_top1": [f.top_k[0].id if f.top_k else None for f in resp.sae_features],
            }
        )
    return out


def _env() -> dict:
    from importlib.metadata import version

    import sae_lens
    import torch
    import transformer_lens  # noqa: F401

    return {
        "torch": torch.__version__,
        "transformer_lens": version("transformer-lens"),
        "sae_lens": sae_lens.__version__,
        "device_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
    }


def _load_fixture(device: str) -> dict:
    path = FIXTURES / f"parity_{device}.json"
    if not path.is_file():
        pytest.skip(f"no parity fixture for device {device!r} ({path.name})")
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("preset_id", list(PRESETS_UNDER_TEST))
def test_parity_against_torch251_baseline(preset_id, request, no_neuronpedia):
    import torch

    loaded = request.getfixturevalue(
        "gpt2_loaded" if preset_id == "gpt2-small" else "pythia_loaded"
    )
    device = "cuda" if str(loaded.device).startswith("cuda") else "cpu"
    fixture = _load_fixture(device)
    base_prompts = fixture["presets"][preset_id]
    tol = TOLERANCES[device]

    current = capture(preset_id, loaded)
    assert [c["prompt"] for c in current] == [b["prompt"] for b in base_prompts]
    for base, cur in zip(base_prompts, current):
        where = f"{preset_id} / {base['prompt']!r}"
        assert cur["tokens"] == base["tokens"], where
        assert set(cur["feature_ids"]) == set(base["feature_ids"]), (
            f"{where}: top-10 SAE features differ "
            f"(baseline 10th/11th margin {base['feature_margin']:.4g})"
        )
        # Compare in baseline order so a reordering within the set is not a failure.
        order = [cur["feature_ids"].index(fid) for fid in base["feature_ids"]]
        cur_acts = torch.tensor(cur["feature_acts"])[:, order]
        torch.testing.assert_close(
            cur_acts,
            torch.tensor(base["feature_acts"]),
            rtol=tol["act_rtol"],
            atol=tol["act_atol"],
            msg=lambda m: f"{where}: SAE activations\n{m}",
        )
        assert set(cur["logit_ids"]) == set(base["logit_ids"]), f"{where}: top-10 logits differ"
        cur_logits = dict(zip(cur["logit_ids"], cur["logit_values"]))
        torch.testing.assert_close(
            torch.tensor([cur_logits[i] for i in base["logit_ids"]]),
            torch.tensor(base["logit_values"]),
            rtol=0,
            atol=tol["logit_atol"],
            msg=lambda m: f"{where}: final-position logits\n{m}",
        )
        assert cur["predictions"] == base["predictions"], f"{where}: run_generate predictions"


def _record() -> int:
    """Record parity_<device>.json for the current environment."""
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    os.environ.setdefault(
        "PRY_PRESETS_PATH", str(Path(__file__).resolve().parent.parent / "presets.json")
    )
    import torch

    from pry_sidecar.presets import PRESETS
    from pry_sidecar.registry import REGISTRY

    torch.manual_seed(1234)
    _stub_neuronpedia()
    presets = {}
    device = "cpu"
    for preset_id in PRESETS_UNDER_TEST:
        loaded = REGISTRY.load(preset_id, PRESETS[preset_id])
        device = "cuda" if str(loaded.device).startswith("cuda") else "cpu"
        presets[preset_id] = capture(preset_id, loaded)
    doc = {"recorded_with": _env(), "device": device, "presets": presets}
    FIXTURES.mkdir(exist_ok=True)
    path = FIXTURES / f"parity_{device}.json"
    path.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    if sys.argv[1:] != ["--record"]:
        raise SystemExit("usage: python test_parity.py --record")
    sys.exit(_record())
