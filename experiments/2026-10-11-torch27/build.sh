#!/usr/bin/env bash
# Build a scratch Pry runtime venv at torch 2.7.1 the way pip.rs does it
# (steps 1-5, `-c <constraints> --extra-index-url <torch index>` on every step),
# freeze it, then add `-e sidecar[dev]` for the test suite.
#
#   bash build.sh cpu|cu128
#
# Scratch: %TEMP%\pry-torch27\<variant>. Interpreter: Brad's PBS python (read-only use).
set -euo pipefail
variant="$1"
torch_version="2.7.1"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cygpath -w "$(cd "$here/../.." && pwd)")"
scratch="$TEMP/pry-torch27"
venv="$scratch/$variant"
pbs="$LOCALAPPDATA/Pry/runtime/python.exe"
index="https://download.pytorch.org/whl/$variant"

mkdir -p "$scratch" "$here/logs"
rm -rf "$venv"
"$pbs" -m venv "$venv"
py="$venv/Scripts/python.exe"
"$py" -m pip --version | tee "$here/logs/$variant-pip-version.txt"

# Input constraints: the shipped 0.2.0 cpu constraints minus torch (re-pinned
# with the variant tag) and sympy (torch 2.5.1 pins sympy==1.13.1; torch 2.7.1
# requires sympy>=1.13.3, so let it resolve).
cons="$scratch/constraints-input-$variant.txt"
grep -v -E '^(torch|sympy)==' "$repo/src-tauri/resources/constraints-runtime-cpu.txt" > "$cons"
echo "torch==$torch_version+$variant" >> "$cons"

pipi() { "$py" -m pip install -c "$cons" --extra-index-url "$index" "$@"; }
log="$here/logs/$variant-install.log"
: > "$log"
{
  pipi --no-cache-dir "torch==$torch_version+$variant"
  pipi "transformer-lens>=2.11,<3"
  pipi "sae-lens>=5.0,<6"
  pipi -r "$repo/src-tauri/resources/requirements-runtime.txt"
  pipi "$repo/sidecar"
} >> "$log" 2>&1
ls "$venv/Lib/site-packages" | grep -E '^(torch|transformer_lens|sae_lens|sympy)-.*dist-info$' | tee "$here/logs/$variant-dist-info.txt"
"$py" -m pip freeze > "$here/freeze-$variant.txt"
"$py" -m pip check | tee "$here/logs/$variant-pip-check.txt" || true
"$py" -m pip install -c "$cons" --extra-index-url "$index" -e "$repo/sidecar[dev]" >> "$log" 2>&1
"$py" -c "import torch, json; print(json.dumps({'version': torch.__version__, 'cuda': torch.version.cuda, 'available': torch.cuda.is_available()}))" | tee "$here/logs/$variant-verify.json"
