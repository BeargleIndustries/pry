"""T23: "direct value path" circuit edges.

The key test builds a tiny 2-layer attention-only HookedTransformer by hand,
so the right answer is known in advance: three layer-0 heads each write one
fixed direction, and one layer-1 head T reads a single direction into its
value path and writes onto the predicted token's unembedding.
"""

from __future__ import annotations

import pytest
import torch

from pry_sidecar.inference import direct_value_path_edges

D_MODEL = 8
PRED = 0  # token whose unembedding is the logit direction u
# Residual dims: 0 = constant 1 (every embedding), 1 = T's value input,
# 2 = u (T's output / predicted-token unembedding), 3 = orthogonal to T's OV
# input, 4..7 = free dims that only feed T's queries/keys.
CONST, V_IN, U_DIR, ORTH = 0, 1, 2, 3


def _hand_built_model():
    from transformer_lens import HookedTransformer, HookedTransformerConfig

    cfg = HookedTransformerConfig(
        n_layers=2,
        d_model=D_MODEL,
        n_ctx=8,
        d_head=2,
        n_heads=3,
        d_vocab=6,
        attn_only=True,
        normalization_type=None,
        act_fn="relu",
        seed=0,
    )
    model = HookedTransformer(cfg)
    g = torch.Generator().manual_seed(0)
    with torch.no_grad():
        for p in model.parameters():
            p.zero_()
        # Embeddings: constant 1 in dim 0, random in the free dims 4..7.
        model.embed.W_E[:, CONST] = 1.0
        model.embed.W_E[:, 4:] = torch.randn(cfg.d_vocab, 4, generator=g)
        model.pos_embed.W_pos[:, 4:] = 0.5 * torch.randn(cfg.n_ctx, 4, generator=g)

        a0 = model.blocks[0].attn
        # Every layer-0 head reads the constant dim into its value, so each
        # position's z[0] == 1 (attention rows sum to 1) whatever it attends to.
        for h in range(3):
            a0.W_V[h, CONST, 0] = 1.0
            a0.W_Q[h, 4:, :] = torch.randn(4, 2, generator=g)
            a0.W_K[h, 4:, :] = torch.randn(4, 2, generator=g)
        a0.W_O[0, 0, ORTH] = 1.0   # S_orth writes e_3
        a0.W_O[1, 0, V_IN] = 1.0   # S_pos writes e_1
        a0.W_O[2, 0, V_IN] = -1.0  # S_neg writes -e_1

        a1 = model.blocks[1].attn
        # T = L1.H0: value reads e_1, output writes e_2 (= u). Q/K read the free
        # dims so its attention pattern is non-trivial.
        a1.W_V[0, V_IN, 0] = 1.0
        a1.W_O[0, 0, U_DIR] = 1.0
        a1.W_Q[0, 4:, :] = torch.randn(4, 2, generator=g)
        a1.W_K[0, 4:, :] = torch.randn(4, 2, generator=g)

        model.unembed.W_U[U_DIR, PRED] = 1.0
    return model


def test_hand_built_orth_pos_neg():
    model = _hand_built_model()
    tokens = torch.tensor([[1, 4, 2, 5, 3, 1]])
    t = tokens.shape[1] - 1
    _, cache = model.run_with_cache(tokens)

    sources = ["L0.H0", "L0.H1", "L0.H2"]  # S_orth, S_pos, S_neg
    edges = direct_value_path_edges(model, cache, t, PRED, sources, ["L1.H0"])
    e_orth = edges[("L0.H0", "L1.H0")]
    e_pos = edges[("L0.H1", "L1.H0")]
    e_neg = edges[("L0.H2", "L1.H0")]
    print(f"S_orth={e_orth:.3e} S_pos={e_pos:.6f} S_neg={e_neg:.6f}")

    assert abs(e_orth) < 1e-6
    assert e_pos > 0
    assert e_neg < 0
    assert abs(e_pos + e_neg) < 1e-6  # same magnitude, opposite sign
    # Each source writes a unit vector at every position, T's OV maps e_1 to
    # u with gain 1, and A_T[t, :] sums to 1, so the edge is exactly 1.
    assert e_pos == pytest.approx(1.0, abs=1e-6)


