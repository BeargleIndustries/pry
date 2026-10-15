"""Verified rows for Pry's lessons, recorded through Pry's own sidecar (plan T6a).

    pytest tests/test_lessons.py --record            # re-record every row
    pytest tests/test_lessons.py --record --diff     # ...and write a diff report
    pytest tests/test_lessons.py                     # drift mode: replay and compare
    pytest tests/test_lessons.py --network           # drift mode, Neuronpedia strings too
    pytest tests/test_lessons.py --record --from-lessons   # also lesson requests (T6)
    pytest tests/test_lessons.py --record --lesson-dir ../docs/lessons/examples/community-sample
                     # only a lesson set outside the app (its __generated__/expectations.json);
                     # responses go to <set>/__generated__/responses/, and a Neuronpedia
                     # lookup (/concept-search) is sent only with --network as well

Requests come from ui/src/lessons/__generated__/row-requests.json, written by
`npm run lessons:compile -- --rows` from verified-rows.yaml through the app's
own body builders. Each response is stored under its request key
(test_request_key.py) as responses/<key>.json, repeats as <key>.r<n>.json and
the network-blocked run as <key>.offline.json, with the model revision, device,
library versions and record date inside. rows.json holds each row's recorded
values, its status and a hash of the sidecar's git-tracked source and
requirements. GPT-2 small runs on the device the registry picks, the same probe
the app uses (CUDA when torch can use the GPU), with BOS prepended as Pry does.
--record stops when torch is a CPU build on a machine with an NVIDIA GPU, since
Pry runs on CUDA there; `--device cpu` records on the CPU anyway and
`--device cuda` insists on the GPU (conftest.device_problem). Skips cleanly when
GPT-2 small isn't in the HF cache.

Drift tolerances (plan T6a): tokens and strings exact; probabilities (and
attention weights, shares, cosines) within 0.02; logits and other floats within
0.05; layers and other integers exact; seeded sampling tokens exact only when the
device class matches the recorded one, otherwise a warning (inference.py:127-131
notes CPU and CUDA draw different numbers from the same seed).
"""

from __future__ import annotations

import contextlib
import datetime as _dt
import hashlib
import json
import platform
import random
import socket
import subprocess
import warnings
from pathlib import Path

import pytest

from tests.conftest import LESSON_DIR_SUMMARY
from tests.test_request_key import request_key

REPO = Path(__file__).resolve().parents[2]
GEN = REPO / "ui" / "src" / "lessons" / "__generated__"
RESPONSES = GEN / "responses"
ROW_REQUESTS = GEN / "row-requests.json"
ROWS_JSON = GEN / "rows.json"
EXPECTATIONS = GEN / "expectations.json"
DIFF_REPORT = GEN / "record-diff.md"

# Files whose change can move a recorded number (plan C4-8). responses.test.ts
# hashes the same list the same way.
HASH_PATHSPECS = [
    "sidecar/pry_sidecar",
    "sidecar/pyproject.toml",
    "src-tauri/resources/requirements-runtime.txt",
    "src-tauri/resources/constraints-runtime-*.txt",
]

LABEL_FIELDS = {"description", "label_detail", "confidence", "top_activating_snippets"}
PROB_HINTS = ("prob", "share", "heads", "cosine", "attention")
# Ranked lists (peak cells, top parts, top features, top-k predictions) are matched
# item by item on the first of these fields every entry has.
ORDER_KEYS = ("name", "id", "token")
BOS = "<|endoftext|>"
# Endpoints whose whole answer is a Neuronpedia lookup (search_concepts).
NETWORK_ONLY = {"/concept-search"}


def _load_row_requests():
    if not ROW_REQUESTS.exists():
        return None
    return json.loads(ROW_REQUESTS.read_text(encoding="utf-8"))


ROWDOC = _load_row_requests()
ROW_IDS = [r["id"] for r in ROWDOC["rows"]] if ROWDOC else []


# ---------------------------------------------------------------------------
# Sidecar hash (C4-8)
# ---------------------------------------------------------------------------


def sidecar_hash() -> tuple[str, int] | None:
    """sha256 over sorted 'path\\0sha256(LF-normalised bytes)\\n' lines of the tracked files."""
    try:
        out = subprocess.run(
            ["git", "ls-files", "--", *HASH_PATHSPECS],
            cwd=REPO, capture_output=True, text=True, check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    paths = sorted(p for p in out.splitlines() if p.strip())
    h = hashlib.sha256()
    for p in paths:
        data = (REPO / p).read_bytes().replace(b"\r\n", b"\n")
        h.update(p.encode("utf-8") + b"\0" + hashlib.sha256(data).hexdigest().encode("ascii") + b"\n")
    return h.hexdigest(), len(paths)


# ---------------------------------------------------------------------------
# Calling the sidecar
# ---------------------------------------------------------------------------


@contextlib.contextmanager
def _neuronpedia(enabled: bool):
    """Real Neuronpedia lookups when enabled, else the same stub conftest's no_neuronpedia uses."""
    from pry_sidecar import inference

    saved = (inference.fetch_feature_description, inference.fetch_top_activating_snippets)
    if not enabled:
        inference.fetch_feature_description = lambda *a, **k: (None, "none")
        inference.fetch_top_activating_snippets = lambda *a, **k: ()
    try:
        yield
    finally:
        inference.fetch_feature_description, inference.fetch_top_activating_snippets = saved


@contextlib.contextmanager
def _offline():
    """Block every connection that isn't loopback (the TestClient's own event loop uses loopback)."""
    real = socket.socket.connect
    attempts: list = []

    def guarded(self, address, *a, **k):
        host = address[0] if isinstance(address, tuple) else address
        if host in ("127.0.0.1", "::1", "localhost"):
            return real(self, address, *a, **k)
        attempts.append(address)
        raise OSError(f"network blocked by test_lessons offline run: {address!r}")

    socket.socket.connect = guarded
    try:
        yield attempts
    finally:
        socket.socket.connect = real


def _strip(obj):
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in obj.items() if k != "timing_ms"}
    if isinstance(obj, list):
        return [_strip(v) for v in obj]
    return obj


def _trim(endpoint: str, resp: dict) -> tuple[dict, list[str]]:
    """Keep files small: /generate attention keeps each head's last query row only.

    Earlier rows become null, so the last row keeps its real index: a lesson reading
    attention FROM the last token (`from: <last position>`) gets the recorded row, and
    a read from any other position comes back undefined, never a wrong row.
    """
    trimmed = []
    if endpoint == "/generate" and resp.get("attention"):
        for layer in resp["attention"]:
            layer["heads"] = [[None] * (len(h) - 1) + h[-1:] for h in layer["heads"]]
        trimmed.append("attention: each head's last query row only (earlier rows null)")
    return resp, trimmed


def _libs() -> dict:
    from importlib.metadata import PackageNotFoundError, version

    out = {"python": platform.python_version()}
    for name in ("torch", "transformer_lens", "sae_lens", "transformers", "numpy"):
        try:
            out[name] = version(name)
        except PackageNotFoundError:
            out[name] = None
    return out


def _device_class(device: str | None) -> str:
    return (device or "cpu").split(":")[0]


def _file(key: str, variant: str, folder: Path = RESPONSES) -> Path:
    if variant == "r1":
        return folder / f"{key}.json"
    return folder / f"{key}.{variant}.json"


