# 2026-10-11 torch swap: root-cause replay (roadmap T3a)

## Hypothesis

A bootstrap step after sae-lens re-resolves torch from PyPI and replaces `torch-2.5.1+cu124` with the PyPI `torch-2.5.1` wheel. The leading suspect is step 5 (`pip install <sidecar>`, which declares `torch==2.5.*`).

## Method

- **Interpreter:** the PBS build from `pbs.rs` (cpython 3.12.13+20260408). It was copied read-only from `%LOCALAPPDATA%\Pry\runtime` (venv and markers excluded). `-DownloadPbs` instead fetches the tarball and checks its SHA256.
- **Environment:** a fresh `python -m venv` with pip **25.0.1**, the same version as Brad's runtime (`pip-25.0.1.dist-info`).
- **Steps:** `pip.rs` steps 1–5 run verbatim through `venv\Scripts\pip.exe`.
  1. `--index-url https://download.pytorch.org/whl/cu124 --extra-index-url https://pypi.org/simple torch==2.5.1`
  2. `transformer-lens>=2.11,<3`
  3. `sae-lens>=5.0,<6`
  4. `-r requirements-runtime.txt`
  5. `<copy of sidecar/>`
- **Per step:**
  - `--dry-run --report`: trimmed to `step-N.json` (name, version, url, `requested`, and torch/TL/sympy `requires_dist` edges).
  - The real install, logged.
  - A dist-info snapshot and a `pip freeze`.
- **Runs:**

  | Run | Command | Outputs |
  |---|---|---|
  | Reproduction (cu124) | `pwsh -File replay.ps1 -Variant cu124` | `step-*.json`, `summary-cu124.txt` |
  | Reproduction (cpu) | `pwsh -File replay.ps1 -Variant cpu` | `cpu/`, `summary-cpu.txt` |
  | Constrained (cu124) | `replay.ps1 -Variant cu124 -ConstraintFile constraints-candidate-cu124.txt` | `constrained-cu124/`, `summary-constrained-cu124.txt`, `freeze-cu124.txt` |

  The constrained run adds `-c <file>` to every step and `--extra-index-url <torch index>` to steps 2–5.
- **Brad's runtime** was inspected read-only: dist-info timestamps and `pip freeze`.

## Result: reproduced. It is a two-stage swap, steps 2 and 5

Dist-info sequence for the cu124 reproduction (`summary-cu124.txt`):

| after step | torch | transformer_lens | sympy | notes |
|---|---|---|---|---|
| 1 | **2.5.1+cu124** | none | 1.13.1 | correct |
| 2 | **2.14.1** (PyPI) | 2.18.0 | 1.14.0 | **cu124 torch uninstalled here** |
| 3 | 2.14.1 | 2.18.0 | 1.14.0 | sae-lens 5.11.0 |
| 4 | 2.14.1 | 2.18.0 | 1.14.0 | no torch changes |
| 5 | **2.5.1** (PyPI, no tag) | **2.15.4** | **1.13.1** | downgrade; matches Brad's runtime exactly |

**Stage 1: step 2 (`transformer-lens>=2.11,<3`).**
- With no constraint, pip picks the newest TL, which today is 2.18.0.
- TL ≥2.16 declares `torch (>=2.6) ; python_version >= "3.9"` (see `step-2.json`, `requires_torch_or_tl`).
- pip's only-if-needed upgrade therefore replaces `torch-2.5.1+cu124` with PyPI's newest torch (today 2.14.1) and upgrades sympy.

**Stage 2: step 5 (`pip install <sidecar>`).**
- `pry-sidecar` requires `torch==2.5.*` and `transformer-lens>=2.11,<3`.
- The installed torch 2.14.1 violates `==2.5.*`. Step 5 has no torch index, so pip resolves `torch==2.5.1` from **PyPI** (the untagged Windows wheel, which is a CPU build).
- It then backtracks TL to **2.15.4**, the newest TL that allows torch <2.6, and sympy to 1.13.1.
- Requirement chain: `pry-sidecar 0.1.0 -> torch==2.5.*` (`requested: true` on pry-sidecar in `step-5.json`; torch, TL and sympy appear there as non-requested installs).

