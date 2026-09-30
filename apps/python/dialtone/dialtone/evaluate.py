"""Honest evaluation: confusion matrices, early detection, ablations, attestation.

Everything the README claims comes out of this file and is written to
eval/report.json (machine-readable, consumed by the dashboard) and
eval/REPORT.md (human-readable). Nothing is hand-edited.
"""

from __future__ import annotations

import json
import statistics
from collections import Counter
from pathlib import Path

from . import attestation, protocol
from .classifier import Classifier
from .features import FEATURE_NAMES
from .models import LABELS, Transcript, load_dir
from .sim import generate

GROUPS = {
    "timing+interruption": ["first_user_delay", "latency_mean", "latency_std", "latency_regularity", "overlap_rate",
                            "long_pause_rate", "backchannel_rate"],
    "lexical": ["first_turn_words", "disfluency_rate", "formulaic_rate", "turn_words_mean", "turn_words_cv", "echo_overlap"],
    "structural": ["repeat_rate", "ivr_markers", "ivr_rejects", "dtmf_used", "disclosure"],
}
assert sorted(sum(GROUPS.values(), [])) == sorted(FEATURE_NAMES)
EARLY = (3.0, 5.0, 8.0, 15.0)
COLS = list(LABELS) + ["unknown"]


def confusion(pairs: list[tuple[str, str]]) -> dict:
    cm = {a: {b: 0 for b in COLS} for a in LABELS}
    for truth, pred in pairs:
        cm[truth][pred] += 1
    per_class = {}
    for c in LABELS:
        tp = cm[c][c]
        fn = sum(cm[c].values()) - tp
        fp = sum(cm[a][c] for a in LABELS if a != c)
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        per_class[c] = {"precision": round(prec, 3), "recall": round(rec, 3), "f1": round(f1, 3), "support": tp + fn}
    n = len(pairs)
    return {
        "matrix": cm,
        "accuracy": round(sum(cm[c][c] for c in LABELS) / n, 3) if n else None,
        "macro_f1": round(statistics.fmean(p["f1"] for p in per_class.values()), 3),
        "per_class": per_class,
        "n": n,
        # The costly error: a human treated as a machine loses full disclosure and a humane pace.
        "humans_treated_as_machine": cm["human"]["agent"] + cm["human"]["ivr"],
        # The accountability error: a machine treated as human can yield a false "human_attested".
        "machines_treated_as_human": cm["agent"]["human"] + cm["ivr"]["human"],
    }


def evaluate_detection(clf: Classifier, data: list[Transcript], use_protocol: bool = False) -> dict:
    full = [(t.label, clf.classify(t, use_protocol=use_protocol).label) for t in data]
    early = {}
    for w in EARLY:
        early[str(w)] = confusion([(t.label, clf.classify(t, w, use_protocol).label) for t in data])
    ttd_by_class: dict[str, list] = {c: [] for c in LABELS}
    rows = []
    for t in data:
        points, ttd = clf.timeline(t, use_protocol=use_protocol)
        final = points[-1][1]
        ttd_by_class[t.label].append(ttd)
        rows.append({
            "id": t.id,
            "label": t.label,
            "difficulty": t.meta.get("difficulty", "typical"),
            "scenario": t.meta.get("scenario"),
            "predicted": final.label,
            "confidence": round(final.confidence, 3),
            "correct": final.label == t.label,
            "time_to_detection": ttd,
            "duration": round(t.duration, 1),
            "top_features": [(n, round(v, 2)) for n, v in final.top_features],
            "timeline": [{"t": w, "label": d.label, "conf": round(d.confidence, 3), "probs": {k: round(v, 3) for k, v in d.probs.items()}} for w, d in points],
        })
    ttd_summary = {}
    for c, vals in ttd_by_class.items():
        got = [v for v in vals if v is not None]
        ttd_summary[c] = {
            "median_seconds": statistics.median(got) if got else None,
            "committed": len(got),
            "never_committed_at_0.8": len(vals) - len(got),
        }
    by_diff = {}
    for diff in ("typical", "hard"):
        sub = [r for r in rows if r["difficulty"] == diff]
        if sub:
            by_diff[diff] = {"n": len(sub), "accuracy": round(sum(r["correct"] for r in sub) / len(sub), 3)}
    return {
        "full_call": confusion(full),
        "early": early,
        "time_to_detection": ttd_summary,
        "by_difficulty": by_diff,
        "rows": rows,
    }


