"""Run sidecar/tests/test_parity.py's recorder but write into OUT_DIR (not the fixtures).

python capture_to.py OUT_DIR    # writes OUT_DIR/parity_<device>.json
"""

import sys
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(repo / "sidecar"))
from tests import test_parity  # noqa: E402

test_parity.FIXTURES = Path(sys.argv[1]).resolve()
sys.exit(test_parity._record())
