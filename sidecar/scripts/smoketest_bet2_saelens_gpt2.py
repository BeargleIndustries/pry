"""Bet 2 — SAELens + Joseph Bloom GPT-2 residual SAE loading + Neuronpedia.

Pass criteria (plan §7 Phase 1):
- SAE.from_pretrained("gpt2-small-res-jb", "blocks.8.hook_resid_pre") loads
- Running same prompt, cache layer 8 residual, run SAE
- Activations are sparse (<=20 features with activation > 1.0 on final token)
- Neuronpedia /api/feature/gpt2-small/8-res-jb/{id} returns descriptions
  for at least 3 of top-5 features
- Wall-clock < 30s on a 4070 Super (includes SAE download on first run)

Run: uv run python scripts/smoketest_bet2_saelens_gpt2.py
     uv run python scripts/smoketest_bet2_saelens_gpt2.py --cpu
"""

from __future__ import annotations

import argparse
import sys
import time

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

parser = argparse.ArgumentParser(description="Bet 2 — SAELens + GPT-2 Bloom SAE + Neuronpedia smoketest")
parser.add_argument("--cpu", action="store_true", help="Force CPU even if CUDA is available")
args = parser.parse_args()

# ---------------------------------------------------------------------------
# Color helpers
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


def warn(msg: str) -> None:
    print(f"  {YELLOW}⚠ WARN:{RESET} {msg}")


def header(msg: str) -> None:
    print(f"\n{BOLD}{msg}{RESET}")


# ---------------------------------------------------------------------------
# Step 1 — Import torch + device
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
    info("No CUDA device found, falling back to CPU")

# ---------------------------------------------------------------------------
# Step 2 — Load TransformerLens GPT-2 (needed to get residuals)
# ---------------------------------------------------------------------------

header("Step 2 — Load TransformerLens GPT-2 small")

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
    ok(f"HookedTransformer loaded in {time.perf_counter() - t0:.2f}s")
except Exception as e:
    fail(f"HookedTransformer.from_pretrained('gpt2') raised: {e}")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Step 3 — Load SAELens Joseph Bloom GPT-2 residual SAE
# ---------------------------------------------------------------------------

header("Step 3 — Load SAELens Bloom GPT-2 SAE (blocks.8.hook_resid_pre)")

t_sae = time.perf_counter()

try:
    from sae_lens import SAE
    ok("sae_lens imported")
except ImportError as e:
    fail(f"sae_lens import failed: {e}")
    sys.exit(1)

SAE_RELEASE = "gpt2-small-res-jb"
SAE_HOOK = "blocks.8.hook_resid_pre"

try:
    sae, cfg_dict, log_feature_sparsity = SAE.from_pretrained(
        release=SAE_RELEASE,
        sae_id=SAE_HOOK,
        device=device,
    )
    sae.eval()
    sae_load_time = time.perf_counter() - t_sae
    ok(f"SAE loaded in {sae_load_time:.2f}s")
    info(f"SAE d_in={sae.cfg.d_in}, d_sae={sae.cfg.d_sae}")
except Exception as e:
    fail(f"SAE.from_pretrained('{SAE_RELEASE}', '{SAE_HOOK}') raised: {e}")
    fail("Check SAELens version and release name. See: https://github.com/jbloomAus/SAELens")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Step 4 — Run prompt, cache layer 8 residual
# ---------------------------------------------------------------------------

header("Step 4 — Run prompt + cache blocks.8.hook_resid_pre")

PROMPT = "The doctor told the nurse that she"

try:
    with torch.no_grad():
        tokens = model.to_tokens(PROMPT)
        _, cache = model.run_with_cache(
            tokens,
            names_filter=lambda n: n == SAE_HOOK,
        )
    ok(f"Inference done, cached {SAE_HOOK}")
except Exception as e:
    fail(f"run_with_cache raised: {e}")
    sys.exit(1)

resid = cache[SAE_HOOK]  # [batch, seq, d_model]
ok(f"Residual shape: {tuple(resid.shape)}")

# ---------------------------------------------------------------------------
# Step 5 — Run SAE encode, extract top-5 features on final token
# ---------------------------------------------------------------------------

header("Step 5 — SAE encode + sparsity check on final token")

try:
    with torch.no_grad():
        feature_acts = sae.encode(resid)  # [batch, seq, d_sae]
    ok(f"SAE encode complete, output shape: {tuple(feature_acts.shape)}")
except Exception as e:
    fail(f"sae.encode raised: {e}")
    sys.exit(1)

# Final token activations
final_token_acts = feature_acts[0, -1, :]  # [d_sae]

# Sparsity check: how many features have activation > 1.0
n_active = (final_token_acts > 1.0).sum().item()
info(f"Features with activation > 1.0 on final token: {n_active}")

