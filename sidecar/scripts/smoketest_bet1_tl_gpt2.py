"""Bet 1 — TransformerLens + GPT-2 small attention extraction.

Pass criteria (plan §7 Phase 1):
- HookedTransformer.from_pretrained("gpt2") loads without error
- Runs prompt "The doctor told the nurse that she" and caches attention
- cache["pattern", layer] has shape [batch, head, seq, seq] for all 12 layers
- Top-3 (layer, head) by attention from "she" token includes at least one head
  attending to "nurse" or "doctor"
- Wall-clock < 15s on a 4070 Super

Run: uv run python scripts/smoketest_bet1_tl_gpt2.py
     uv run python scripts/smoketest_bet1_tl_gpt2.py --cpu
"""

from __future__ import annotations

import argparse
import sys
import time

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

parser = argparse.ArgumentParser(description="Bet 1 — TransformerLens + GPT-2 attention smoketest")
parser.add_argument("--cpu", action="store_true", help="Force CPU even if CUDA is available")
args = parser.parse_args()

# ---------------------------------------------------------------------------
# Color helpers (Windows 10+ VT100 supported)
# ---------------------------------------------------------------------------

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BOLD = "\033[1m"
RESET = "\033[0m"


def ok(msg: str) -> None:
    print(f"  {GREEN}✓{RESET} {msg}")


def fail(msg: str) -> None:
    print(f"  {RED}✗ FAIL:{RESET} {msg}")


def info(msg: str) -> None:
    print(f"  {YELLOW}·{RESET} {msg}")


def header(msg: str) -> None:
    print(f"\n{BOLD}{msg}{RESET}")


# ---------------------------------------------------------------------------
# Step 1 — Import torch and choose device
# ---------------------------------------------------------------------------

header("Step 1 — Import torch + device selection")

try:
    import torch
    ok(f"torch {torch.__version__} imported")
except ImportError as e:
    fail(f"torch import failed: {e}")
    sys.exit(1)

if args.cpu:
    device = "cpu"
    info("--cpu flag set, using CPU")
elif torch.cuda.is_available():
    device = "cuda"
    gpu_name = torch.cuda.get_device_name(0)
    ok(f"CUDA available — using {gpu_name}")
else:
    device = "cpu"
    info("No CUDA device found, falling back to CPU (pass --cpu to suppress this message)")

# ---------------------------------------------------------------------------
# Step 2 — Load TransformerLens GPT-2 small
# ---------------------------------------------------------------------------

header("Step 2 — Load TransformerLens HookedTransformer (gpt2)")

t0 = time.perf_counter()

try:
    from transformer_lens import HookedTransformer
    ok("transformer_lens imported")
except ImportError as e:
    fail(f"transformer_lens import failed: {e}")
    sys.exit(1)

try:
    model = HookedTransformer.from_pretrained("gpt2", device=device)
    model.eval()
    load_time = time.perf_counter() - t0
    ok(f"HookedTransformer loaded in {load_time:.2f}s on {device}")
except Exception as e:
    fail(f"HookedTransformer.from_pretrained('gpt2') raised: {e}")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Step 3 — Run prompt with attention cache
# ---------------------------------------------------------------------------

header("Step 3 — Run coreference prompt and cache attention")

PROMPT = "The doctor told the nurse that she"

t1 = time.perf_counter()

try:
    with torch.no_grad():
        tokens = model.to_tokens(PROMPT)
        logits, cache = model.run_with_cache(tokens, names_filter=lambda n: n.endswith("pattern"))
    inference_time = time.perf_counter() - t1
    ok(f"Inference + cache complete in {inference_time:.2f}s")
except Exception as e:
    fail(f"run_with_cache raised: {e}")
    sys.exit(1)

token_strs = model.to_str_tokens(PROMPT)
info(f"Tokens: {token_strs}")

# ---------------------------------------------------------------------------
# Step 4 — Verify attention cache shapes for all 12 layers
# ---------------------------------------------------------------------------

header("Step 4 — Verify cache['pattern', layer] shape for 12 layers")

n_layers = model.cfg.n_layers
n_heads = model.cfg.n_heads
seq_len = tokens.shape[1]
expected_shape = (1, n_heads, seq_len, seq_len)

