"""Language-neutral request key (plan T2, R3-12), reproduced in Python.

key = sha256 hex of the UTF-8 canonical JSON of {endpoint, model, body}, the
same rule as ui/src/lib/lessons/registry/request-key.ts. test_lessons.py names
its recorded files with ``request_key``; this file checks it against every
vector in fixtures/request-keys.json.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import pytest

VECTORS = Path(__file__).resolve().parent / "fixtures" / "request-keys.json"


def _js_number(x: float) -> str:
    """A finite non-integral float laid out as ECMAScript Number::toString does."""
    r = repr(x)
    sign = "-" if r.startswith("-") else ""
    r = r.lstrip("-")
    mant, _, exp = r.partition("e")
    ip, _, fp = mant.partition(".")
    digits = (ip + fp).lstrip("0")
    # value = 0.digits * 10**n, i.e. n = position of the decimal point
    lead_zeros = len(ip + fp) - len((ip + fp).lstrip("0"))
    n = len(ip) - lead_zeros + (int(exp) if exp else 0)
    digits = digits.rstrip("0") or "0"
    k = len(digits)
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        out = digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return sign + out


def canonical_json(value) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"request key: non-finite number {value}")
        if value == int(value):
            return str(int(value))
        return _js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value)  # Python orders str by code point
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canonical_json(value[k]) for k in keys) + "}"
    raise TypeError(f"request key: unsupported value of type {type(value).__name__}")


def canonical_request(endpoint: str, model: str, body) -> str:
    return canonical_json({"endpoint": endpoint, "model": model, "body": body})


def request_key(endpoint: str, model: str, body) -> str:
    return hashlib.sha256(canonical_request(endpoint, model, body).encode("utf-8")).hexdigest()


def _vectors():
    return json.loads(VECTORS.read_text(encoding="utf-8"))["vectors"]


def test_reproduces_every_vector_in_request_keys_json():
    vectors = _vectors()
    assert len(vectors) >= 12
    for v in vectors:
        assert canonical_request(v["endpoint"], v["model"], v["body"]) == v["canonical"], v["name"]
        assert request_key(v["endpoint"], v["model"], v["body"]) == v["key"], v["name"]


@pytest.mark.parametrize(
    ("x", "js"),
    [(0.5, "0.5"), (0.00001, "0.00001"), (1e-7, "1e-7"), (1.5e-10, "1.5e-10"), (123.456, "123.456"), (0.000001, "0.000001"), (-0.25, "-0.25")],
)
def test_floats_use_the_ecmascript_layout(x, js):
    assert canonical_json(x) == js
