"""Tiny randomly initialised HookedTransformers for offline numeric tests.

No download and no tokenizer: ``to_tokens`` / ``to_str_tokens`` /
``to_single_str_token`` are stubbed on the instance so the inference
functions (``run_dla``, ``run_circuit``, ``run_logit_lens``) can run on them.
"""

from __future__ import annotations

import torch

TOKENS = [3, 7, 1, 9, 4, 2, 8]


def tiny_model(post_norm: bool, soft_cap: float = -1.0, seed: int = 0):
    """2-layer RMSNorm model. ``post_norm`` sets Gemma 2's
    ``use_normalization_before_and_after`` (ln1_post / ln2_post), with random
    post-norm weights and non-zero ``b_O`` so a missed post-norm shows up."""
    from transformer_lens import HookedTransformer, HookedTransformerConfig

    cfg = HookedTransformerConfig(
        n_layers=2,
        d_model=16,
        n_ctx=10,
        d_head=4,
        n_heads=3,
        d_mlp=32,
        d_vocab=11,
        act_fn="gelu",
        normalization_type="RMS",
        use_normalization_before_and_after=post_norm,
        output_logits_soft_cap=soft_cap,
        use_attn_result=True,
        use_split_qkv_input=True,
        seed=seed,
        dtype=torch.float64,
    )
    model = HookedTransformer(cfg)
    g = torch.Generator().manual_seed(seed)
    with torch.no_grad():
        for block in model.blocks:
            block.attn.b_O.copy_(0.5 * torch.randn(block.attn.b_O.shape, generator=g, dtype=torch.float64))
            for name in ("ln1", "ln2", "ln1_post", "ln2_post"):
                ln = getattr(block, name, None)
                if ln is not None and hasattr(ln, "w"):
                    ln.w.copy_(1.0 + 0.5 * torch.randn(ln.w.shape, generator=g, dtype=torch.float64))
        model.ln_final.w.copy_(1.0 + 0.5 * torch.randn(model.ln_final.w.shape, generator=g, dtype=torch.float64))
        model.unembed.b_U.copy_(0.3 * torch.randn(model.unembed.b_U.shape, generator=g, dtype=torch.float64))

    toks = torch.tensor([TOKENS])
    model.to_tokens = lambda prompt, *a, **k: toks
    model.to_str_tokens = lambda prompt, *a, **k: [f"t{t}" for t in TOKENS]
    model.to_single_str_token = lambda i: f"t{i}"
    return model


def loaded_for(model, preset_id: str = "tiny"):
    from pry_sidecar.registry import LoadedModel

    return LoadedModel(preset_id, model, None, None, "cpu")


def dla_bias(model, cache, pred: int, t: int) -> float:
    """What DLA doesn't attribute to a head or MLP: the embeddings, each
    layer's shared ``b_O`` (through ln1_post when the model has it) and
    ``b_U``, all through the frozen final norm."""
    from pry_sidecar.inference import final_ln_logit_direction

    u = final_ln_logit_direction(model, cache, pred, t)
    total = cache["blocks.0.hook_resid_pre"][0, t].float() @ u
    for layer, block in enumerate(model.blocks):
        b_o = block.attn.b_O.float()
        if model.cfg.use_normalization_before_and_after:
            s = cache[f"blocks.{layer}.ln1_post.hook_scale"][0, t, 0].float()
            b_o = b_o * block.ln1_post.w.float() / s
        total = total + b_o @ u
    b_u = getattr(model, "b_U", None)
    if b_u is not None:
        total = total + b_u[pred].float()
    return float(total)