class Session:
    def __init__(self, client, loaded, record: bool, network: bool, diff: bool):
        self.client = client
        self.loaded = loaded
        self.record = record
        self.network = network
        self.diff = diff
        self.calls: dict[str, int] = {}
        self.responses: dict[tuple[str, str], dict] = {}  # (key, variant) -> response used by checks
        self.problems: dict[tuple[str, str], list[str]] = {}
        self.warnings: dict[tuple[str, str], list[str]] = {}
        self.diff_lines: list[str] = []
        self.device = str(getattr(loaded, "device", "cpu"))
        self.revision = getattr(loaded, "model_revision", None)
        self.today = _dt.date.today().isoformat()
        self.libs = _libs()
        self.lesson_dir: str | None = None
        # --lesson-dir: the set's own <set>/__generated__/responses/, committed beside its lessons.
        self.responses_dir: Path = RESPONSES
        self.recorded: list[str] = []
        self.not_sent: list[str] = []

    def call(self, req: dict, variant: str) -> None:
        key, endpoint, body = req["key"], req["endpoint"], req["body"]
        model = ROWDOC["model"]
        assert request_key(endpoint, model, body) == key, f"request key mismatch for {req['name']}"
        labels = req["network"] and (self.record or self.network)
        guard = _offline() if variant == "offline" else contextlib.nullcontext([])
        with _neuronpedia(labels), guard as blocked:
            # GET /feature/{id} (featureInfo) takes no body; every other endpoint is a POST.
            r = self.client.get(endpoint) if endpoint.startswith("/feature/") else self.client.post(endpoint, json=body)
        self.calls[key] = self.calls.get(key, 0) + 1
        if variant == "offline":
            assert not blocked, f"offline run tried the network: {blocked}"
        assert r.status_code == 200, f"{req['name']} {endpoint}: {r.status_code} {r.text[:300]}"
        resp, trimmed = _trim(endpoint, _strip(r.json()))
        path = _file(key, variant, self.responses_dir)
        if self.record:
            if self.diff and path.exists():
                old = json.loads(path.read_text(encoding="utf-8"))
                d, _ = compare(old["response"], resp, body, old.get("device"), self.device, compare_labels=True)
                if d:
                    self.diff_lines.append(f"## {req['name']} ({path.name})\n" + "\n".join(f"- {x}" for x in d[:40]))
            doc = {
                "key": key,
                "variant": variant,
                "request": {"endpoint": endpoint, "model": model, "body": body},
                "model_revision": self.revision,
                "device": self.device,
                "libs": self.libs,
                "recorded": self.today,
                "neuronpedia_fetched": self.today if labels else None,
                "offline": variant == "offline",
                "trimmed": trimmed,
                "response": resp,
            }
            self.responses_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            self.recorded.append(f"{endpoint} -> {path}")
            self.responses[(key, variant)] = resp
            return
        if not path.exists():
            self.problems[(key, variant)] = [f"no recorded response {path.name}: run with --record"]
            self.responses[(key, variant)] = resp
            return
        old = json.loads(path.read_text(encoding="utf-8"))
        probs: list[str] = []
        if old.get("model_revision") != self.revision:
            probs.append(f"revision changed: recorded {old.get('model_revision')}, now {self.revision}")
        d, w = compare(old["response"], resp, body, old.get("device"), self.device, compare_labels=self.network or not req["network"])
        probs += d
        if probs:
            self.problems[(key, variant)] = probs
        if w:
            self.warnings[(key, variant)] = w
        # Strings fetched from Neuronpedia stay as recorded unless --network refetched them.
        self.responses[(key, variant)] = old["response"] if (req["network"] and not self.network) else resp


def variants_of(req: dict) -> list[str]:
    if req.get("offline"):
        return ["offline"]
    return ["r1"] + [f"r{i}" for i in range(2, int(req.get("repeat", 1)) + 1)]


def _tol(p: str) -> float:
    return 0.02 if any(h in p.lower() for h in PROB_HINTS) else 0.05


def _order_key(a: list, b: list, p: str) -> str | None:
    """The field a ranked list is keyed on, when a and b hold the same items (each key once).

    Token sequences (generation steps) never qualify: their order is the answer."""
    if "generation" in p or not a or len(a) != len(b):
        return None
    for k in ORDER_KEYS:
        if all(isinstance(x, dict) and k in x for x in a + b):
            ka, kb = [x[k] for x in a], [x[k] for x in b]
            try:
                same = len(set(ka)) == len(ka) and set(ka) == set(kb)
            except TypeError:
                return None
            return k if same else None
    return None


def _near_tie(x: dict, y: dict, p: str) -> bool:
    """Every float the two recorded items share differs by less than its tolerance."""
    for f in set(x) & set(y):
        u, v = x[f], y[f]
        if isinstance(u, bool) or isinstance(v, bool) or not isinstance(u, (int, float)) or not isinstance(v, (int, float)):
            continue
        if not (isinstance(u, float) or isinstance(v, float)):
            continue  # layers, heads, positions, ids: integers, not values
        if abs(float(u) - float(v)) >= _tol(f"{p}.{f}"):
            return False
    return True


def compare(old, new, body, old_device, new_device, compare_labels=True, path="response"):
    """(problems, warnings) between a recorded and a fresh response, with the plan's tolerances.

    A ranked list compares as the same set of items by key, each value within tolerance;
    two items may trade places only when their recorded values are a near tie (every
    shared float closer than its tolerance). A new item, a lost item, or a swap of
    items that are not tied is a problem."""
    diffs: list[str] = []
    warns: list[str] = []
    seeded = bool(body.get("temperature", 0)) and body.get("seed") is not None if isinstance(body, dict) else False
    same_device = _device_class(old_device) == _device_class(new_device)

    def walk(a, b, p):
        if isinstance(a, dict) and isinstance(b, dict):
            for k in sorted(set(a) | set(b)):
                if k in LABEL_FIELDS and not compare_labels:
                    continue
                if k not in a or k not in b:
                    diffs.append(f"{p}.{k}: {'missing now' if k not in b else 'new field'}")
                    continue
                walk(a[k], b[k], f"{p}.{k}")
            return
        if isinstance(a, list) and isinstance(b, list):
            if len(a) != len(b):
                out = warns if (seeded and not same_device and "generation" in p) else diffs
                out.append(f"{p}: length {len(a)} -> {len(b)}")
                return
            k = _order_key(a, b, p)
            if k is not None and [x[k] for x in a] != [y[k] for y in b]:
                at = {y[k]: j for j, y in enumerate(b)}
                for i, x in enumerate(a):
                    for y in a[i + 1:]:
                        if at[x[k]] > at[y[k]] and not _near_tie(x, y, p):
                            diffs.append(f"{p}: {x[k]!r} and {y[k]!r} swapped places but are not a near tie")
                for i, x in enumerate(a):
                    y = b[at[x[k]]]
                    if at[x[k]] != i:  # rank follows the place, already checked above
                        x = {f: v for f, v in x.items() if f != "rank"}
                        y = {f: v for f, v in y.items() if f != "rank"}
                    walk(x, y, f"{p}[{k}={a[i][k]!r}]")
                return
            for i, (x, y) in enumerate(zip(a, b)):
                walk(x, y, f"{p}[{i}]")
            return
        if isinstance(a, bool) or isinstance(b, bool) or isinstance(a, str) or isinstance(b, str) or a is None or b is None:
            if a != b:
                out = warns if (seeded and not same_device and "generation" in p) else diffs
                out.append(f"{p}: {a!r} -> {b!r}")
            return
        if isinstance(a, int) and isinstance(b, int):
            if a != b:
                out = warns if (seeded and not same_device and "generation" in p) else diffs
                out.append(f"{p}: {a} -> {b}")
            return
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            tol = _tol(p)
            if abs(float(a) - float(b)) > tol:
                diffs.append(f"{p}: {a} -> {b} (tolerance {tol})")
            return
        diffs.append(f"{p}: type {type(a).__name__} -> {type(b).__name__}")

    walk(old, new, path)
    return diffs, warns


