# 2026-10-11 torch 2.7 + cu128 (roadmap T12)

## Hypothesis

Pry's runtime can move from torch 2.5.1 to torch 2.7.1 and gain a `cu128` variant, which Blackwell (RTX 50xx, sm_120) needs, without changing:

- TransformerLens 2.15.4 or sae-lens 5.11.0,
- any sidecar code,
- SAE features or logits beyond the T12 tolerances.

## Method

**1. Declared bounds (PyPI `requires_dist`)**

| package | torch bound | notes |
|---|---|---|
| transformer-lens 2.15.4 | `torch>=2.2` | allows 2.7 |
| transformer-lens 2.16+ | `torch>=2.6` | not needed |
| sae-lens 5.11.0 | none of its own | reaches torch only via `transformer-lens<3,>=2.0.0` and `transformers<5` |

- The only pinned dependency that conflicts is **sympy**: torch 2.5.1 pins `sympy==1.13.1`, while torch 2.7.1 needs `sympy>=1.13.3`, so it resolves to 1.14.0.
- No TL/SAELens upgrade was needed, so none of the sae-lens 6 `from_pretrained` API changes apply.

**2. Baselines under torch 2.5.1**

Both were recorded with `python sidecar/tests/test_parity.py --record`, which goes through `REGISTRY.load` and `run_generate`.

| fixture | environment |
|---|---|
| `sidecar/tests/fixtures/parity_cpu.json` | dev venv `sidecar/.venv`: torch 2.5.1+cpu, TL 2.15.4, sae-lens 5.11.0 |
| `sidecar/tests/fixtures/parity_cuda.json` | Brad's live runtime, `venvs/20261011T1857Z-cu124`: torch 2.5.1+cu124, RTX 4070 SUPER, driver 617.14 |

- The live runtime was used read-only: `PYTHONDONTWRITEBYTECODE=1` and `PYTHONPATH=sidecar;<scratch dir holding only pytest>`. Nothing was installed into it.
- Both presets were covered: gpt2-small (SAE `blocks.8.hook_resid_pre`) and pythia-70m (`blocks.3.hook_resid_post`).
- Four prompts per preset.
- Per prompt, the fixture holds:
  - the top-10 SAE features by max activation over the prompt;
  - their activations at every token (`[seq][10]`);
  - the final-position top-10 logits;
  - `run_generate`'s top-10 next-token predictions.

**3. Scratch venvs**

`build.sh cpu|cu128` builds them, using Brad's PBS interpreter `%LOCALAPPDATA%\Pry\runtime\python.exe` (pip 25.0.1) for `-m venv` only.

- It runs `pip.rs` steps 1–5 verbatim, with `-c <constraints> --extra-index-url <torch index>` on every step.
- The input constraints are the shipped `constraints-runtime-cpu.txt`, with the `torch` and `sympy` lines removed and `torch==2.7.1+<variant>` added.
- It then runs `pip freeze` (giving `freeze-<variant>.txt`) and `pip check`, and finally installs `-e sidecar[dev]`.

**4. Tests and checks**

- The full sidecar suite in each venv: `pytest -q -W ignore`, all markers, 87 tests including `test_parity.py`.
- `capture_to.py` re-captures parity into `capture-torch271-*`, and `compare_parity.py` diffs it against the baseline.
- `sae_load_check.py` loads model and SAE for every **enabled** preset and spies on `torch.load`, to check the torch 2.6 `weights_only=True` default.

**5. Constraints:** `make_constraints.py` runs `scripts/freeze_to_constraints.py` unchanged, with `VARIANTS` swapped to `("cu128", "cpu")` and output going to this dir.

## Result: works, numerically bit-identical

**Versions**

| variant | wheel | torch.version.cuda | `cuda.is_available()` |
|---|---|---|---|
| cpu | `torch-2.7.1+cpu` | — | — |
| cu128 | `torch-2.7.1+cu128` | 12.8 | True |

- Both variants: transformer-lens 2.15.4, sae-lens 5.11.0, sympy 1.14.0. Everything else is identical to the shipped 0.2.0 constraints.
- `pip check` is clean in both.
- The cu128 wheel bundles cudart 12.8.0 (`cudart64_12.dll` 6.14.11.12080), cuBLAS 12.8, and cuDNN 9.7.1.
- `freeze-cpu.txt` and `freeze-cu128.txt` differ only in the torch tag.

**Parity against the torch 2.5.1 baseline** (`results/parity-*.txt`)

| comparison | top-10 feature ids | top-10 logit ids | max act diff | max logit diff | predictions |
|---|---|---|---|---|---|
| CPU 2.5.1+cpu → 2.7.1+cpu | 8/8 match | 8/8 match | **0** | **0** | same |
| CUDA 2.5.1+cu124 → 2.7.1+cu128 (4070 SUPER) | 8/8 match | 8/8 match | **0** | **0** | same |
| reference: CPU vs CUDA, both 2.5.1 | 8/8 match | 8/8 match | 1.8e-4 abs (5e-5 rel) | 8.2e-4 (pythia) | same |

