"""Neuronpedia snippets arrive as GPT-2 byte-level BPE strings; decode them."""

from __future__ import annotations

from unittest.mock import patch

from pry_sidecar import inference
from pry_sidecar.inference import decode_bpe_bytes


def test_space_marker():
    assert decode_bpe_bytes("ĠThe") == " The"


def test_mojibake_apostrophe():
    assert decode_bpe_bytes("ĠdonâĢĻt") == " don’t"


def test_newline_marker():
    assert decode_bpe_bytes("ĊSeveral") == "⏎Several"


def test_plain_ascii_unchanged():
    assert decode_bpe_bytes("Hello, world! 123") == "Hello, world! 123"


def test_non_gpt2_text_unchanged():
    assert decode_bpe_bytes("naïve 日本語") == "naïve 日本語"


def test_multibyte_cjk():
    raw = "日本".encode("utf-8")
    enc = "".join({v: k for k, v in inference._GPT2_U2B.items()}[b] for b in raw)
    assert decode_bpe_bytes(enc) == "日本"


def test_invalid_utf8_replaced():
    # space marker then a lone UTF-8 lead byte 0xC3
    assert decode_bpe_bytes("ĠÃ") == " �"


def test_snippet_rendered():
    data = {"activations": [{"maxValue": 3, "tokens": ["Ċ", "Several", "Ġpeople", "Ġdonâ", "ĢĻ", "t"]}]}
    with patch.object(inference, "_fetch_raw", return_value=data):
        out = inference.fetch_top_activating_snippets.__wrapped__("m", "r", 1) if hasattr(
            inference.fetch_top_activating_snippets, "__wrapped__"
        ) else inference.fetch_top_activating_snippets("m", "r", 1)
    assert out == ("⏎Several people don’t",)