# ---------------------------------------------------------------------------
# The session: every row's requests, recorded or replayed once
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def lessons(request):
    if ROWDOC is None:
        pytest.skip("no row-requests.json: run `npm run lessons:compile -- --rows` in ui/")
    from tests.conftest import _hf_cached

    if not _hf_cached("gpt2"):
        pytest.skip("GPT-2 small not in the local HF cache: lesson rows not run (skipped)")
    loaded = request.getfixturevalue("gpt2_loaded")
    from starlette.testclient import TestClient

    from pry_sidecar.main import app

    record = request.config.getoption("--record")
    s = Session(None, loaded, record, request.config.getoption("--network"), request.config.getoption("--diff"))
    lesson_dir = request.config.getoption("--lesson-dir")
    with TestClient(app) as client:
        s.client = client
        if lesson_dir:
            s.lesson_dir = lesson_dir
            # A lesson set outside the app: its own requests only; rows and rows.json untouched.
            expectations = _lesson_dir_expectations(lesson_dir)
            s.responses_dir = expectations.parent / "responses"
            _lesson_requests(s, set(), expectations)
            return s
        seen: dict[tuple[str, str], dict] = {}
        for row in ROWDOC["rows"]:
            for req in row["requests"]:
                for v in variants_of(req):
                    k = (req["key"], v)
                    if k in seen:
                        # Same request in two rows: one call; labels if either row wants them.
                        if req["network"] and not seen[k]["network"]:
                            seen[k] = req
                        continue
                    seen[k] = req
        for (key, v), req in seen.items():
            s.call(req, v)
        if request.config.getoption("--from-lessons") and EXPECTATIONS.exists():
            _lesson_requests(s, {k for k, _ in seen})
    if record and s.diff:
        DIFF_REPORT.write_text("# Record diff (test_lessons.py --record --diff)\n\n" + ("\n\n".join(s.diff_lines) or "No differences.") + "\n", encoding="utf-8")
    return s


def _lesson_dir_expectations(lesson_dir: str) -> Path:
    """--lesson-dir: <set>/__generated__/expectations.json, where <set> is the folder, or its parent when it holds lesson.md."""
    root = Path(lesson_dir).resolve()
    if (root / "lesson.md").exists():
        root = root.parent
    path = root / "__generated__" / "expectations.json"
    if not path.exists():
        pytest.fail(f"no {path}: run `npm run lessons:compile -- --expectations --dir {lesson_dir}` in ui/ first")
    return path


def _lesson_requests(s: Session, covered: set[str], path: Path = EXPECTATIONS) -> None:
    """--from-lessons / --lesson-dir: record (or replay) lesson requests from an expectations.json not already covered.

    Expects expectations.json to list requests as {"requests": [{"endpoint", "model", "body"}]}.
    """
    doc = json.loads(path.read_text(encoding="utf-8"))
    for item in doc.get("requests", []):
        key = request_key(item["endpoint"], item.get("model", ROWDOC["model"]), item["body"])
        if key in covered:
            continue
        covered.add(key)
        req = {"name": f"lesson:{key[:8]}", "key": key, "endpoint": item["endpoint"], "body": item["body"], "network": False}
        # A lesson set outside the app records and replays offline unless --network: a Neuronpedia
        # lookup sends its text to www.neuronpedia.org, so it's left as it is.
        if item["endpoint"] in NETWORK_ONLY and s.lesson_dir and not s.network:
            path = _file(key, "r1", s.responses_dir)
            s.not_sent.append(f"{item['endpoint']} {json.dumps(item['body'])} ({'kept ' + path.name if path.exists() else 'not recorded'})")
            if path.exists():
                s.responses[(key, "r1")] = json.loads(path.read_text(encoding="utf-8"))["response"]
            s.calls[key] = s.calls.get(key, 0)
            continue
        if item["endpoint"] in NETWORK_ONLY and not (s.record or s.network):
            # The whole answer comes from Neuronpedia: drift mode keeps the record unless --network.
            path = _file(key, "r1", s.responses_dir)
            if path.exists():
                s.responses[(key, "r1")] = json.loads(path.read_text(encoding="utf-8"))["response"]
                s.calls[key] = s.calls.get(key, 0)
            else:
                s.problems[(key, "r1")] = [f"no recorded response {path.name}: run with --record"]
            continue
        s.call(req, "r1")


def _row(row_id: int) -> dict:
    return next(r for r in ROWDOC["rows"] if r["id"] == row_id)


def _views(s: Session, row: dict):
    """name -> first response, name -> all repeats, name -> offline response."""
    first, reps, offline = {}, {}, {}
    for req in row["requests"]:
        vs = variants_of(req)
        if vs == ["offline"]:
            offline[req["name"]] = s.responses[(req["key"], "offline")]
            continue
        first[req["name"]] = s.responses[(req["key"], "r1")]
        reps[req["name"]] = [s.responses[(req["key"], v)] for v in vs]
    return first, reps, offline


# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------


def toks(r):
    return [t["text"] for t in r["tokens"]]


def top(r, n=4):
    return [(p["token"], p["probability"], p.get("logit")) for p in r["top_predictions"][:n]]


def prob(r, tok):
    return next((p["probability"] for p in r["top_predictions"] if p["token"] == tok), None)


def pct(x):
    return None if x is None else round(100 * x, 1)


def expect_top(r, pairs) -> bool:
    got = top(r, len(pairs))
    return [g[0] for g in got] == [t for t, _ in pairs] and all(abs(100 * g[1] - v) < 0.1 for g, (_, v) in zip(got, pairs))


def cont(r):
    gen, prompt = r["generation"] or "", r["prompt"]
    return gen[len(prompt):] if gen.startswith(prompt) else gen


def lens_col(r):
    return [(li, row[-1]["predicted_token"], row[-1]["probability"]) for li, row in enumerate(r["grid"])]


def dla_top(r, n=3):
    return [(c["name"], c["contribution"]) for c in sorted(r["components"], key=lambda c: -c["contribution"])[:n]]


def abl(r, tok):
    """(before, after, delta) for tok; after None when it left the ablated top ten."""
    o = next((p["probability"] for p in r["original_predictions"] if p["token"] == tok), None)
    a = next((p["probability"] for p in r["ablated_predictions"] if p["token"] == tok), None)
    return o, a, (None if o is None or a is None else a - o)


def feats_at(r, pos):
    return next(t["top_k"] for t in r["sae_features"] if t["token_index"] == pos)


def cell(r, c):
    return {
        "name": c["name"], "layer": c["layer"], "head": c.get("head"), "position": c.get("position"),
        "word": (r["tokens"][c["position"]] if c.get("position") is not None else None),
        "clean": c["clean_logit"], "corrupted": c["corrupted_logit"], "patched": c["patched_logit"], "share": c.get("share"),
    }


def patch_peak(r, n=1):
    cs = sorted(r["components"], key=lambda c: -(c["share"] if c.get("share") is not None else -1e9))
    return [cell(r, c) for c in cs[:n]]


def per_layer_peak(r):
    by: dict[int, list] = {}
    for c in r["components"]:
        by.setdefault(c["layer"], []).append(c)
    return {L: r["tokens"][max(v, key=lambda c: c["share"] if c.get("share") is not None else -1e9)["position"]] for L, v in sorted(by.items())}


def last_attn(r, layer, head):
    return r["attention"][layer]["heads"][head][-1]


def steer_view(s, word=None):
    c = s["control"] or {}
    out = {
        "feature_id": s["feature_id"], "strength": s["alpha"],
        "original": s["original_generation"], "steered": s["steered_generation"], "control_text": c.get("generation"),
        "changed_tokens": len(s["changed_token_indices"]), "control_changed_tokens": len(c.get("changed_token_indices", [])),
        "coherence": s["coherence"], "control_coherence": c.get("coherence"), "scale": s["scale"],
        "control_id": c.get("feature_id"), "control_method": c.get("method"),
        "decoder_norm_target": c.get("steered_decoder_norm"), "decoder_norm_control": c.get("decoder_norm"), "cosine": c.get("cosine"),
    }
    if word:
        out["word"] = word
        out["word_in"] = {k: (out[k] or "").lower().count(word) for k in ("original", "steered", "control_text")}
    return out


def heads_of(circuit):
    return sorted((n["layer"], n["head"]) for n in circuit["nodes"] if n["type"] == "attention")


# ---------------------------------------------------------------------------
# Row checks: (recorded values, [(claim part, holds)])
# ---------------------------------------------------------------------------


def _top_row(R, name, pairs, extra=None):
    r = R[name]
    v = {"top4": top(r), "top10_total": sum(p["probability"] for p in r["top_predictions"]), "tokens": len(r["tokens"])}
    return v, [("top 4 as the lesson quotes", expect_top(r, pairs))] + (extra or [])


