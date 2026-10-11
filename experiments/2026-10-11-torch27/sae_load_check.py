"""Load model + SAE for every enabled preset through REGISTRY; report device, SAE file types,
and whether torch.load was called (torch>=2.6 defaults weights_only=True)."""

import json
import os
import sys
import warnings
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(repo / "sidecar"))
os.environ.setdefault("PRY_PRESETS_PATH", str(repo / "sidecar" / "presets.json"))
import torch  # noqa: E402

calls = []
_orig = torch.load


def spy(*a, **k):
    calls.append({"arg": str(a[0])[-80:] if a else None, "weights_only": k.get("weights_only")})
    return _orig(*a, **k)


torch.load = spy
from pry_sidecar.presets import PRESETS  # noqa: E402
from pry_sidecar.registry import REGISTRY  # noqa: E402

out = {"torch": torch.__version__, "presets": {}}
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter("always")
    for pid, m in PRESETS.items():
        if not getattr(m, "enabled", True):
            out["presets"][pid] = "disabled (skipped)"
            continue
        loaded = REGISTRY.load(pid, m)
        out["presets"][pid] = {
            "device": str(loaded.device),
            "sae_layer": loaded.sae_layer,
            "d_sae": int(loaded.sae.W_dec.shape[0]),
            "sae_device": str(loaded.sae.device),
        }
    out["weights_only_warnings"] = [
        str(x.message)[:160] for x in w if "weights_only" in str(x.message)
    ]
out["torch_load_calls"] = calls
print(json.dumps(out, indent=1))
