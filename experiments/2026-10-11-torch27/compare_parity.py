"""Compare two parity captures (format of sidecar/tests/fixtures/parity_*.json).

    python compare_parity.py BASE.json OTHER.json

Prints, per preset/prompt: whether the top-10 feature/logit id sets match, the
max abs and max relative activation diff, and the max abs logit diff.
"""

from __future__ import annotations

import json
import sys


def main(base_path: str, other_path: str) -> int:
    base = json.load(open(base_path, encoding="utf-8"))
    other = json.load(open(other_path, encoding="utf-8"))
    print(f"base : {base['recorded_with']}")
    print(f"other: {other['recorded_with']}")
    worst = {"act_abs": 0.0, "act_rel": 0.0, "logit_abs": 0.0}
    for preset, prompts in base["presets"].items():
        for b, o in zip(prompts, other["presets"][preset]):
            same_f = set(b["feature_ids"]) == set(o["feature_ids"])
            same_l = set(b["logit_ids"]) == set(o["logit_ids"])
            act_abs = act_rel = 0.0
            if same_f:
                order = [o["feature_ids"].index(f) for f in b["feature_ids"]]
                for rb, ro in zip(b["feature_acts"], o["feature_acts"]):
                    for vb, j in zip(rb, order):
                        d = abs(vb - ro[j])
                        act_abs = max(act_abs, d)
                        if abs(vb) > 1e-3:
                            act_rel = max(act_rel, d / abs(vb))
            logit_abs = 0.0
            if same_l:
                ol = dict(zip(o["logit_ids"], o["logit_values"]))
                logit_abs = max(abs(v - ol[i]) for i, v in zip(b["logit_ids"], b["logit_values"]))
            worst["act_abs"] = max(worst["act_abs"], act_abs)
            worst["act_rel"] = max(worst["act_rel"], act_rel)
            worst["logit_abs"] = max(worst["logit_abs"], logit_abs)
            print(
                f"{preset:11s} {b['prompt'][:28]!r:32s} feat_ids={'ok' if same_f else 'DIFF'} "
                f"logit_ids={'ok' if same_l else 'DIFF'} act_abs={act_abs:.3g} "
                f"act_rel={act_rel:.3g} logit_abs={logit_abs:.3g} "
                f"preds={'ok' if b['predictions'] == o['predictions'] else 'DIFF'}"
            )
    print("worst:", {k: f"{v:.3g}" for k, v in worst.items()})
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:3]))
