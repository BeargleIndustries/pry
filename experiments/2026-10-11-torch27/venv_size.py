"""Size of a venv, split into runtime (packages in FREEZE) and dev extras.

    python venv_size.py VENV FREEZE

Per-distribution size comes from each dist-info RECORD (files that exist).
"runtime" = total venv size minus the RECORD bytes of distributions that are
not in FREEZE (i.e. what `-e sidecar[dev]` added), so it approximates the
shipped runtime venv.
"""

import re
import sys
from pathlib import Path


def canon(n: str) -> str:
    return re.sub(r"[-_.]+", "-", n).lower()


venv, freeze = Path(sys.argv[1]), Path(sys.argv[2])
frozen = {
    canon(line.split("==")[0].split(" @ ")[0])
    for line in freeze.read_text().splitlines()
    if line.strip()
}
frozen |= {"pip"}
site = venv / "Lib" / "site-packages"
total = sum(f.stat().st_size for f in venv.rglob("*") if f.is_file())
extra = 0
extras = []
for di in site.glob("*.dist-info"):
    name = canon(di.name.split("-", 1)[0])
    if name in frozen:
        continue
    rec = di / "RECORD"
    size = 0
    if rec.exists():
        for line in rec.read_text(encoding="utf-8").splitlines():
            p = (site / line.split(",")[0]).resolve()
            if p.is_file():
                size += p.stat().st_size
    extra += size
    extras.append(name)
torch_dir = sum(f.stat().st_size for f in (site / "torch").rglob("*") if f.is_file())
print(f"total={total} dev_extras={extra} runtime_approx={total - extra} torch_pkg={torch_dir}")
print(
    f"GiB: total={total / 2**30:.2f} runtime_approx={(total - extra) / 2**30:.2f} torch_pkg={torch_dir / 2**30:.2f}"  # noqa: E501
)
print("dev-only dists:", len(extras))
