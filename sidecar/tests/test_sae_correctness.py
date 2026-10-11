"""T5: the SAE reads the hook it was trained on, at the layer it was trained for.

Run with ``pytest -m inference``. Pythia tests skip if pythia-70m-deduped is
not in the local HF cache.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.inference


def _spy(monkeypatch, model):
    """Record names_filter passed to run_with_cache and names passed to add_hook."""
    seen: dict[str, list] = {"filters": [], "hooks": []}
    orig_rwc = model.run_with_cache
    orig_add = model.add_hook

    def rwc(*args, **kwargs):
        seen["filters"].append(kwargs.get("names_filter"))
        return orig_rwc(*args, **kwargs)

    def add_hook(name, *args, **kwargs):
        seen["hooks"].append(name)
        return orig_add(name, *args, **kwargs)

    monkeypatch.setattr(model, "run_with_cache", rwc)
    monkeypatch.setattr(model, "add_hook", add_hook)
    return seen


@pytest.mark.parametrize("fixture_name", ["gpt2_loaded", "pythia_loaded"])
def test_sae_hook_matches_manifest(fixture_name, request, monkeypatch, no_neuronpedia):
    from pry_sidecar.inference import (
        run_ablate_features,
        run_generate,
        run_sae_features,
        run_steer,
        sae_hook_name,
    )
    from pry_sidecar.presets import PRESETS
    from pry_sidecar.registry import REGISTRY
    from pry_sidecar.schemas import (
        AblateFeatureRequest,
        GenerateRequest,
        SAEFeaturesRequest,
        SteerRequest,
    )

    loaded = request.getfixturevalue(fixture_name)
    preset_id = "gpt2-small" if fixture_name == "gpt2_loaded" else "pythia-70m"
    manifest = PRESETS[preset_id]
    layer = loaded.sae_layer
    expected = f"blocks.{layer}.{manifest.sae.hook}"
    wrong = "hook_resid_post" if manifest.sae.hook == "hook_resid_pre" else "hook_resid_pre"
    assert sae_hook_name(manifest, layer) == expected

    seen = _spy(monkeypatch, loaded.model)
    prompt = "The cat sat on the"

    run_generate(GenerateRequest(preset_id=preset_id, prompt=prompt), loaded)
    run_sae_features(
        SAEFeaturesRequest(preset_id=preset_id, prompt=prompt, sae_layer=layer), REGISTRY, manifest
    )
    assert len(seen["filters"]) == 2
    for f in seen["filters"]:
        assert f(expected)
        assert not f(f"blocks.{layer}.{wrong}")

    run_steer(
        SteerRequest(preset_id=preset_id, prompt=prompt, feature_id=0, sae_layer=layer, max_new_tokens=1),
        loaded,
    )
    run_ablate_features(
        AblateFeatureRequest(
            preset_id=preset_id, prompt=prompt, feature_ablations=[{"feature_index": 0, "layer": layer}]
        ),
        loaded,
    )
    assert seen["hooks"] == [expected, expected]


def test_pythia_sae_reconstruction(pythia_loaded):
    """The Pythia SAE reconstructs resid_post far better than resid_pre at its layer,
    i.e. hook_resid_post is the hook it was trained on."""
    import torch

    model, sae = pythia_loaded.model, pythia_loaded.sae
    layer = 3
    assert pythia_loaded.sae_layer == layer

    prompts = [
        "The quick brown fox jumps over the lazy dog.",
        "In 1492, Columbus sailed across the Atlantic Ocean.",
        "def add(a, b):\n    return a + b",
    ]
    post, pre = f"blocks.{layer}.hook_resid_post", f"blocks.{layer}.hook_resid_pre"

    def mse(x):
        x = x.to(device=sae.device, dtype=sae.dtype)
        return torch.mean((sae.decode(sae.encode(x)) - x) ** 2).item()

    post_mse, pre_mse = 0.0, 0.0
    with torch.no_grad():
        for p in prompts:
            # Skip BOS (an outlier position); the gap is ~250x either way.
            _, cache = model.run_with_cache(model.to_tokens(p), names_filter=lambda n: n in (post, pre))
            post_mse += mse(cache[post][0, 1:])
            pre_mse += mse(cache[pre][0, 1:])

    assert post_mse < 0.5 * pre_mse, (post_mse, pre_mse)


def test_pythia_layer_catalog():
    from pry_sidecar.presets import PRESETS

    assert PRESETS["pythia-70m"].available_sae_layers == list(range(6))


# ---------------------------------------------------------------------------
# HTTP validation (400s, not 500s)
# ---------------------------------------------------------------------------


def test_ablate_feature_layer_mismatch_400(gpt2_client, gpt2_loaded):
    other = (gpt2_loaded.sae_layer + 1) % 12
    r = gpt2_client.post(
        "/ablate-feature",
        json={
            "preset_id": "gpt2-small",
            "prompt": "Hello world",
            "feature_ablations": [{"feature_index": 10, "layer": other}],
        },
    )
    assert r.status_code == 400, r.text
    msg = r.json()["error"]
    assert f"layer {other}" in msg and f"layer {gpt2_loaded.sae_layer}" in msg


def test_ablate_feature_matching_layer_ok(gpt2_client, gpt2_loaded):
    r = gpt2_client.post(
        "/ablate-feature",
        json={
            "preset_id": "gpt2-small",
            "prompt": "Hello world",
            "feature_ablations": [{"feature_index": 10, "layer": gpt2_loaded.sae_layer}],
        },
    )
    assert r.status_code == 200, r.text


def test_steer_layer_mismatch_400(gpt2_client, gpt2_loaded):
    other = (gpt2_loaded.sae_layer + 1) % 12
    r = gpt2_client.post(
        "/steer",
        json={"preset_id": "gpt2-small", "prompt": "Hello", "feature_id": 10, "sae_layer": other, "max_new_tokens": 1},
    )
    assert r.status_code == 400, r.text
    assert "Re-run after switching layers" in r.json()["error"]


def test_generate_layer_mismatch_400(gpt2_client, gpt2_loaded):
    other = (gpt2_loaded.sae_layer + 1) % 12
    r = gpt2_client.post("/generate", json={"preset_id": "gpt2-small", "prompt": "Hi", "sae_layer": other})
    assert r.status_code == 400, r.text


def test_out_of_range_feature_400(gpt2_client, gpt2_loaded):
    d_sae = int(gpt2_loaded.sae.cfg.d_sae)
    layer = gpt2_loaded.sae_layer

    r = gpt2_client.post(
        "/steer",
        json={"preset_id": "gpt2-small", "prompt": "Hello", "feature_id": d_sae, "sae_layer": layer, "max_new_tokens": 1},
    )
    assert r.status_code == 400, r.text
    assert "out of range" in r.json()["error"]

    r = gpt2_client.post(
        "/ablate-feature",
        json={
            "preset_id": "gpt2-small",
            "prompt": "Hello",
            "feature_ablations": [{"feature_index": d_sae, "layer": layer}],
        },
    )
    assert r.status_code == 400, r.text


@pytest.mark.parametrize("target", [{"layer": 12, "head": 0}, {"layer": 0, "head": 12}])
def test_out_of_range_head_400(gpt2_client, target):
    r = gpt2_client.post(
        "/ablate-head", json={"preset_id": "gpt2-small", "prompt": "Hello", "ablations": [target]}
    )
    assert r.status_code == 400, r.text
    assert "out of range" in r.json()["error"]
