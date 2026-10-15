"""The recorder's Python check (conftest.python_problem) matches pyproject.toml."""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

from tests.conftest import SUPPORTED_PYTHON, python_problem

PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"


def test_supported_pythons_match_requires_python():
    spec = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))["project"]["requires-python"]
    lo = tuple(int(x) for x in re.search(r">=\s*(\d+)\.(\d+)", spec).groups())
    hi = tuple(int(x) for x in re.search(r"<\s*(\d+)\.(\d+)", spec).groups())
    allowed = tuple((3, m) for m in range(lo[1], hi[1]))
    assert lo[0] == hi[0] == 3
    assert SUPPORTED_PYTHON == allowed


def test_supported_python_passes():
    for v in SUPPORTED_PYTHON:
        assert python_problem((*v, 0)) is None


def test_unsupported_python_gets_a_plain_message_with_the_fix():
    msg = python_problem((3, 14, 2))
    assert msg is not None
    assert "Python 3.14" in msg and "3.11 or 3.12" in msg
    assert "py -3.12 -m venv .venv" in msg and "python3.12 -m venv .venv" in msg