def check(row_id, R, REP, OFF):
    c = CHECKS.get(row_id)
    return c(R, REP, OFF) if c else ({}, [])


def c1(R, REP, OFF):
    return _top_row(R, "jordan", [(" basketball", 42.2), (" football", 4.7), (" golf", 4.1), (" the", 2.1)])


def c2(R, REP, OFF):
    r = R["france"]
    v, ch = _top_row(R, "france", [(" now", 4.8), (" the", 3.7), (" a", 3.5), (" home", 3.1)])
    v["top4_total"] = sum(p for _, p, _ in top(r))
    v["paris"] = prob(r, " Paris")
    v["paris_rank"] = next((p["rank"] for p in r["top_predictions"] if p["token"] == " Paris"), "not in the top ten")
    ch += [("top four hold 15.1%", abs(100 * v["top4_total"] - 15.1) < 0.15), ('" Paris" not in the top four', " Paris" not in [t for t, _, _ in top(r)])]
    return v, ch


def c3(R, REP, OFF):
    return _top_row(R, "city", [(" Paris", 9.7), (" Marse", 8.9), (" Saint", 3.1), (" St", 2.8)])


def c4(R, REP, OFF):
    v, ch = _top_row(R, "twoplustwo", [(" one", 34.2), (" two", 16.2), (" four", 7.0), (" three", 6.9)])
    lg = {p["token"]: p["logit"] for p in R["twoplustwo"]["top_predictions"]}
    v["logit_one"], v["logit_four"] = lg.get(" one"), lg.get(" four")
    return v, ch


def c5(R, REP, OFF):
    return _top_row(R, "myth", [(" brains", 12.7), (" energy", 11.5), (" body", 10.3), (" bodies", 7.3)])


def c6(R, REP, OFF):
    a, b = toks(R["unbelievable"]), toks(R["leclerc"])
    return {"unbelievable": a, "leclerc": b}, [
        ('" unbelievable" is one token', a == [BOS, " unbelievable"]),
        ('" Leclerc" is " Le", "cl", "erc"', b == [BOS, " Le", "cl", "erc"]),
    ]


def c7(R, REP, OFF):
    import numpy as np

    def vecs(name):
        p = R[name]["positions"][0]
        return np.array(p["embed"]), np.array(p["pos_embed"]), p["token"]

    er, pr, tr = vecs("river")
    em, pm, tm = vecs("money")
    eb, pb, tb = vecs("thebank")
    sr, sb = er + pr, eb + pb
    cos = float(sr @ sb / np.linalg.norm(sr) / np.linalg.norm(sb))
    v = {
        "tokens": [tr, tm, tb], "dims": int(er.size),
        "embed_match_river_money": int((er == em).sum()), "pos_match_river_money": int((pr == pm).sum()),
        "embed_match_pos5_pos2": int((er == eb).sum()), "pos_match_pos5_pos2": int((pr == pb).sum()),
        "summed_cosine_pos5_pos2": cos, "summed_match_pos5_pos2": int((sr == sb).sum()),
    }
    return v, [
        ("embedding identical at position 5 in both sentences", v["embed_match_river_money"] == 768 and v["pos_match_river_money"] == 768),
        ("position 2 vs 5: embedding identical, positional embedding different", v["embed_match_pos5_pos2"] == 768 and v["pos_match_pos5_pos2"] < 768),
        ("summed similarity 0.957", round(cos, 3) == 0.957),
    ]


HF = {
    "baker": " was a great friend of mine. He was a great friend of mine, and",
    "mit": ' of this software and associated documentation files (the "Software"), to deal in the',
    "truths": " created equal, that every man is endowed by his Creator with certain unalienable",
    "poem": "\n\nWrite a short poem about the sea.\n\nWrite a short poem about the sea.",
    "poemdoc": "\nThe sea is a sea of water\n\nAnd the sea is a sea",
}


def _write_row(R, name):
    r = R[name]
    return {"continuation": cont(r), "new_tokens": len(r["generation_steps"])}, [
        ("continuation matches the HF greedy text", cont(r).startswith(HF[name])),
    ]


def c8(R, REP, OFF):
    return _write_row(R, "baker")


def c9(R, REP, OFF):
    return _write_row(R, "mit")


def c10(R, REP, OFF):
    return _write_row(R, "truths")


def c11(R, REP, OFF):
    return _write_row(R, "poem")


def c12(R, REP, OFF):
    return _write_row(R, "poemdoc")


def c13(R, REP, OFF):
    a, b = cont(R["question"]), cont(R["qa"])
    return {"question": a, "qa": b}, [('both answer "Paris"', "Paris" in a and "Paris" in b)]


def c14(R, REP, OFF):
    v, ch = _top_row(R, "ioi", [(" Mary", 67.7), (" them", 12.8), (" the", 4.8), (" John", 2.3)])
    return v, ch + [("15 tokens", v["tokens"] == 15)]


def c15(R, REP, OFF):
    return _top_row(R, "pip", [(" Qu", 31.9), (" the", 1.7), (" Z", 1.6), (" Q", 0.9)])


def c16(R, REP, OFF):
    return _top_row(R, "pipyellow", [(" Qu", 11.6), (" the", 1.7), (" Z", 1.5), (" D", 1.1)])


def c17(R, REP, OFF):
    n, d = R["nurse"], R["doctor"]
    return {"nurse_top4": top(n), "doctor_top4": top(d)}, [
        ("nurse top 3", expect_top(n, [(" she", 19.0), (" the", 8.1), (" her", 5.5)])),
        ("doctor top 3", expect_top(d, [(" he", 14.5), (" the", 10.5), (" she", 4.6)])),
    ]


def c18(R, REP, OFF):
    v, ch = _top_row(R, "brady", [(" football", 48.6), (" the", 3.0), (" basketball", 2.3)])
    v["top4_total"] = sum(p for _, p, _ in top(R["brady"]))
    v["jordan_tokens"] = len(R["jordan"]["tokens"])
    return v, ch + [("same token count as row 1", v["tokens"] == v["jordan_tokens"])]


def c19(R, REP, OFF):
    r = R["war1732"]
    return _top_row(R, "war1732", [("49", 5.8), ("50", 5.1), ("45", 3.4), ("43", 3.2)], [
        ("top 4 all above 32", all(t.strip().isdigit() and int(t) > 32 for t, _, _ in top(r))),
    ])


def _lens_story(r, answer):
    col = lens_col(r)
    tops = [li for li, t, _ in col if t == answer]
    first = tops[0] if tops else None
    peak = max((x for x in col if x[1] == answer), key=lambda x: x[2], default=None)
    return {"column": [(f"L{li}", t, p) for li, t, p in col], "first_top": first, "peak": peak, "final": col[-1]}


def c20(R, REP, OFF):
    j = _lens_story(R["lensjordan"], " basketball")
    m = _lens_story(R["lensmary"], " Mary")
    n = _lens_story(R["lensnurse"], " she")
    return {"jordan": j, "mary": m, "nurse": n}, [
        ("Jordan tops at L8 (42%)", j["first_top"] == 8 and round(100 * j["column"][8][2]) == 42),
        ("Jordan peaks at L9 (93%)", j["peak"][0] == 9 and round(100 * j["peak"][2]) == 93),
        ("Jordan ends at 42% at L11", round(100 * j["final"][2], 1) == 42.2),
        ("Mary tops at L9 (99.8%)", m["first_top"] == 9 and round(100 * m["column"][9][2], 1) == 99.8),
        ("Mary ends at 67.7%", round(100 * m["final"][2], 1) == 67.7),
        ('nurse " she" tops at L10 (41%)', n["first_top"] == 10 and round(100 * n["column"][10][2]) == 41),
        ("nurse ends at 19%", round(100 * n["final"][2]) == 19),
    ]


RHYMES = {"rabbit": " rabbit", "still": " still", "pane": " pane", "book": " book"}