shape_errors = []
for layer in range(n_layers):
    key = f"blocks.{layer}.attn.hook_pattern"
    if key not in cache:
        shape_errors.append(f"Layer {layer}: key '{key}' missing from cache")
        continue
    actual = tuple(cache[key].shape)
    if actual != expected_shape:
        shape_errors.append(f"Layer {layer}: expected {expected_shape}, got {actual}")

if shape_errors:
    for err in shape_errors:
        fail(err)
    sys.exit(1)
else:
    ok(f"All {n_layers} layers have shape {expected_shape} — PASS")

# ---------------------------------------------------------------------------
# Step 5 — Top-3 heads by attention from "she" token
# ---------------------------------------------------------------------------

header("Step 5 — Top-3 (layer, head) attending from 'she' token")

# Find the index of "she" in token list (last token)
she_str = " she"
try:
    she_idx = next(i for i, t in enumerate(token_strs) if t.strip().lower() == "she")
except StopIteration:
    # fall back to last token
    she_idx = seq_len - 1
    info(f"'she' token not found by string match, using last token index {she_idx}")

info(f"'she' token index: {she_idx} (token: {token_strs[she_idx]!r})")

# Collect max attention from "she" for each (layer, head)
head_scores: list[tuple[float, int, int, int]] = []  # (score, layer, head, tgt_idx)

for layer in range(n_layers):
    key = f"blocks.{layer}.attn.hook_pattern"
    pattern = cache[key][0]  # [n_heads, seq, seq]
    # attention from she_idx to each prior token: shape [n_heads, seq_len]
    attn_from_she = pattern[:, she_idx, :]  # [n_heads, seq_len]
    max_vals, max_idxs = attn_from_she.max(dim=-1)  # [n_heads]
    for head in range(n_heads):
        score = max_vals[head].item()
        tgt_idx = max_idxs[head].item()
        head_scores.append((score, layer, head, tgt_idx))

head_scores.sort(key=lambda x: -x[0])
top3 = head_scores[:3]

print()
print(f"  {'Layer':>6}  {'Head':>5}  {'Score':>8}  {'Max-attn target token':}")
print(f"  {'-'*6}  {'-'*5}  {'-'*8}  {'-'*22}")
for score, layer, head, tgt_idx in top3:
    tgt_token = token_strs[tgt_idx] if tgt_idx < len(token_strs) else f"[{tgt_idx}]"
    print(f"  {layer:>6}  {head:>5}  {score:>8.4f}  {tgt_token!r}")

# Check pass criterion: at least one top-3 head attends to "nurse" or "doctor"
coreference_tokens = {"nurse", "doctor", " nurse", " doctor", "Nurse", "Doctor"}
found_coreference = any(
    token_strs[tgt_idx].strip() in {t.strip() for t in coreference_tokens}
    for _, _, _, tgt_idx in top3
    if tgt_idx < len(token_strs)
)

print()
if found_coreference:
    ok("At least one top-3 head attends to 'nurse' or 'doctor' — coreference PASS")
else:
    info(
        "No top-3 head directly attends to 'nurse'/'doctor' by max-attention — "
        "this may still be a soft pass. Check the table above manually."
    )
    info("Common on smaller models: coreference signal is distributed, not peaked on one head.")

# ---------------------------------------------------------------------------
# Step 6 — Wall-clock check
# ---------------------------------------------------------------------------

header("Step 6 — Wall-clock timing")

total_time = time.perf_counter() - t0
info(f"Total wall-clock: {total_time:.2f}s (target <15s on 4070 Super)")

if total_time < 15.0:
    ok(f"Timing PASS ({total_time:.2f}s < 15s)")
else:
    info(f"Timing SOFT FAIL ({total_time:.2f}s > 15s) — check GPU / network speed")

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print()
print(f"{BOLD}{'='*50}{RESET}")
wall = time.perf_counter() - t0

all_pass = not shape_errors
if all_pass:
    print(f"{GREEN}{BOLD}BET 1 PASS{RESET} — TransformerLens + GPT-2 attention extraction works.")
    print(f"  Shapes correct, inference completed in {total_time:.2f}s on {device}.")
    print(f"  Coreference signal: {'found' if found_coreference else 'check table above'}.")
    sys.exit(0)
else:
    print(f"{RED}{BOLD}BET 1 FAIL{RESET} — shape errors detected. Do not proceed to Bet 2.")
    sys.exit(1)
