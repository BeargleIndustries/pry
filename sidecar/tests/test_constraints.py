"""Static checks on the runtime constraints files (T3; non-inference).

The bootstrapper passes `src-tauri/resources/constraints-runtime-<variant>.txt`
as `-c` to every pip step. These tests keep those files well-formed and
consistent with the sidecar package's declared dependencies.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

import pytest
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
from packaging.version import Version

REPO = Path(__file__).resolve().parents[2]
RESOURCES = REPO / "src-tauri" / "resources"
PYPROJECT = REPO / "sidecar" / "pyproject.toml"
VARIANTS = ("cu128", "cu124", "cpu")
# cu128 and cpu are generated from one torch 2.7.1 freeze; cu124 is the legacy
# torch 2.5.1 set for drivers older than 572.30.
TORCH_PUBLIC = {"cu128": "2.7.1", "cpu": "2.7.1", "cu124": "2.5.1"}
BUILD_TOOLS = {"pip", "setuptools", "wheel", "hatchling", "packaging"}
PIN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9.+!_-]+)$")


def load(variant: str) -> dict[str, str]:
    path = RESOURCES / f"constraints-runtime-{variant}.txt"
    pins: dict[str, str] = {}
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = PIN.match(line)
        assert m, f"{path.name}:{n} is not `name==version`: {line!r}"
        name = canonicalize_name(m.group(1))
        assert name not in pins, f"{path.name}:{n} duplicate pin for {name}"
        pins[name] = m.group(2)
    return pins


@pytest.fixture(scope="module", params=VARIANTS)
def variant_pins(request) -> tuple[str, dict[str, str]]:
    return request.param, load(request.param)


def test_every_line_is_an_exact_pin(variant_pins):
    _, pins = variant_pins
    assert len(pins) > 50  # a full freeze, not a stub
    for name, version in pins.items():
        Version(version)  # parses


def test_torch_carries_the_variant_local_tag(variant_pins):
    variant, pins = variant_pins
    torch = Version(pins["torch"])
    assert torch.local == variant, f"torch=={pins['torch']} must be +{variant}"
    assert torch.public == TORCH_PUBLIC[variant]


def test_cu128_and_cpu_match_except_torch():
    a, b = load("cu128"), load("cpu")
    a.pop("torch")
    b.pop("torch")
    assert a == b


def test_cu124_differs_from_cu128_only_in_torch_and_sympy():
    # torch 2.7.1 needs sympy >= 1.13.3; everything else is shared.
    a, b = load("cu124"), load("cu128")
    changed = {k for k in a.keys() | b.keys() if a.get(k) != b.get(k)}
    assert changed == {"torch", "sympy"}


def test_no_build_tools_pinned(variant_pins):
    _, pins = variant_pins
    assert not BUILD_TOOLS & set(pins), "build tools break isolated hatchling builds"


def test_pyarrow_pinned_below_24(variant_pins):
    _, pins = variant_pins
    assert "pyarrow" in pins
    assert Version(pins["pyarrow"]) < Version("24")


def test_sse_starlette_not_in_runtime(variant_pins):
    _, pins = variant_pins
    assert "sse-starlette" not in pins


def test_sidecar_dependencies_satisfiable_by_constraints(variant_pins):
    _, pins = variant_pins
    deps = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))["project"]["dependencies"]
    for dep in deps:
        req = Requirement(dep)
        name = canonicalize_name(req.name)
        assert name in pins, f"{req.name} is a sidecar dependency but has no constraint pin"
        assert req.specifier.contains(pins[name], prereleases=True), (
            f"constraint {name}=={pins[name]} does not satisfy sidecar requirement {dep!r}"
        )
