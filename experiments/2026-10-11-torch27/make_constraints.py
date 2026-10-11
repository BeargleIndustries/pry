"""Run scripts/freeze_to_constraints.py unchanged, but for the cu128 + cpu variants.

The script hardcodes VARIANTS = ("cu124", "cpu"); this wrapper swaps in
("cu128", "cpu") and writes into OUT_DIR, so nothing in src-tauri/resources
is overwritten.

    python make_constraints.py FREEZE OUT_DIR
"""

import sys
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(repo / "scripts"))
import freeze_to_constraints as f  # noqa: E402

f.VARIANTS = ("cu128", "cpu")
sys.exit(f.main([sys.argv[1], "--out-dir", sys.argv[2]]))
