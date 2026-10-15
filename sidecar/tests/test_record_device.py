"""The recorder's device check (conftest.device_problem): --record runs where Pry runs on this machine."""

from __future__ import annotations

from tests.conftest import device_problem

GPU = "GPU 0: NVIDIA GeForce RTX 4070 SUPER"


def test_cpu_torch_on_a_gpu_machine_stops_with_the_fix():
    msg = device_problem("auto", False, "2.5.1+cpu", GPU)
    assert msg is not None
    assert "RTX 4070 SUPER" in msg and "2.5.1+cpu" in msg
    assert "whl/cu124" in msg and "--device cpu" in msg


def test_auto_passes_where_pry_would_pick_the_same_device():
    assert device_problem("auto", True, "2.5.1+cu124", GPU) is None
    assert device_problem("auto", False, "2.5.1+cpu", None) is None


def test_device_cpu_opts_out():
    assert device_problem("cpu", False, "2.5.1+cpu", GPU) is None


def test_device_cuda_needs_a_cuda_torch():
    assert device_problem("cuda", True, "2.5.1+cu124", GPU) is None
    msg = device_problem("cuda", False, "2.5.1+cpu", GPU)
    assert msg is not None and "--device cuda" in msg