**Matches Brad's 2026-04-15 install.**
- His runtime has `sympy` (12:49:14), `torch-2.5.1` (12:49:47) and `transformer_lens-2.15.4` (12:49:49), all rewritten together after step 4 (`sse_starlette` 12:48:47).
- His final key versions match the replay exactly: torch 2.5.1 (no tag), TL 2.15.4, sae-lens 5.11.0, sympy 1.13.1, numpy 1.26.4, datasets 2.21.0, fsspec 2024.6.1, transformers 4.57.6.
- TL is only rewritten at step 5 if step 2 had installed a different TL, so the April install followed the same two-stage path. A TL ≥2.16 requiring torch ≥2.6 was already on PyPI then. The intermediate torch version on install day is unknown and doesn't matter.

**The CPU variant shows the identical sequence** (`+cpu` → 2.14.1 → plain 2.5.1). The effect there is benign, because the plain Windows wheel is also a CPU build.

**Constrained run:** `torch-2.5.1+cu124.dist-info` after **every** step 1–5, TL 2.15.4, sae-lens 5.11.0. `torch.version.cuda == "12.4"` and `cuda.is_available() == True` on the RTX 4070 SUPER.

### Venv sizes (on disk, for T4 disk constants)

| venv | size |
|---|---|
| cu124, correct (constrained, `torch 2.5.1+cu124`) | **5.34 GiB** (5,733,843,154 B) |
| cpu (end state of the cpu replay; PyPI `torch 2.5.1` is the CPU build) | **2.12 GiB** (2,274,414,011 B) |
| PBS interpreter (outside the venv) | 0.14 GiB (151,843,337 B) |

- The cpu figure is a measured proxy. A clean `+cpu` venv carries the same CPU torch build, so expect about 2.1 GiB (estimate, not measured).
- Peak disk during install is higher: the pip cache and the wheel unpack add about 2.5 GB for cu124.

## Implications for T3 (where it differs from the plan)