- Bit-identical across torch versions on the same device.
- `test_parity.py` therefore uses the T12 gate on both devices: activations within rtol 1e-3 / atol 1e-4, and logits within atol 1e-3.
- The CPU-vs-CUDA row is why CUDA has little headroom on logits. Another GPU or driver could pick different cuBLAS kernels. If CUDA parity ever flakes on such a machine, loosen only `TOLERANCES["cuda"]`.

**Full suite** (`results/*-pytest-full.txt`)

| venv | result |
|---|---|
| cpu, torch 2.7.1 | **87 passed** |
| cu128 on the RTX 4070 SUPER | **87 passed** |
| 2.5.1 dev venv | `test_parity.py` passes |
| 2.5.1 cu124 runtime | `test_parity.py` passes |

**SAE loading** (`results/cu128-sae-load.json`)

- gpt2-small (`d_sae` 24576) and pythia-70m (`d_sae` 32768) load on CUDA under 2.7.1+cu128.
- `torch.load` was **never called**: both SAEs load from safetensors. There were no `weights_only` warnings, so the torch 2.6 default doesn't affect the enabled presets.
- The Gemma presets are disabled and were not tested. Their gemma-scope loader should be re-checked when they are enabled.

**Minimum NVIDIA driver for cu128**

- Source: NVIDIA, *CUDA 12.8 Update 1 Release Notes*, Table 3 "CUDA Toolkit and Corresponding Driver Versions", https://docs.nvidia.com/cuda/archive/12.8.1/cuda-toolkit-release-notes/index.html

  | CUDA | Windows x86_64 | Linux x86_64 |
  |---|---|---|
  | 12.8 GA | **>= 572.30** | >= 570.117 |
  | 12.8 Update 1 | >= 572.61 | >= 570.124.06 |
  | 12.4 GA (for the cu124 fallback) | >= 551.61 | — |

- The torch 2.7.1+cu128 wheel ships cudart 12.8.0 (GA), so the **minimum Windows driver is 572.30**.
- Same table: CUDA 12.x minor-version compatibility allows >= 528.33. That doesn't cover new architectures like Blackwell and disables PTX JIT, so Pry shouldn't rely on it.
- PyTorch 2.7.0 release notes, "Blackwell support added across native kernels, CUDA math libraries, and torch.compile": https://github.com/pytorch/pytorch/releases/tag/v2.7.0

**Sizes** (`results/*-venv-size.txt`; runtime = venv minus the `[dev]` extras)

| | torch wheel (download) | runtime venv on disk | torch package |
|---|---|---|---|
| 2.7.1+cu128 | 3,273 MB | **6.44 GiB** (6,910,580,803 B) | 5.42 GiB |
| 2.7.1+cpu | 216 MB | **2.18 GiB** (2,343,376,640 B) | 1.17 GiB |
| 2.5.1+cu124 (T3a) | 2,511 MB | 5.34 GiB | — |
| 2.5.1+cpu | 205 MB | ~2.1 GiB | — |

