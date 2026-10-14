"""MF-4: steering measures. Changed tokens, coherence (mean log-prob per token of
each continuation under the unsteered model), the scale readout and the
norm-matched control feature. Plus the coherence-band calibration run."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

PROMPT = "The capital of France is"


def _steer(client, **kw):
    body = {"preset_id": "gpt2-small", "prompt": PROMPT, "feature_id": 100,
            "sae_layer": 8, "alpha": 30.0, "max_new_tokens": 12}
    body.update(kw)
    r = client.post("/steer", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _manual_logprobs(model, prompt_tokens, cont_ids):
    """Log-probability of every token after the first, prompt included."""
    import torch

    full = torch.cat([prompt_tokens, torch.tensor([cont_ids], device=prompt_tokens.device)], dim=1)
    with torch.no_grad():
        logp = torch.log_softmax(model(full)[0].float(), dim=-1)
    return [float(logp[i, full[0, i + 1]]) for i in range(full.shape[1] - 1)]


@pytest.mark.inference
def test_coherence_excludes_prompt_tokens(gpt2_client, gpt2_loaded):
    body = _steer(gpt2_client)
    model = gpt2_loaded.model
    toks = model.to_tokens(PROMPT)
    out = model.generate(toks, max_new_tokens=12, temperature=0.0, verbose=False)
    cont = out[0, toks.shape[1]:].tolist()
    assert model.to_string(cont) == body["original_generation"]

    lp = _manual_logprobs(model, toks, cont)
    n_prompt = toks.shape[1]
    cont_only = sum(lp[n_prompt - 1:]) / len(cont)
    with_prompt = sum(lp) / len(lp)
    assert body["coherence"]["original"] == pytest.approx(cont_only, abs=1e-4)
    assert abs(with_prompt - cont_only) > 1e-3

    # The steered text is scored by the same, unsteered model.
    steered = model.to_tokens(body["steered_generation"], prepend_bos=False)[0].tolist()
    lp_s = _manual_logprobs(model, toks, steered)
    assert body["coherence"]["steered"] == pytest.approx(sum(lp_s[n_prompt - 1:]) / len(steered), abs=1e-3)


@pytest.mark.inference
def test_coherence_null_under_5_tokens(gpt2_client):
    body = _steer(gpt2_client, max_new_tokens=4)
    assert body["coherence"] == {"original": None, "steered": None}
    body = _steer(gpt2_client, max_new_tokens=5)
    assert isinstance(body["coherence"]["original"], float)


def test_continuation_logprob_null_under_5_tokens():
    import torch

    from pry_sidecar.inference import COHERENCE_MIN_TOKENS, continuation_logprob

    assert COHERENCE_MIN_TOKENS == 5
    assert continuation_logprob(None, torch.tensor([[0, 1]]), [1, 2, 3, 4]) is None


def test_changed_token_indices():
    from pry_sidecar.inference import changed_token_indices

    assert changed_token_indices([1, 2, 3], [1, 2, 3]) == []
    assert changed_token_indices([1, 2, 3], [1, 9, 3, 4]) == [1, 3]
    assert changed_token_indices([1, 2, 3, 4], [1, 2]) == []


def test_control_is_norm_matched_then_lowest_cos_seeded_by_feature_id():
    import torch

    from pry_sidecar.inference import CONTROL_SAMPLE, control_candidates, pick_control_feature

    g = torch.Generator().manual_seed(0)
    d_sae, d_model, fid = 2000, 16, 123
    W = torch.randn(d_sae, d_model, generator=g)
    # Spread the norms so the ±20% band keeps only some candidates.
    W = W / W.norm(dim=-1, keepdim=True) * torch.linspace(0.2, 3.0, d_sae).unsqueeze(1)

    ids = control_candidates(d_sae, fid)
    assert len(ids) == CONTROL_SAMPLE == 256 and fid not in ids and len(set(ids)) == 256
    assert control_candidates(d_sae, fid) == ids  # seeded by feature_id
    assert control_candidates(d_sae, fid + 1) != ids

    cid, method = pick_control_feature(W, fid)
    assert method == "norm_matched_lowest_cos" and cid in ids
    t = W[fid]
    in_band = [i for i in ids if abs(W[i].norm() - t.norm()) <= 0.2 * t.norm()]
    assert cid in in_band and len(in_band) < len(ids)
    cos = {i: abs(float(W[i] @ t / (W[i].norm() * t.norm()))) for i in in_band}
    assert cos[cid] == min(cos.values())
    assert pick_control_feature(W, fid) == (cid, method)


def test_control_fallback_nearest_norm():
    import torch

    from pry_sidecar.inference import control_candidates, pick_control_feature

    g = torch.Generator().manual_seed(1)
    W = torch.randn(1000, 8, generator=g)
    W = W / W.norm(dim=-1, keepdim=True) * torch.linspace(1.0, 2.0, 1000).unsqueeze(1)
    fid = 7
    W[fid] = W[fid] / W[fid].norm() * 10.0  # far outside everyone's ±20%

    cid, method = pick_control_feature(W, fid)
    assert method == "nearest_norm"
    ids = control_candidates(1000, fid)
    norms = {i: float(W[i].norm()) for i in ids}
    assert cid == max(norms, key=norms.get)  # nearest to 10 = the largest


@pytest.mark.inference
def test_scale_reports_activation_percentiles(gpt2_client, gpt2_loaded):
    import torch

    model, sae = gpt2_loaded.model, gpt2_loaded.sae
    hook = f"blocks.{gpt2_loaded.sae_layer}.hook_resid_pre"
    with torch.no_grad():
        _, cache = model.run_with_cache(model.to_tokens(PROMPT), names_filter=lambda n: n == hook)
        acts = sae.encode(cache[hook][0].to(sae.device))[1:].float()  # BOS excluded
    fid = int(acts.max(dim=0).values.argmax())  # a feature that fires on this prompt
    col = acts[:, fid]

    body = _steer(gpt2_client, feature_id=fid, alpha=-7.5, max_new_tokens=5)
    s = body["scale"]
    assert s["strength"] == -7.5
    assert s["activation_max"] == pytest.approx(float(col.max()), rel=1e-4) and s["activation_max"] > 0
    assert s["activation_p50"] == pytest.approx(float(torch.quantile(col, 0.5)), rel=1e-4, abs=1e-6)
    assert s["activation_p99"] == pytest.approx(float(torch.quantile(col, 0.99)), rel=1e-4, abs=1e-6)
    assert s["activation_p50"] <= s["activation_p99"] <= s["activation_max"]
    # MF-5 echo
    assert body["feature_id"] == fid and body["sae_layer"] == 8 and body["alpha"] == -7.5


def _all_keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _all_keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _all_keys(v)


@pytest.mark.inference
def test_no_changed_word_count_field(gpt2_client):
    body = _steer(gpt2_client, control=True)
    keys = set(_all_keys(body))
    assert not [k for k in keys if "word" in k.lower() or "count" in k.lower()], keys
    # What changed is reported as token positions, never as a count.
    assert isinstance(body["changed_token_indices"], list)
    c = body["control"]
    assert c["method"] in ("norm_matched_lowest_cos", "nearest_norm")
    assert c["feature_id"] != body["feature_id"]
    assert abs(c["decoder_norm"] - c["steered_decoder_norm"]) <= 0.2 * c["steered_decoder_norm"]
    assert c["coherence"]["original"] == body["coherence"]["original"]
    for key in ("generation", "changed_token_indices", "top_predictions", "top_changed"):
        assert key in c


# ---------------------------------------------------------------------------
# Coherence band calibration (plan T4-py)
# ---------------------------------------------------------------------------

# Read by eye from the steered texts on GPT-2 small, layer-8 SAE, 30 new
# tokens, greedy, CPU (2026-10-13). "fine": the text reads normally (one is
# unchanged; two change topic and stay fluent). "broken": the text falls
# into a loop.
CALIBRATION = [
    ("fine", "I went to the store and", 100, 2.0),
    ("fine", "The weather today is", 14207, 30.0),
    ("fine", "The weather today is", 16921, 30.0),
    ("broken", "I went to the store and", 5000, -30.0),
    ("broken", "The weather today is", 10742, -30.0),
    ("broken", "The weather today is", 2298, 30.0),
]

# The planned bands on Δ = steered − original (nats per token).
BANDS = [(-0.5, "Reads about as naturally as before."), (-1.5, "Reads less naturally."),
         (float("-inf"), "Reads much less naturally; the push may be breaking the text.")]

# Pinned outcome of the calibration. False: the bands do not separate the
# fine steerings from the broken ones (looping text scores as MORE natural),
# so the bands don't ship and the fallback wording does. If a re-run flips
# this, the decision has to be revisited.
BANDS_SEPARATE = False


def _band(delta: float) -> str:
    return next(label for lo, label in BANDS if delta >= lo)


def _evidence_dir() -> Path:
    env = os.environ.get("PRY_EVIDENCE_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / ".omc" / "evidence" / "pry-learning-2026-10-12"


@pytest.mark.inference
def test_coherence_bands_calibration(gpt2_loaded):
    from pry_sidecar.inference import run_steer
    from pry_sidecar.schemas import SteerRequest

    rows = []
    for group, prompt, fid, alpha in CALIBRATION:
        r = run_steer(
            SteerRequest(preset_id="gpt2-small", prompt=prompt, feature_id=fid,
                         sae_layer=8, alpha=alpha, max_new_tokens=30),
            gpt2_loaded,
        )
        co, cs = r.coherence.original, r.coherence.steered
        assert co is not None and cs is not None
        rows.append((group, prompt, fid, alpha, co, cs, cs - co, r.steered_generation))

    fine = [d for g, *_, d, _ in rows if g == "fine"]
    broken = [d for g, *_, d, _ in rows if g == "broken"]
    separates = all(d >= -0.5 for d in fine) and all(d < -0.5 for d in broken)

    lines = [
        "# Coherence band calibration (T4-py, MF-4)",
        "",
        "Written by `sidecar/tests/test_steer_measures.py::test_coherence_bands_calibration`.",
        f"GPT-2 small, layer-8 SAE (gpt2-small-res-jb), 30 new tokens, greedy, device "
        f"`{gpt2_loaded.device}`. Coherence = mean log-probability per continuation token "
        "(nats) under the unsteered model, prompt excluded. Δ = steered − original.",
        "",
        "| group | prompt | feature | strength | original | steered | Δ | band | steered text |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for group, prompt, fid, alpha, co, cs, d, text in rows:
        shown = text.replace("\n", "⏎").replace("|", "\\|")
        lines.append(
            f"| {group} | {prompt} | {fid} | {alpha:+g} | {co:.3f} | {cs:.3f} | {d:+.3f} "
            f"| {_band(d)} | {shown} |"
        )
    lines += [
        "",
        f"Fine Δ: {', '.join(f'{d:+.3f}' for d in fine)}. "
        f"Broken Δ: {', '.join(f'{d:+.3f}' for d in broken)}.",
        "",
        f"**Bands separate the groups: {'yes' if separates else 'no'}.** "
        + ("" if separates else
           "Every broken (looping) steering scores Δ > 0: repetition reads as very natural to "
           "the unsteered model. One fluent topic change lands in \"Reads less naturally.\" "
           "The bands don't ship; the fallback wording does."),
        "",
    ]
    out = _evidence_dir()
    out.mkdir(parents=True, exist_ok=True)
    (out / "coherence-calibration.md").write_text("\n".join(lines), encoding="utf-8")

    assert separates is BANDS_SEPARATE