1. **Both stages need a fix, and the root is step 2, not only step 5.** Constraining step 5 alone (or loosening the sidecar's torch pin) would leave PyPI torch 2.14 installed after step 2. Every step must carry the constraints, including the torch pin with its local tag.
2. **Don't use `PIP_CONSTRAINT`. Pass `-c <constraints>` on the command line.**
   - pip splits append-type env options on whitespace (`pip/_internal/cli/parser.py:249`, `val = val.split()`).
   - In the replay, a constraints path containing a space (`...\Claude Code\...`) failed every step with `Could not open requirements file: [Errno 13] Permission denied: 'C:\\Users\\Brad\\Documents\\Claude'`.
   - `%LOCALAPPDATA%` contains the Windows user name, which can contain spaces, so `PIP_CONSTRAINT=<runtime_dir>\constraints.txt` would break bootstrap for those users.
   - Reaching the isolated build env is unnecessary. The swap happens in step 5's *main* resolve, and the hatchling build env needs only hatchling. With `-c` on the CLI, step 5's isolated build succeeded and torch stayed `+cu124`.
   - The Rust unit test should assert `-c` (not the env var) plus `--extra-index-url` for every step.
3. **Constraints must pin `pyarrow` below 24** (Brad has 23.0.1; the candidate uses `pyarrow==23.0.1`).
   - Today's freeze picks pyarrow 26.0.0, which needs NumPy 2 at import, while TL and sae-lens keep NumPy 1.26.4.
   - Concurrent commit `5a11649` added `"pyarrow<24"` to `sidecar/pyproject.toml`. The reproduction run used the pre-commit 0.1.0 pyproject; a re-run now copies the new one. The swap still reproduces, because the torch pin is unchanged.
4. **`freeze-cu124.txt`** comes from the constrained run (`after step 5`).
   - It contains a `pry-sidecar @ file:///...` line, which T3's freeze-to-constraints script must strip, along with pip, setuptools, wheel, hatchling and packaging. Torch is already `2.5.1+cu124`.
   - There was no clean full state before the swap, because the swap starts at step 2. `freeze-after-step-1-cu124.txt` is the clean step-1 state (torch, sympy and deps only).
   - **What step 2 changes from it** (see `step-2.json`): it upgrades torch (2.5.1+cu124 → 2.14.1) and sympy (1.13.1 → 1.14.0), replaces fsspec, and adds TL 2.18.0 plus its tree (transformers, accelerate, datasets, pandas, wandb, ...).
5. **Constraints-file drift.** Transitive pins in today's freeze are 6 months newer than Brad's (for example wandb 0.30, which pulls opentelemetry). The candidate imports and passes the CUDA check, but T1/T3 should still run the sidecar inference test against it.
6. **Step-1 spec.** Using `torch==2.5.1+cu124` / `+cpu` as the spec (plan T3.1) is consistent with this result.

## `-Fixed` (T3 regression check)

`replay.ps1 -Fixed` replays the T3 bootstrapper exactly as `pip.rs::pip_command_for_step` builds it:

- `venv\Scripts\python.exe -m pip install -c src-tauri\resources\constraints-runtime-<variant>.txt --extra-index-url <torch index> ...` on every step (the constraints path contains a space and is passed as one argv element);
- step 1 is `--no-cache-dir torch==2.5.1+<variant>`; steps 4–5 use the current `requirements-runtime.txt` (no `sse-starlette`) and `sidecar/` (`torch>=2.5,<3`);
- it throws unless the torch dist-info is `torch-2.5.1+<variant>.dist-info` after every step.

**Result, 2026-10-11, cu124, pip 25.0.1, fresh PBS download (`-Fixed -Variant cu124 -DownloadPbs -SkipDryRun`, `summary-fixed-cu124.txt`):**

| after step | torch | transformer_lens | sae_lens |
|---|---|---|---|
| 1 | `torch-2.5.1+cu124` | — | — |
| 2 | `torch-2.5.1+cu124` | 2.15.4 | — |
| 3 | `torch-2.5.1+cu124` | 2.15.4 | 5.11.0 |
| 4 | `torch-2.5.1+cu124` | 2.15.4 | 5.11.0 |
| 5 | `torch-2.5.1+cu124` | 2.15.4 | 5.11.0 (+ `pry_sidecar-0.1.0`) |

- The T3 `verify_build` probe in that venv returned `{"version": "2.5.1+cu124", "cuda": "12.4", "available": true}` on the RTX 4070 SUPER.
- Venv size: 5.34 GiB (5,733,604,810 B).
- A cpu venv built the same way (`-c constraints-runtime-cpu.txt`) kept `torch-2.5.1+cpu` through all steps, and the full sidecar test suite (58 tests, including inference smoke and `test_constraints.py`) passed in it.

## Re-running

```powershell
pwsh -File replay.ps1 -Variant cu124            # reproduces the swap (summary-cu124.txt)
pwsh -File replay.ps1 -Variant cpu
pwsh -File replay.ps1 -Variant cu124 -ConstraintFile constraints-candidate-cu124.txt
pwsh -File replay.ps1 -Fixed -Variant cu124 -DownloadPbs -SkipDryRun   # T3 regression check (summary-fixed-cu124.txt)
```

- Scratch lives in `%TEMP%\pry-replay\<tag>` and is wiped on each run.
- A cu124 run needs about 8 GB free: a 5.3 GiB venv plus the pip cache.
- Reproduction depends on PyPI state: it needs the newest TL to require torch>2.5. That has been true since TL 2.16.