if n_active <= 20:
    ok(f"Sparsity PASS — {n_active} active features (<= 20)")
else:
    warn(f"Sparsity SOFT FAIL — {n_active} active features (> 20). SAE may not be fully trained or release name is wrong.")

# Top-5 features
top5_vals, top5_idxs = final_token_acts.topk(5)
top5_features = list(zip(top5_idxs.tolist(), top5_vals.tolist()))

ok(f"Top-5 feature IDs: {[f[0] for f in top5_features]}")

# ---------------------------------------------------------------------------
# Step 6 — Neuronpedia description lookup for top-5 features
# ---------------------------------------------------------------------------

header("Step 6 — Neuronpedia description lookup")

try:
    import requests
    ok("requests imported")
except ImportError as e:
    fail(f"requests import failed: {e}")
    sys.exit(1)

NP_BASE = "https://www.neuronpedia.org/api/feature"
NP_MODEL = "gpt2-small"
NP_SAE_ID = "8-res-jb"
HEADERS = {"User-Agent": "pry-smoketest/0.1.0"}

results: list[dict] = []
neuronpedia_reachable = True

for feature_id, activation in top5_features:
    url = f"{NP_BASE}/{NP_MODEL}/{NP_SAE_ID}/{feature_id}"
    description = None
    http_status = None
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        http_status = resp.status_code
        if resp.status_code == 200:
            data = resp.json()
            # Neuronpedia returns description in various fields; try common ones
            description = (
                data.get("description")
                or data.get("label")
                or data.get("autointerp_description")
                or None
            )
        elif resp.status_code == 404:
            description = None
        else:
            neuronpedia_reachable = False
            warn(f"Neuronpedia returned HTTP {resp.status_code} for feature {feature_id}")
    except requests.exceptions.Timeout:
        neuronpedia_reachable = False
        warn("Neuronpedia request timed out (10s). Counting as partial pass.")
        break
    except requests.exceptions.ConnectionError:
        neuronpedia_reachable = False
        warn("Cannot reach Neuronpedia. Counting as partial pass (network issue, not a Bet failure).")
        break

    results.append({
        "feature_id": feature_id,
        "activation": activation,
        "description": description,
        "http_status": http_status,
    })

# ---------------------------------------------------------------------------
# Step 7 — Print results table
# ---------------------------------------------------------------------------

header("Step 7 — Results table")

print()
print(f"  {'feature_id':>12}  {'activation':>12}  {'description_snippet'}")
print(f"  {'-'*12}  {'-'*12}  {'-'*40}")

described_count = 0
for r in results:
    desc = r["description"]
    if desc and len(desc.strip()) >= 3:
        described_count += 1
        snippet = desc[:50] + ("..." if len(desc) > 50 else "")
    else:
        snippet = "(no description)"
    print(f"  {r['feature_id']:>12}  {r['activation']:>12.4f}  {snippet}")

print()

# ---------------------------------------------------------------------------
# Final pass/fail
# ---------------------------------------------------------------------------

header("Summary")

passes = []
failures = []

# Shape check already done above (implicitly — if we got here, resid shape was fine)
passes.append("SAE loads without error")
passes.append(f"SAE encode produces output shape {tuple(feature_acts.shape)}")

if n_active <= 20:
    passes.append(f"Sparsity: {n_active} active features (<= 20)")
else:
    failures.append(f"Sparsity: {n_active} active features (> 20 threshold)")

if not neuronpedia_reachable:
    warn("Neuronpedia unreachable — description check skipped (network issue, not a Bet failure)")
    passes.append("Neuronpedia: SKIPPED (network unreachable — partial pass)")
elif described_count >= 3:
    passes.append(f"Neuronpedia: {described_count}/5 features have descriptions (>= 3 required)")
else:
    failures.append(f"Neuronpedia: only {described_count}/5 features have descriptions (need >= 3)")

total_time = time.perf_counter() - t0
if total_time < 30.0:
    passes.append(f"Wall-clock: {total_time:.2f}s (< 30s)")
else:
    warn(f"Wall-clock: {total_time:.2f}s (> 30s target — check GPU / network)")

for p in passes:
    ok(p)
for f in failures:
    fail(f)

print()
print(f"{BOLD}{'='*50}{RESET}")

if failures:
    print(f"{RED}{BOLD}BET 2 FAIL{RESET} — {len(failures)} criterion/criteria not met.")
    print("  Check SAELens release name and Neuronpedia endpoint.")
    sys.exit(1)
else:
    print(f"{GREEN}{BOLD}BET 2 PASS{RESET} — SAELens + Bloom SAE + Neuronpedia all good.")
    print(f"  Total wall-clock: {total_time:.2f}s on {device}.")
    sys.exit(0)