def evaluate_attestation(clf: Classifier, data: list[Transcript]) -> dict:
    pairs, rows = [], []
    for t in data:
        outcome = t.meta.get("outcome") or {}
        expected = outcome.get("expected_attestation")
        if not expected:
            continue
        det = clf.classify(t)
        v = attestation.evaluate(t, det, outcome.get("task_completed_claimed"), outcome.get("commitment_type"),
                                 protocol.inspect(t))
        pairs.append((expected, v.attestation))
        rows.append({"id": t.id, "label": t.label, "expected": expected, **v.to_dict()})
    kinds = ["human_attested", "system_asserted", "agent_asserted", "refused", "unverified"]
    matrix = {a: {b: 0 for b in kinds} for a in kinds}
    for a, b in pairs:
        matrix[a][b] += 1
    naive_passed = sum(1 for r in rows if r["original_task_completed"])
    # How much a label lets a principal rely on the result. An error that raises trust is the dangerous kind.
    trust = {"refused": 0, "unverified": 0, "agent_asserted": 1, "system_asserted": 2, "human_attested": 3}
    return {
        "over_trusting_errors": sum(trust[b] > trust[a] for a, b in pairs),
        "cautious_errors": sum(a != b and trust[b] <= trust[a] for a, b in pairs),
        "matrix": matrix,
        "agreement": round(sum(a == b for a, b in pairs) / len(pairs), 3) if pairs else None,
        "n": len(pairs),
        "refused_expected": sum(a == "refused" for a, _ in pairs),
        "refused_caught": sum(a == b == "refused" for a, b in pairs),
        "false_human_attested": sum(b == "human_attested" and a != "human_attested" for a, b in pairs),
        "wrongly_refused": sum(b == "refused" and a != "refused" for a, b in pairs),
        "naive_task_completed_true": naive_passed,
        "rows": rows,
    }


def run(eval_dir: Path, train_dir: Path, out_dir: Path, real_dir: Path | None = None, holdout_dir: Path | None = None) -> dict:
    train = load_dir(train_dir) if train_dir.exists() and any(train_dir.glob("*.json")) else generate.build()
    data = load_dir(eval_dir)
    clf = Classifier().fit(train)
    report = {
        "train": {"source": str(train_dir), "n": len(train), "note": "templated generator (dialtone/sim/generate.py)"},
        "eval": {"source": str(eval_dir), "n": len(data), "labels": dict(Counter(t.label for t in data)),
                 "note": "independently authored, blind to classifier code and training templates"},
        "detection_model_only": evaluate_detection(clf, data, use_protocol=False),
        "ablations": {},
        "attestation": evaluate_attestation(clf, data),
    }
    for name, group in GROUPS.items():
        sub = Classifier(active=group).fit(train)
        report["ablations"][f"only {name}"] = confusion([(t.label, sub.classify(t, use_protocol=False).label) for t in data])
        without = Classifier(active=[f for f in FEATURE_NAMES if f not in group]).fit(train)
        report["ablations"][f"without {name}"] = confusion([(t.label, without.classify(t, use_protocol=False).label) for t in data])
    if holdout_dir and holdout_dir.exists() and any(holdout_dir.glob("*.json")):
        hold = load_dir(holdout_dir)
        report["holdout2"] = {
            "source": str(holdout_dir),
            "n": len(hold),
            "labels": dict(Counter(t.label for t in hold)),
            "note": "second blind set, authored after the attestation-gate fixes and never used to change code",
            "detection_model_only": evaluate_detection(clf, hold, use_protocol=False),
            "attestation": evaluate_attestation(clf, hold),
        }
    history = sorted((out_dir / "history").glob("*.json")) if (out_dir / "history").exists() else []
    report["history"] = []
    for p in history:
        h = json.loads(p.read_text())
        entry = {
            "run": p.stem,
            "set1_detection_accuracy": h["detection_model_only"]["full_call"]["accuracy"],
            "set1_attestation_agreement": h["attestation"]["agreement"],
            "set1_false_human_attested": h["attestation"]["false_human_attested"],
            "set1_refused_caught": f"{h['attestation']['refused_caught']}/{h['attestation']['refused_expected']}",
        }
        if "holdout2" in h:
            a2 = h["holdout2"]["attestation"]
            entry.update({
                "set2_detection_accuracy": h["holdout2"]["detection_model_only"]["full_call"]["accuracy"],
                "set2_attestation_agreement": a2["agreement"],
                "set2_false_human_attested": a2["false_human_attested"],
                "set2_refused_caught": f"{a2['refused_caught']}/{a2['refused_expected']}",
            })
        report["history"].append(entry)
    if real_dir and real_dir.exists() and any(real_dir.glob("*.json")):
        report["real_calls"] = [json.loads(p.read_text()) for p in sorted(real_dir.glob("*.json"))]
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(json.dumps(report, indent=1))
    (out_dir / "REPORT.md").write_text(render_markdown(report))
    return report