def c21(R, REP, OFF):
    v, mid = {}, []
    for name, word in RHYMES.items():
        col = lens_col(R[name])
        v[name] = {"rhyme": word, "column": [(f"L{li}", t, p) for li, t, p in col]}
        mid.append(any(t == word for li, t, _ in col[:-1]))
    v["rhyme_on_top_mid_stack"] = dict(zip(RHYMES, mid))
    # Brad 2026-10-14: "to read a" predicts " book" with or without a rhyme, so
    # the book prompt is never counted as lookahead.
    rhymes = [m for name, m in zip(RHYMES, mid) if name != "book"]
    return v, [("lookahead not visible: no rhyme prompt shows its rhyme word on top before L11 (book prompt not counted)", not any(rhymes))]


def c22(R, REP, OFF):
    r = R["dlajordan"]
    t3 = dla_top(r)
    return {"top3": t3, "bars_total": r["bars_total"], "actual": r["actual"], "gap": r["gap"], "answer": r["answer_token"]}, [
        ("MLPs appear among the top 3", any(n.startswith("MLP") for n, _ in t3)),
    ]


def c23(R, REP, OFF):
    r = R["ioi"]
    T = toks(r)
    ranked = []
    for lay in r["attention"]:
        for h, rows in enumerate(lay["heads"]):
            row = rows[-1]
            j = max(range(1, len(row)), key=lambda k: row[k])
            ranked.append((row[j], lay["layer"], h, j))
    ranked.sort(reverse=True)
    deltas = {}
    for name in ("L4H11", "L10H7", "L2H8"):
        deltas[name] = abl(R[name], " Mary")[2]
    pick = None
    for w, l, h, j in ranked:
        name = f"L{l}H{h}"
        if name not in deltas:
            break
        if deltas[name] is not None and abs(deltas[name]) < 0.01:
            pick = {"head": name, "token": T[j], "position": j, "weight": w, "delta": deltas[name]}
            break
    v = {"ranked_top3": [(f"L{l}H{h}", T[j], w) for w, l, h, j in ranked[:3]], "deltas": deltas, "pick": pick}
    return v, [("a heavy-line head whose knockout moves p(\" Mary\") under 1 point", pick is not None and pick["head"] == "L2H8")]


def c24(R, REP, OFF):
    f = feats_at(R["nursefeat"], 2)
    ids = [h["id"] for h in f[:3]]
    t = abl(R["top3"], " she")
    c = abl(R["control"], " she")
    labels = {h["id"]: h.get("description") for h in f}
    v = {"sae_layer": R["nursefeat"]["sae_layer_used"], "sae": R["nursefeat"].get("sae"), "top3": ids, "labels": labels,
         "top3_she": t, "control": 7698, "control_label": labels.get(7698), "control_she": c}
    return v, [
        ("top 3 ids at \" nurse\"", ids == [21213, 19093, 821]),
        ("knocking them out lowers \" she\"", t[2] is not None and t[2] < 0),
        ("control is active at \" nurse\"", 7698 in labels),
        ("control moves \" she\" less", c[2] is not None and -c[2] < -t[2]),
    ]


def c25(R, REP, OFF):
    base = R["beachbase"]
    o = steer_view(R["ocean20"], "ocean")
    rn = steer_view(R["rain25"], "rain")
    v = {"base_top4": top(base), "first_pick": o, "target": rn,
         # Neuronpedia labels via GET /feature/{id}, fetched when recorded (the response file holds the date).
         "target_label": R["targetlabel"].get("description"), "control_label": R["controllabel"].get("description")}
    return v, [
        ("unsteered top 4", expect_top(base, [(".", 10.4), (" rise", 4.7), (" breeze", 3.4), (",", 2.9)])),
        ("fallback condition: the ocean target can't beat the control on concept present", o["word_in"]["original"] > 0 and o["word_in"]["control_text"] > 0),
        ("both texts change", rn["steered"] != rn["original"] and rn["control_text"] != rn["original"]),
        ("only the target's text has its label's word", rn["word_in"]["steered"] > 0 and rn["word_in"]["control_text"] == 0 and rn["word_in"]["original"] == 0),
    ]


def c26(R, REP, OFF):
    mv, r3, r1 = abl(R["movers"], " Mary"), abl(R["random3"], " Mary"), abl(R["random1"], " Mary")
    att = last_attn(R["ioi"], 9, 9)
    j = max(range(len(att)), key=lambda k: att[k])
    v = {"movers": mv, "random3": r3, "random1": r1, "L9H9_argmax": toks(R["ioi"])[j], "L9H9_weight_on_mary": att[2]}
    return v, [
        ("name movers drop \" Mary\" more than the random control", mv[2] < r3[2]),
        ("L9H9's lines from \" to\" land on \" Mary\"", j == 2),
    ]


def c27(R, REP, OFF):
    r = R["swapresid"]
    pl = per_layer_peak(r)
    v = {"target": r["target_token"], "clean": r["clean_logit"], "corrupted": r["corrupted_logit"], "peak": patch_peak(r, 3), "per_layer_peak": {f"L{k}": w for k, w in pl.items()}}
    early, late = pl[0], pl[11]
    switch = next((k for k, w in pl.items() if w == " to"), None)
    v["to_takes_over_at"] = switch
    return v, [
        ("pattern (b): swapped name early, \" to\" late", early == " John" and late == " to" and all(w == " John" for k, w in pl.items() if k < switch)),
    ]


def c28(R, REP, OFF):
    v, ch = {}, []
    for name in ("baker", "poem", "poemdoc"):
        texts = [cont(x) for x in REP[name]]
        v[name] = {"continuation": texts[0], "new_tokens": len(REP[name][0]["generation_steps"]), "runs": len(texts)}
        ch.append((f"{name}: matches HF greedy", texts[0].startswith(HF[name])))
        ch.append((f"{name}: repeats identical", len(texts) == 2 and texts[0] == texts[1]))
    return v, ch


def c29(R, REP, OFF):
    a, b = R["samfirst"], R["samsecond"]
    return {"first_top10": top(a, 10), "second_top10": top(b, 10)}, [
        ('" Sam" high in the first', top(a, 1)[0][0] == " Sam"),
        ('" Sam" absent from the second\'s top ten', prob(b, " Sam") is None),
    ]


def c30(R, REP, OFF):
    r = R["tiger"]
    rank = next((p["rank"] for p in r["top_predictions"] if p["token"] == " golf"), None)
    v = {"tokens": toks(r), "count": len(r["tokens"]), "jordan_count": len(R["jordan"]["tokens"]), "top4": top(r), "golf_rank": rank}
    return v, [("fallback condition: a name splits (count differs from row 1)", v["count"] != v["jordan_count"]), ('" golf" on top', rank == 1)]


def c31(R, REP, OFF):
    r = R["maryswap"]
    return {"top4": top(r)}, [('" John" on top', top(r, 1)[0][0] == " John"), ('" Mary" below 10%', (prob(r, " Mary") or 0) < 0.10)]


def c32(R, REP, OFF):
    rr, hh = R["tsresid"], R["tshead"]
    pl = per_layer_peak(rr)
    v = {"clean": rr["clean_logit"], "corrupted": rr["corrupted_logit"], "target": rr["target_token"], "resid_peak": patch_peak(rr, 1)[0],
         "per_layer_peak": {f"L{k}": w for k, w in pl.items()}, "head_max": patch_peak(hh, 3), "tokens": len(R["ts"]["tokens"]), "row14_tokens": len(R["ioi"]["tokens"])}
    return v, [("same token count as row 14", v["tokens"] == v["row14_tokens"])]


def c33(R, REP, OFF):
    v = {"top4": top(R["saturday"]), "greedy": cont(R["saturdaytext"])}
    for n in ("sat20", "sat25", "sat30"):
        v[n] = steer_view(R[n], "rain")
    return v, [("steers recorded with the control", all(R[n]["control"] is not None for n in ("sat20", "sat25", "sat30")))]