def test_no_edges_into_same_or_earlier_layer():
    model = _hand_built_model()
    _, cache = model.run_with_cache(torch.tensor([[1, 2, 3]]))
    edges = direct_value_path_edges(model, cache, 2, PRED, ["L1.H0", "L0.H1"], ["L0.H0", "L1.H0"])
    assert set(edges) == {("L0.H1", "L1.H0")}


def test_matches_frozen_value_input_ablation_with_layernorm():
    """With LayerNorm (random weights and gains), each edge equals the drop in
    the predicted logit when S's output is removed from T's value input only,
    with T's attention pattern and every LN scale frozen at clean values."""
    from transformer_lens import HookedTransformer, HookedTransformerConfig

    cfg = HookedTransformerConfig(
        n_layers=2,
        d_model=16,
        n_ctx=10,
        d_head=4,
        n_heads=3,
        d_vocab=11,
        attn_only=True,
        normalization_type="LN",
        act_fn="relu",
        use_split_qkv_input=True,
        seed=1,
        dtype=torch.float64,
    )
    model = HookedTransformer(cfg)
    g = torch.Generator().manual_seed(1)
    with torch.no_grad():
        for ln in (model.blocks[1].ln1, model.ln_final):
            ln.w.copy_(1.0 + 0.5 * torch.randn(ln.w.shape, generator=g, dtype=torch.float64))
            ln.b.copy_(0.3 * torch.randn(ln.b.shape, generator=g, dtype=torch.float64))

    tokens = torch.tensor([[3, 7, 1, 9, 4, 2, 8]])
    t = tokens.shape[1] - 1
    clean_logits, cache = model.run_with_cache(tokens)
    pred = int(clean_logits[0, t].argmax())
    sources = [f"L0.H{h}" for h in range(3)]
    targets = [f"L1.H{h}" for h in range(3)]
    edges = direct_value_path_edges(model, cache, t, pred, sources, targets)
    assert len(edges) == 9

    frozen = {
        name: cache[name]
        for name in ("blocks.1.attn.hook_pattern", "blocks.1.ln1.hook_scale", "ln_final.hook_scale")
    }
    for (sid, tid), weight in edges.items():
        hs, ht = int(sid[-1]), int(tid[-1])
        s_out = cache["blocks.0.attn.hook_z"][0, :, hs, :] @ model.blocks[0].attn.W_O[hs]

        def remove_s(v_in, hook, ht=ht, s_out=s_out):
            v_in = v_in.clone()
            v_in[0, :, ht, :] -= s_out
            return v_in

        hooks = [(name, lambda x, hook, val=val: val) for name, val in frozen.items()]
        hooks.append(("blocks.1.hook_v_input", remove_s))
        ablated = model.run_with_hooks(tokens, fwd_hooks=hooks)
        delta = float(clean_logits[0, t, pred] - ablated[0, t, pred])
        assert weight == pytest.approx(delta, rel=1e-4, abs=1e-5), (sid, tid, weight, delta)


IOI_PROMPT = "When Mary and John went to the store, John gave a drink to"


@pytest.mark.inference
def test_ioi_edges_direct_value_path(gpt2_client):
    r = gpt2_client.post("/circuit", json={"preset_id": "gpt2-small", "prompt": IOI_PROMPT})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["edges_method"] == "direct_value_path"
    edges = body["edges"]
    assert len(edges) >= 1
    assert any(abs(e["weight"]) >= body["edge_threshold"] for e in edges)
    assert body["edge_threshold"] > 0
    weights = [abs(e["weight"]) for e in edges]
    assert weights == sorted(weights, reverse=True)
    node_ids = {n["id"] for n in body["nodes"]}
    for e in edges:
        assert e["source"] in node_ids and e["target"] in node_ids
        assert e["target"].startswith("L")  # value path only enters heads
    print("top edges:", [(e["source"], e["target"], round(e["weight"], 4)) for e in edges[:5]])