def _matrix_md(cm: dict, rows: list[str], cols: list[str]) -> str:
    head = "| truth \\ predicted | " + " | ".join(cols) + " |\n|---|" + "---|" * len(cols) + "\n"
    return head + "\n".join(f"| **{r}** | " + " | ".join(str(cm[r][c]) for c in cols) + " |" for r in rows)


def render_markdown(r: dict) -> str:
    d = r["detection_model_only"]
    full = d["full_call"]
    lines = [
        "# DIALTONE evaluation report",
        "",
        "Generated by `dialtone eval`. Do not edit by hand.",
        "",
        f"- Training: {r['train']['n']} transcripts, {r['train']['note']}.",
        f"- Evaluation: {r['eval']['n']} simulated transcripts {r['eval']['labels']}, {r['eval']['note']}.",
        "- Detection below uses the behavioural model only (no DIALTONE handshake): the hard case where the other agent does not cooperate.",
        "",
        "## Counterpart detection, full call",
        "",
        _matrix_md(full["matrix"], list(LABELS), COLS),
        "",
        f"Accuracy **{full['accuracy']}**, macro-F1 **{full['macro_f1']}**. "
        f"Humans treated as a machine: **{full['humans_treated_as_machine']}**. "
        f"Machines treated as human: **{full['machines_treated_as_human']}**.",
        "",
        "| class | precision | recall | F1 | n |",
        "|---|---|---|---|---|",
        *[f"| {c} | {p['precision']} | {p['recall']} | {p['f1']} | {p['support']} |" for c, p in full["per_class"].items()],
        "",
        "## Early detection",
        "",
        "| window | accuracy | macro-F1 | humans→machine | machines→human |",
        "|---|---|---|---|---|",
        *[f"| first {w}s | {e['accuracy']} | {e['macro_f1']} | {e['humans_treated_as_machine']} | {e['machines_treated_as_human']} |" for w, e in d["early"].items()],
        "",
        "Time to a stable decision (>=0.8 confidence, never flips afterwards):",
        "",
        "| class | median seconds | committed | never committed |",
        "|---|---|---|---|",
        *[f"| {c} | {v['median_seconds']} | {v['committed']} | {v['never_committed_at_0.8']} |" for c, v in d["time_to_detection"].items()],
        "",
        f"By difficulty: {d['by_difficulty']}",
        "",
        "## Misclassified transcripts",
        "",
        "| id | truth | predicted | conf | difficulty | scenario |",
        "|---|---|---|---|---|---|",
        *[f"| {x['id']} | {x['label']} | {x['predicted']} | {x['confidence']} | {x['difficulty']} | {x['scenario'] or ''} |" for x in d["rows"] if not x["correct"]],
        "",
        "## Ablations (accuracy / macro-F1)",
        "",
        "| model | accuracy | macro-F1 |",
        "|---|---|---|",
        *[f"| {k} | {v['accuracy']} | {v['macro_f1']} |" for k, v in r["ablations"].items()],
        "",
        "## Attestation gate",
        "",
        _matrix_md(r["attestation"]["matrix"], list(r["attestation"]["matrix"]), list(r["attestation"]["matrix"])),
        "",
        f"Agreement with the expected label: **{r['attestation']['agreement']}** (n={r['attestation']['n']}). "
        f"Agent-only 'confirmations' refused: **{r['attestation']['refused_caught']} / {r['attestation']['refused_expected']}**. "
        f"False `human_attested`: **{r['attestation']['false_human_attested']}**. "
        f"Wrongly refused: **{r['attestation']['wrongly_refused']}**. "
        f"Errors that raised trust above the reference: **{r['attestation']['over_trusting_errors']}**; cautious errors: {r['attestation']['cautious_errors']}. "
        f"A naive agent reported `task_completed: true` on {r['attestation']['naive_task_completed_true']} of these calls.",
        "",
    ]
    if r.get("history"):
        lines += ["## Run history (nothing deleted)", "",
                  "Run 1 is the only fully blind number on eval set 1. The attestation gate was then changed after reading run-1 errors, "
                  "so later runs on set 1 are *not* blind; the second blind set below is the check on those changes.", "",
                  "Set 1 columns are the 40-transcript set; set 2 columns exist only for runs made after set 2 was written.", "",
                  "| run | set 1 detection | set 1 attestation | set 1 false human_attested | set 1 refused | set 2 detection | set 2 attestation | set 2 false human_attested | set 2 refused |",
                  "|---|---|---|---|---|---|---|---|---|"]
        lines += [
            f"| {h['run']} | {h['set1_detection_accuracy']} | {h['set1_attestation_agreement']} | {h['set1_false_human_attested']} | {h['set1_refused_caught']} | "
            f"{h.get('set2_detection_accuracy', '-')} | {h.get('set2_attestation_agreement', '-')} | {h.get('set2_false_human_attested', '-')} | {h.get('set2_refused_caught', '-')} |"
            for h in r["history"]
        ]
        lines.append("")
    if r.get("holdout2"):
        h2 = r["holdout2"]
        f2 = h2["detection_model_only"]["full_call"]
        a2 = h2["attestation"]
        lines += [
            "## Second blind set", "",
            f"{h2['n']} transcripts {h2['labels']}, {h2['note']}.", "",
            _matrix_md(f2["matrix"], list(LABELS), COLS), "",
            f"Detection accuracy **{f2['accuracy']}**, macro-F1 **{f2['macro_f1']}**, humans treated as machine **{f2['humans_treated_as_machine']}**, "
            f"machines treated as human **{f2['machines_treated_as_human']}**. By difficulty: {h2['detection_model_only']['by_difficulty']}.", "",
            _matrix_md(a2["matrix"], list(a2["matrix"]), list(a2["matrix"])), "",
            f"Attestation agreement **{a2['agreement']}**, refused **{a2['refused_caught']} / {a2['refused_expected']}**, "
            f"false `human_attested` **{a2['false_human_attested']}**, wrongly refused **{a2['wrongly_refused']}**, "
            f"errors that raised trust **{a2['over_trusting_errors']}**, cautious errors {a2['cautious_errors']}.", "",
            "| id | truth | predicted | conf | difficulty | scenario |", "|---|---|---|---|---|---|",
            *[f"| {x['id']} | {x['label']} | {x['predicted']} | {x['confidence']} | {x['difficulty']} | {x['scenario'] or ''} |"
              for x in h2["detection_model_only"]["rows"] if not x["correct"]],
            "",
        ]
    if r.get("real_calls"):
        calls = [c for c in r["real_calls"] if c.get("status") == "completed"]
        lines += [
            "## Real calls", "",
            "CALL-E calls to our own Vapi voicebot line (one free US number, persona switched per call). "
            "Timing comes from CALL-E's realtime event stream. Transcripts are not published; these rows are derived results.", "",
            "| call | truth | task | token spoken | pickup collision | CALL-E counterpart | CALL-E task_completed | DIALTONE detected | DIALTONE label | DIALTONE task_completed |",
            "|---|---|---|---|---|---|---|---|---|---|",
        ]
        for c in calls:
            token = "-" if c.get("mode") != "dialtone" else ("acknowledged" if c["handshake"]["acknowledged"] else "yes" if c["handshake"]["offered"] else "lost")
            lines.append(
                f"| {c.get('name')} | {c.get('label')} | {c.get('mode')} r{c.get('task_prompt_revision') or '-'} | {token} | {c.get('pickup_collision')} | "
                f"{c['calle_reported'].get('counterpart_type')} | {c['calle_reported'].get('task_completed')} | "
                f"{c['detection']['label']} {c['detection']['confidence']:.2f} ({c['detection']['via']}) | {c['verdict']['attestation']} | {c['verdict']['dialtone_task_completed']} |"
            )
        machine = [c for c in calls if c.get("label") in ("agent", "ivr")]
        lines += [
            "",
            f"- Counterpart identified correctly: **{sum(c['detection']['label'] == c.get('label') for c in calls)} / {len(calls)}**.",
            f"- Pickup collisions (both sides spoke in the first 1.5 s): **{sum(bool(c.get('pickup_collision')) for c in calls)} / {len(calls)}**; "
            f"DIALTONE token actually spoken: **{sum(c['handshake']['offered'] for c in calls if c.get('mode') == 'dialtone')} / {sum(c.get('mode') == 'dialtone' for c in calls)}** protocol calls.",
            f"- CALL-E reported `task_completed: true` on **{sum(bool(c['calle_reported'].get('task_completed')) for c in calls)}**; "
            f"DIALTONE kept **{sum(bool(c['verdict']['dialtone_task_completed']) for c in calls)}**. "
            f"CALL-E labelled a machine as human on **{sum(c['calle_reported'].get('counterpart_type') == 'human' for c in machine)}** call(s).",
            "",
        ]
    return "\n".join(lines)