def c34(R, REP, OFF):
    r = R["dlacontrast"]
    t3 = dla_top(r)
    return {"top3": t3, "bars_total": r["bars_total"], "actual": r["actual"], "gap": r["gap"]}, [("MLPs appear among the top 3", any(n.startswith("MLP") for n, _ in t3))]


def c35(R, REP, OFF):
    s, m, p = R["serena"], R["murray"], R["mlpmurray"]
    v = {"serena_count": len(s["tokens"]), "serena_tokens": toks(s), "murray_count": len(m["tokens"]), "jordan_count": len(R["jordan"]["tokens"]),
         "murray_top4": top(m), "target": p["target_token"], "mlp_grid": [cell(p, c) for c in sorted(p["components"], key=lambda c: c["layer"])]}
    return v, [
        ("fallback condition: Serena's token count differs", v["serena_count"] != v["jordan_count"]),
        ("replacement has row 1's token count", v["murray_count"] == v["jordan_count"]),
        ('replacement top token " tennis"', top(m, 1)[0][0] == " tennis"),
    ]


def c36(R, REP, OFF):
    r, c, a = R["war1650"], R["circuit1650"], R["maphead"]
    t = top(r)
    return {"top4": t, "nodes": [n["id"] for n in c["nodes"]], "L0H7_on_map": (0, 7) in heads_of(c), "maphead": abl(a, t[0][0]), "top_token": t[0][0]}, [
        ("top 4 all at or above 50", all(x.strip().isdigit() and int(x) >= 50 for x, _, _ in t)),
    ]


def c37(R, REP, OFF):
    texts = {n: cont(R[n]) for n in ("poem1", "poem2", "poem3")}
    seeds = {n: R[n]["seed_used"] for n in texts}
    return {"texts": texts, "seeds": seeds, "line_breaks": {n: t.count("\n") for n, t in texts.items()}}, [("seeds honoured", seeds == {"poem1": 1, "poem2": 2, "poem3": 3})]


def c38(R, REP, OFF):
    a, b = cont(R["poet"]), cont(R["assistant"])
    line = "Write a short poem about the sea."
    return {"poet": a, "assistant": b}, [("fallback condition: the poet prompt's output is degenerate (repeats the instruction)", a.count(line) >= 2), ("alternate recorded", b.count(line) >= 1)]


def c39(R, REP, OFF):
    fw = R["frenchword"]
    v = {"translate": cont(R["translate"]), "frenchword_top4": top(fw), "hotqa": cont(R["hotqa"]), "hotq": cont(R["hotq"]),
         "hotqa_top4": top(R["hotqarun"]), "hotq_top4": top(R["hotqrun"])}
    near = [t.strip().strip('"').lower() for t, _, _ in top(fw)]
    return v, [("fallback condition: \" merci\" not in the top 4", "merci" not in near)]


def c40(R, REP, OFF):
    a, b = R["jordan"], OFF["jordanoffline"]

    # As displayed: probabilities to 0.1%, logits to 2 decimals. CPU float sums can
    # differ in the 6th digit between the first and a later call of the same request.
    def shown(r):
        return [(p["token"], pct(p["probability"]), None if p.get("logit") is None else round(p["logit"], 2)) for p in r["top_predictions"]]

    return {"online_top4": top(a), "offline_top4": top(b)}, [("offline Run gives identical numbers", shown(a) == shown(b) and a["tokens"] == b["tokens"])]


def c41(R, REP, OFF):
    c = cont(R["francetext"])
    return {"continuation": c}, [('continues " now home to"', c.startswith(" now home to"))]


def c42(R, REP, OFF):
    t = toks(R["leclercsentence"])
    return {"tokens": t}, [
        ("sentence tokens", t == [BOS, "It", " was", " unbelievable", ",", " said", " Le", "cl", "erc"]),
        ("strip starts with the start-of-text marker", t[0] == BOS),
    ]


def c43(R, REP, OFF):
    runs = REP["jordantext"]
    steps = [(s["token"], s["probability"], s.get("runner_up"), s.get("runner_up_probability")) for s in runs[0]["generation_steps"]]
    return {"continuation": cont(runs[0]), "new_tokens": len(steps), "steps": steps}, [("A = B", len(runs) == 2 and cont(runs[0]) == cont(runs[1]))]


def c44(R, REP, OFF):
    s1, s2 = REP["seed1"], R["seed2"]
    return {"seed1": cont(s1[0]), "seed2": cont(s2), "seed_used": [s1[0]["seed_used"], s2["seed_used"]]}, [
        ("C differs from D", cont(s1[0]) != cont(s2)),
        ("E = C", len(s1) == 2 and cont(s1[0]) == cont(s1[1])),
        ("explicit seed honoured", s1[0]["seed_used"] == 1 and s2["seed_used"] == 2),
    ]


def _avg_last(r):
    rows = [h[-1] for lay in r["attention"] for h in lay["heads"]]
    n = len(rows[0])
    return [sum(x[k] for x in rows) / len(rows) for k in range(n)]


def c45(R, REP, OFF):
    avg = _avg_last(R["ioi"])
    j = max(range(len(avg)), key=lambda k: avg[k])
    return {"argmax": toks(R["ioi"])[j], "share": avg[j]}, [("thickest line to the start-of-text marker", j == 0)]


def c46(R, REP, OFF):
    avg = _avg_last(R["ioi"])
    return {"share_position0": avg[0]}, [
        ("position 0 has the biggest share", avg[0] == max(avg)),
        ("about 2 in 5 on position 0", round(avg[0] * 5) == 2),
    ]


def c47(R, REP, OFF):
    r = R["ioi"]
    best = max(((L, h, last_attn(r, L, h)[2]) for L in (9, 10) for h in range(12)), key=lambda x: x[2])
    return {"head": f"L{best[0]}H{best[1]}", "weight_on_mary": best[2]}, [('an L9-L10 head draws mostly from " Mary"', best[2] > 0.5)]


def c48(R, REP, OFF):
    hs = R["headscores"]
    ti = [(f"L{s['layer']}H{s['head']}", s["induction"]) for s in hs["top_induction"][:4]]
    tp = [(f"L{s['layer']}H{s['head']}", s["previous_token"]) for s in hs["top_previous_token"][:4]]
    return {"top_induction": ti, "top_previous_token": tp}, [("top induction scores in middle layers (L3-L8)", all(3 <= s["layer"] <= 8 for s in hs["top_induction"][:4]))]


def c49(R, REP, OFF):
    hs, r = R["headscores"], R["pip"]
    L, h = hs["top_induction"][0]["layer"], hs["top_induction"][0]["head"]
    row = last_attn(r, L, h)
    j = max(range(len(row)), key=lambda k: row[k])
    return {"head": f"L{L}H{h}", "argmax": toks(r)[j], "position": j, "weight": row[j]}, [('biggest weight from the last " from" goes to " Qu" (position 8)', j == 8 and toks(r)[j] == " Qu")]


def c50(R, REP, OFF):
    r = R["lensjordan"]
    col = lens_col(r)
    b = [r["tracked"][li][" basketball"] for li in range(len(r["grid"]))]
    ranks = [b[li]["rank"] for li in (5, 6, 7)]
    return {
        "L5_L7_top": [(f"L{li}", t, p) for li, t, p in col[5:8]],
        "basketball_L5_L8": [(f"L{li}", b[li]["rank"], b[li]["prob"]) for li in (5, 6, 7, 8)],
    }, [
        ('" basketball" not on top at L5-L7', all(k > 1 for k in ranks)),
        ('" basketball" climbs from L5 to L7', ranks[0] > ranks[1] > ranks[2]),
        ('" basketball" tops at L8', b[8]["rank"] == 1),
    ]


def c51(R, REP, OFF):
    r = R["dlamary"]
    t3 = dla_top(r)
    diff = r["answer_logit"] - r["contrast_logit"]
    return {"top3": t3, "bars_total": r["bars_total"], "actual": r["actual"], "gap": r["gap"], "logit_difference": diff}, [
        ("largest bars are heads in L9-L11", all(n.startswith("L") and 9 <= int(n[1:].split(".")[0]) <= 11 for n, _ in t3)),
        ("logit difference about 3.4", round(diff, 1) == 3.4),
    ]