- Non-torch downloads are about 190 MB on a cold pip cache (from 0.2.0's `DOWNLOAD_MB_CU124` of 2,700 minus the 2,511 MB wheel). That puts cu128 at about **3,500 MB** of download.
- Peak disk is about the venv (6.9 GB) plus the unpacking torch wheel (3.3 GB), so **about 10.2 GB**.

## Candidate files

| file | use |
|---|---|
| `constraints-runtime-cu128.candidate.txt` | goes to `src-tauri/resources/constraints-runtime-cu128.txt`. Kept here because this lane must not touch `src-tauri`. |
| `constraints-runtime-cpu-torch27.candidate.txt` | replaces `constraints-runtime-cpu.txt` **only if** the CPU variant also moves to 2.7.1. Its diff from the shipped file is `sympy 1.13.1→1.14.0` and `torch 2.5.1+cpu→2.7.1+cpu`. |

## Recommendation: ship cu128 in 0.2.0, as an additional variant

There is no API change, no sidecar change, numerics are bit-identical, and both suites are green. The work left is entirely in Rust (`probe.rs` and `layout.rs`) plus constraints and tests.

**Variant matrix**

| condition | variant | torch |
|---|---|---|
| NVIDIA driver >= 572.30 | **cu128** | 2.7.1+cu128 |
| 551.61 <= driver < 572.30 | cu124 | 2.5.1+cu124, kept as the fallback with existing constraints |
| no NVIDIA driver, or driver < 551.61 | cpu | 2.7.1+cpu (candidate), or keep 2.5.1+cpu |

- **Recommended:** move CPU to 2.7.1 too, so that cu128 and cpu share one pin set and only cu124 is the legacy one.
- Today `probe.rs` picks cu124 for any driver and has no minimum. It should also start enforcing 551.61 for cu124.

**Slip to 0.2.x if** the Rust lane can't land the variant, driver gate, and disk constants together with T4's update flow in 0.2.0. Nothing in Python blocks it.

## Risks

- **Blackwell itself is untested.** Only the 4070 SUPER (Ada) ran cu128. Release notes must say "Blackwell untested on real hardware."
- **The schema bump re-downloads for every GPU user.** Bumping `RUNTIME_SCHEMA_VERSION` shows UpdateAvailable to everyone, and cu124 → cu128 means a 3.5 GB download plus 6.4 GiB on disk (+1.1 GiB over cu124).
  - Consider prompting only when the probed variant differs from the installed `runtime.json` variant.
  - Or offer cu128 to existing Ada/Ampere users as optional, since it is numerically identical for them.
- **Disk:** the current `REQUIRED_FREE_BYTES_CU124 = 7.0 GB` is too small for cu128.
- **Drift is per GPU and driver.** The CPU-vs-CUDA logit gap is 8e-4, against a 1e-3 tolerance. Other GPUs, especially Blackwell kernels, may need a looser CUDA bound.
- **Gemma presets** are not validated, as noted above.
- **The `[dev]` extras** (jupyter etc., 0.21 GiB) were excluded from the sizes. The dev venv used for CI is larger.

## Rust-lane changes (exact)

1. **`src-tauri/src/bootstrap/probe.rs`**
   - Add `CudaVariant::Cu128` with:
     - `as_str` `"cu128"`; parse `"cu128"`;
     - label `"cu128 (NVIDIA GPU)"`;
     - `pip_index_url` `https://download.pytorch.org/whl/cu128`;
     - `torch_spec` `torch==2.7.1+cu128`.
   - If CPU moves, the Cpu `torch_spec` becomes `torch==2.7.1+cpu`.
   - In `detect_cuda_variant`, parse `driver_version` (`major.minor`).
   - Add constants with the source URL above in a comment:
     - `MIN_DRIVER_CU128_WIN = (572, 30)`
     - `MIN_DRIVER_CU124_WIN = (551, 61)`
   - Selection: cu128 if driver >= 572.30; else cu124 if >= 551.61; else CPU.
   - Unparseable driver: fall back to cu124, keeping today's behaviour.
2. **`hardware.rs`:** report the driver string (T12 plan).
3. **`src-tauri/src/bootstrap/layout.rs`**
   - Add `RUNTIME_SCHEMA_VERSION = 3` (it is in `layout.rs:28`, not `mod.rs`).
   - Add a constraints `include_str!` arm: `CudaVariant::Cu128 => include_str!("../../resources/constraints-runtime-cu128.txt")`.
   - Add `REQUIRED_FREE_BYTES_CU128: u64 = 11_000_000_000`: the 6.9 GB venv plus 3.3 GB wheel, with headroom.
   - Add `DOWNLOAD_MB_CU128: u64 = 3_500`.
   - CPU: `DOWNLOAD_MB_CPU` 400 → 420 (216 MB wheel plus about 190 MB). `REQUIRED_FREE_BYTES_CPU` stays 3.5 GB (venv 2.34 GB).
   - Update the `required_free_bytes` and download-size matches.
4. **`bootstrap/mod.rs`:** the CUDA-unavailable warning (`variant == Cu124`, around `:286`) must also cover Cu128.
5. **Resources:** copy `constraints-runtime-cu128.candidate.txt` → `src-tauri/resources/constraints-runtime-cu128.txt`, and if CPU moves, `constraints-runtime-cpu-torch27.candidate.txt` → `constraints-runtime-cpu.txt`. Check whether `tauri.conf.json` needs a resource entry.
6. **`scripts/freeze_to_constraints.py`:** `VARIANTS = ("cu124", "cpu")` cannot produce cu128. Make the variant list a CLI argument.
7. **`sidecar/tests/test_constraints.py`:** `VARIANTS` must add `cu128`. The "cu124 and cpu pin the same non-torch versions" check must become "cu128 and cpu are identical except torch". cu124 then differs from them in `torch` and `sympy` only.

## Re-running

```bash
bash build.sh cpu      # ~10 min; %TEMP%\pry-torch27\cpu
bash build.sh cu128    # ~15 min, 3.3 GB download; %TEMP%\pry-torch27\cu128
cd ../../sidecar && HF_HUB_OFFLINE=1 "$TEMP/pry-torch27/cu128/Scripts/python.exe" -m pytest -q -W ignore
python ../experiments/2026-10-11-torch27/capture_to.py <out> && python compare_parity.py <fixture> <out>/parity_<device>.json
```

The scratch venvs were deleted after the run. Install logs are in `logs/`, which is gitignored.