def c52(R, REP, OFF):
    r = R["dlanurse"]
    return {"top3": dla_top(r), "bars_total": r["bars_total"], "actual": r["actual"], "gap": r["gap"], "p_he": prob(R["nurse"], " he")}, [
        ('p(" he") is in the nurse top ten', prob(R["nurse"], " he") is not None),
    ]


def c53(R, REP, OFF):
    f = feats_at(R["jordanfeat"], 2)
    by = {h["id"]: h for h in f}
    fid = by.get(12472) or {}
    snips = list(fid.get("top_activating_snippets") or [])[:5]
    v = {"top5": [(h["id"], h["activation"], h.get("description")) for h in f[:5]], "fid": 12472, "label": fid.get("description"),
         "snippets": snips, "distractors": [by.get(i, {}).get("description") for i in (13856, 13526)],
         "uncovered_snippet": next((x for x in snips if "Brees" in x), None)}
    return v, [
        ("{fid} among the top features at \" Jordan\"", 12472 in [h["id"] for h in f[:5]]),
        ("a snippet the label doesn't describe", v["uncovered_snippet"] is not None),
    ]


def c54(R, REP, OFF):
    a = feats_at(R["jordancountry"], 1)
    b = feats_at(R["jordan50"], 2)
    act = lambda f: next((h["activation"] for h in f if h["id"] == 12472), None)
    return {"country_activation": act(a), "country_top50_min": a[-1]["activation"], "row1_activation": act(b)}, [
        ("{fid} fires at \" Jordan\" in row 1", act(b) is not None),
    ]


def c55(R, REP, OFF):
    a = feats_at(R["bankriver"], 5)[:5]
    b = feats_at(R["bankmoney"], 5)[:5]
    ia, ib = [h["id"] for h in a], [h["id"] for h in b]
    lab = {h["id"]: h.get("description") for h in a + b}
    v = {"river": ia, "money": ib, "overlap": sorted(set(ia) & set(ib)), "river_only": [i for i in ia if i not in ib], "money_only": [i for i in ib if i not in ia], "labels": lab}
    return v, [("the features differ", len(v["overlap"]) < 5)]


def c56(R, REP, OFF):
    a, b = REP["nursecompare"]
    d = max(abs(x["probability"] - y["probability"]) for x, y in zip(a["top_predictions"], b["top_predictions"]))
    return {"max_delta": d}, [("delta exactly 0", d < 1e-6 and [x["token"] for x in a["top_predictions"]] == [y["token"] for y in b["top_predictions"]])]


def _singles(R, prefix, tok):
    out = {}
    for name, r in R.items():
        if name.startswith(prefix + ":"):
            o, a, d = abl(r, tok)
            out[name.split(":", 1)[1]] = d if d is not None else (0 - o if o is not None else None)
    return out


def c57(R, REP, OFF):
    d = _singles(R, "single", " Mary")
    worst = min(d.items(), key=lambda kv: kv[1])
    return {"deltas": d, "largest_drop": worst, "suggested_threshold": round(-worst[1] * 100 / 2)}, [("144 single-head knockouts recorded", len(d) == 144)]


def c58(R, REP, OFF):
    r = R["ts"]
    return {"top4": top(r), "movers": abl(R["tsmovers"], " Tom"), "random3": abl(R["tsrandom3"], " Tom")}, [('" Tom" on top', top(r, 1)[0][0] == " Tom")]


def c59(R, REP, OFF):
    r = R["swapresid"]
    col = [c for c in r["components"] if c.get("position") == 8]
    m = max(abs(c["patched_logit"] - c["corrupted_logit"]) for c in col)
    return {"word": r["tokens"][8], "max_abs_patched_minus_corrupted": m, "layers": len(col)}, [('" store" column: patched = corrupted', r["tokens"][8] == " store" and m < 1e-4)]


def c60(R, REP, OFF):
    r = R["swaphead"]
    pk = patch_peak(r, 3)
    return {"max_cells": pk}, [("max head cell in layers 8 to 9", pk[0]["layer"] in (8, 9))]


def c61(R, REP, OFF):
    d = {n: abl(R[n], " she")[2] for n in ("f21213", "f19093", "f821", "f7698", "f15707")}
    ctrl = d["f7698"]
    return {"deltas": d, "control": ctrl}, [("at least one feature beats the control", any(x < ctrl for n, x in d.items() if n != "f7698"))]


def c62(R, REP, OFF):
    f = feats_at(R["doctorfeat"], 2)
    ids = [h["id"] for h in f[:3]]
    t, c = abl(R["doctortop3"], " he"), abl(R["doctorcontrol"], " he")
    labels = {h["id"]: h.get("description") for h in f}
    return {"top3": ids, "labels": labels, "top3_he": t, "control": 7698, "control_label": labels.get(7698), "control_he": c, "sae": R["doctorfeat"].get("sae"), "sae_layer": R["doctorfeat"]["sae_layer_used"]}, [
        ("top 3 ids at \" doctor\"", ids == [7195, 11067, 19093]),
        ("top 3 drop \" he\" more than the control", t[2] is not None and c[2] is not None and t[2] < c[2]),
    ]


def c63(R, REP, OFF):
    a, b = steer_view(R["rain25"], "rain"), steer_view(R["rain30"], "rain")
    return {"s": a, "s_high": b}, [("coherence does not drop at s_high", b["coherence"]["steered"] >= a["coherence"]["steered"])]


def c64(R, REP, OFF):
    a, b = REP["rain25"]
    return {"runs": 2}, [("steer repeats identical", a["steered_generation"] == b["steered_generation"] and (a["control"] or {}).get("generation") == (b["control"] or {}).get("generation"))]


def c65(R, REP, OFF):
    c = R["rain25"]["control"]
    return {"target": c["steered_decoder_norm"], "control": c["decoder_norm"], "method": c["method"]}, [("decoder rows unit norm", abs(c["steered_decoder_norm"] - 1) < 1e-3 and abs(c["decoder_norm"] - 1) < 1e-3)]


def c66(R, REP, OFF):
    r = R["mlpjb"]
    grid = sorted((cell(r, c) for c in r["components"]), key=lambda x: x["layer"])
    order = sorted(grid, key=lambda x: -x["share"])
    return {"target": r["target_token"], "grid": grid}, [
        ("L0 wins", order[0]["layer"] == 0),
        ("L2 brings back a good chunk (second)", order[1]["layer"] == 2),
        ("L11 pushes the other way", grid[11]["share"] < 0),
    ]


def c67(R, REP, OFF):
    r = R["residjb"]
    pl = per_layer_peak(r)
    bos = [c for c in r["components"] if c.get("position") == 0]
    switch = next((k for k, w in pl.items() if w == " of"), None)
    return {"peaks": patch_peak(r, 3), "per_layer_peak": {f"L{k}": w for k, w in pl.items()}, "of_takes_over_at": switch,
            "marker_max_abs": max(abs(c["patched_logit"] - c["corrupted_logit"]) for c in bos)}, [
        ("marker column exactly 0", all(abs(c["patched_logit"] - c["corrupted_logit"]) < 1e-4 for c in bos)),
        ('" Jordan" early, " of" late', pl[1] == " Jordan" and pl[11] == " of"),
    ]


def c68(R, REP, OFF):
    c = R["circuit1732"]
    return {"threshold": c["threshold"], "nodes": [(n["id"], n["importance"]) for n in c["nodes"]], "edges": [(e["source"], e["target"], e["weight"]) for e in c["edges"]], "edges_method": c["edges_method"]}, [("nodes recorded", len(c["nodes"]) > 0)]


def c69(R, REP, OFF):
    mh = heads_of(R["circuit1732"])
    d = _singles(R, "map", "49")
    best = min(d.items(), key=lambda kv: kv[1])
    ctrl = abl(R["control"], "49")
    return {"map_heads": [f"L{l}H{h}" for l, h in mh], "deltas": d, "best": best, "control": ("L9H9", ctrl)}, [
        ("knockouts cover every map head", sorted(d) == sorted(f"L{l}H{h}" for l, h in mh)),
        ("best map head is L0H7 (row 36 uses it)", best[0] == "L0H7"),
        ("control moves \"49\" less", ctrl[2] is not None and best[1] < ctrl[2]),
        ("control is off the map", (9, 9) not in mh),
    ]


def c70(R, REP, OFF):
    r = R["mlpyears"]
    return {"target": r["target_token"], "grid": sorted((cell(r, c) for c in r["components"]), key=lambda x: x["layer"])}, [("12 layers recorded", len(r["components"]) == 12)]


def c71(R, REP, OFF):
    mh = heads_of(R["circuitioi"])
    d = _singles(R, "ioimap", " Mary")
    best = min(d.items(), key=lambda kv: kv[1])
    ctrl = abl(R["ioicontrol"], " Mary")
    return {"map_heads": len(mh), "best": best, "control": ("L8H8", ctrl)}, [
        ("knockouts cover every map head", sorted(d) == sorted(f"L{l}H{h}" for l, h in mh)),
        ("control is off the map", (8, 8) not in mh),
        ("reachable: best map head beats the control by 5+ points", ctrl[2] is not None and best[1] - ctrl[2] <= -0.05),
    ]


CHECKS = {int(name[1:]): fn for name, fn in dict(globals()).items() if name.startswith("c") and name[1:].isdigit() and callable(fn)}

RESULTS: dict[int, dict] = {}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def _skip_for_lesson_dir(s: Session) -> None:
    if s.lesson_dir:
        pytest.skip("--lesson-dir: rows not run")


@pytest.mark.parametrize("row_id", ROW_IDS)
def test_row(lessons, row_id):
    _skip_for_lesson_dir(lessons)
    row = _row(row_id)
    keys = [(q["key"], v) for q in row["requests"] for v in variants_of(q)]
    problems = [f"{q['name']}: {p}" for q in row["requests"] for v in variants_of(q) for p in lessons.problems.get((q["key"], v), [])]
    for q in row["requests"]:
        for v in variants_of(q):
            for w in lessons.warnings.get((q["key"], v), []):
                warnings.warn(f"row {row_id} {q['name']}: {w} (seeded sampling on a different device class)")
    values, checks = check(row_id, *_views(lessons, row)) if row["requests"] else ({}, [])
    RESULTS[row_id] = {
        "id": row_id,
        **({"label": row["label"]} if row.get("label") else {}),
        "status": row["status"],
        "lessons": row["lessons"],
        "claim": row["claim"],
        "values": values,
        "checks": [{"claim": c, "holds": bool(ok)} for c, ok in checks],
        "responses": sorted({k if v == "r1" else f"{k}.{v}" for k, v in keys}),
    }
    where = f"row {row_id} (cited by {', '.join(row['lessons']) or 'no lesson'})"
    assert not problems, f"{where} drifted:\n  " + "\n  ".join(problems[:30])
    if row["status"] in ("verified", "narrowed"):
        failed = [c for c, ok in checks if not ok]
        assert not failed, f"{where} is marked {row['status']} but the record contradicts: {failed}. Set it to needs-brad in verified-rows.yaml and log it in t6a-rows.md."


def test_row_28_repeats_are_separate_sidecar_calls_and_identical(lessons):
    _skip_for_lesson_dir(lessons)
    row = _row(28)
    for q in row["requests"]:
        assert q["repeat"] == 2
        assert lessons.calls[q["key"]] >= 2, f"{q['name']}: repeats must be separate sidecar calls"
        a, b = lessons.responses[(q["key"], "r1")], lessons.responses[(q["key"], "r2")]
        assert a["generation"] == b["generation"]
        assert [s["token_id"] for s in a["generation_steps"]] == [s["token_id"] for s in b["generation_steps"]]
        if lessons.record:
            assert _file(q["key"], "r1").exists() and _file(q["key"], "r2").exists()


def test_rows_json(lessons, request):
    """Record mode writes rows.json; drift mode re-stamps its sidecar hash once every row passed."""
    _skip_for_lesson_dir(lessons)
    assert set(RESULTS) == set(ROW_IDS), "run the whole file: rows.json needs every row"
    stamp = sidecar_hash()
    if lessons.record:
        doc = {
            "_about": "Written by `pytest sidecar/tests/test_lessons.py --record` (plan T6a). Do not edit.",
            "model": ROWDOC["model"],
            "model_revision": lessons.revision,
            "device": lessons.device,
            "libs": lessons.libs,
            "recorded": lessons.today,
            "drift_checked": lessons.today,
            "sidecar_hash": stamp[0] if stamp else None,
            "sidecar_hash_files": stamp[1] if stamp else 0,
            "status_counts": {s: sum(1 for r in RESULTS.values() if r["status"] == s) for s in ("verified", "narrowed", "failed", "needs-brad", "closed-by-task")},
            "rows": [RESULTS[i] for i in ROW_IDS],
        }
        ROWS_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        return
    assert ROWS_JSON.exists(), "no rows.json: run with --record"
    doc = json.loads(ROWS_JSON.read_text(encoding="utf-8"))
    assert [r["id"] for r in doc["rows"]] == ROW_IDS, "rows.json is out of date with row-requests.json: run with --record"
    for r in doc["rows"]:
        assert r["status"] == _row(r["id"])["status"], f"row {r['id']}: status changed in verified-rows.yaml; re-record"
    if stamp and doc.get("sidecar_hash") != stamp[0]:
        doc["sidecar_hash"], doc["sidecar_hash_files"] = stamp
        doc["drift_checked"] = lessons.today
        ROWS_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def test_lesson_requests_from_expectations(request, lessons):
    if not request.config.getoption("--from-lessons"):
        pytest.skip("--from-lessons not given")
    if not EXPECTATIONS.exists():
        pytest.skip("no __generated__/expectations.json yet (T6 writes it)")
    bad = {k: p for k, p in lessons.problems.items() if k[0] not in {q["key"] for r in ROWDOC["rows"] for q in r["requests"]}}
    assert not bad, f"lesson requests drifted: {bad}"


def test_lesson_dir_requests(request):
    """--lesson-dir: every request of the lesson set was recorded, or replays without drift."""
    if not request.config.getoption("--lesson-dir"):
        pytest.skip("--lesson-dir not given")
    from tests.conftest import _hf_cached

    if not _hf_cached("gpt2"):
        # Asked for by name, so say why instead of skipping quietly.
        pytest.fail(
            "GPT-2 small isn't downloaded yet. Run this once in sidecar/ (it fetches GPT-2 small and its SAE into the "
            "Hugging Face cache): python -c \"from pry_sidecar.presets import PRESETS; from pry_sidecar.registry import REGISTRY; "
            "REGISTRY.load('gpt2-small', PRESETS['gpt2-small'])\""
        )
    lessons = request.getfixturevalue("lessons")
    assert lessons.calls, "the lesson set's expectations.json lists no requests"
    # Say what happened, not just "1 passed". conftest.py prints these lines as the last block,
    # after pytest's warnings, so `| tail` shows them (no -s needed).
    summary = request.config.stash.setdefault(LESSON_DIR_SUMMARY, [])
    if lessons.record:
        summary.append(f"recorded {len(lessons.recorded)} response(s) into {lessons.responses_dir}:")
        summary.extend(f"  {line}" for line in lessons.recorded)
    else:
        summary.append(
            f"replayed {sum(1 for n in lessons.calls.values() if n)} request(s) against {lessons.responses_dir} (no files written)"
        )
    summary.extend(
        f"  not sent (a Neuronpedia lookup; add --network to send it to www.neuronpedia.org): {line}"
        for line in lessons.not_sent
    )
    if lessons.problems:
        summary.append(f"  {len(lessons.problems)} request(s) drifted or aren't recorded: see the failure above")
    assert not lessons.problems, f"lesson requests drifted or aren't recorded: {lessons.problems}"
