#!/usr/bin/env python3
"""Validate proposals and score saved agent results; never infer preferences."""
import argparse
import itertools
import json
from pathlib import Path

TYPES = {"call_window", "channel", "language", "do_not_call", "voicemail"}
DURATIONS = {"one_time", "time_bounded", "ongoing", "unknown"}
SCOPES = {"this_call", "this_task", "this_campaign", "organization", "unknown"}
ACTIONS = {"update_preference", "request_confirmation", "no_update"}
REQUIRED = {"preference_type", "value", "duration", "scope", "evidence", "confidence",
            "requires_human_review", "recommended_action"}
OPTIONAL = {"time_bound", "review_reason", "suggested_clarification"}


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def recipient_texts(data):
    if not isinstance(data, dict) or not isinstance(data.get("call_context"), dict):
        raise ValueError("Input needs transcript and call_context")
    context = data["call_context"]
    if any(not nonempty(context.get(k)) for k in ("organization", "purpose", "task")):
        raise ValueError("organization, purpose and task must be nonempty strings")
    if "campaign" in context and not nonempty(context["campaign"]):
        raise ValueError("campaign must be a nonempty string when present")
    transcript = data.get("transcript")
    if nonempty(transcript):
        return [transcript]
    if not isinstance(transcript, list) or not transcript:
        raise ValueError("transcript must be recipient text or nonempty speaker turns")
    for turn in transcript:
        if (not isinstance(turn, dict) or set(turn) != {"speaker", "text"}
                or turn["speaker"] not in ("recipient", "agent")
                or not nonempty(turn["text"])):
            raise ValueError("Each turn requires speaker=recipient/agent and nonempty text")
    return [turn["text"] for turn in transcript if turn["speaker"] == "recipient"]


def validate(data, output):
    """Return structural errors. A valid shape does not establish semantic support."""
    try:
        texts = recipient_texts(data)
    except ValueError as exc:
        return [str(exc)]
    if not isinstance(output, dict) or set(output) != {"status", "preferences"}:
        return ["Output requires exactly status and preferences"]
    preferences = output["preferences"]
    if not isinstance(preferences, list):
        return ["preferences must be an array"]
    errors = []
    for index, pref in enumerate(preferences):
        prefix = f"preferences[{index}]: "
        if (not isinstance(pref, dict) or not REQUIRED <= pref.keys()
                or pref.keys() - REQUIRED - OPTIONAL):
            errors.append(prefix + "missing required fields or unsupported extra fields")
            continue
        for field, allowed in (("preference_type", TYPES), ("duration", DURATIONS),
                               ("scope", SCOPES), ("recommended_action", ACTIONS),
                               ("confidence", {"high", "medium", "low"})):
            if not isinstance(pref[field], str) or pref[field] not in allowed:
                errors.append(prefix + f"invalid {field}")
        if type(pref["requires_human_review"]) is not bool:
            errors.append(prefix + "requires_human_review must be a boolean")
        evidence = pref["evidence"]
        if not nonempty(evidence) or not any(evidence in text for text in texts):
            errors.append(prefix + "evidence must be an exact recipient excerpt")
        for field in OPTIONAL & pref.keys():
            if not nonempty(pref[field]):
                errors.append(prefix + f"{field} must be nonempty text")
        if "time_bound" in pref and (not nonempty(pref["time_bound"]) or
                not any(pref["time_bound"] in text for text in texts)):
            errors.append(prefix + "time_bound must be an exact recipient excerpt")
        if (pref["duration"] in ("one_time", "time_bounded")
                and pref["scope"] != "this_call" and "time_bound" not in pref):
            errors.append(prefix + "limited duration needs time_bound")
        value = pref["value"]
        kind = pref["preference_type"]
        if value is not None:
            if kind == "do_not_call" and type(value) is not bool:
                errors.append(prefix + "DNC value must be boolean")
            elif kind == "voicemail" and value not in ("allowed", "not_allowed"):
                errors.append(prefix + "invalid voicemail value")
            elif kind in ("call_window", "channel", "language") and not nonempty(value):
                errors.append(prefix + "value must be nonempty text")
        needs_review = (pref["duration"] == "unknown" or pref["scope"] == "unknown"
                        or value is None or pref["confidence"] == "low"
                        or (pref["scope"] == "this_campaign" and not data["call_context"].get("campaign")))
        if needs_review and pref["requires_human_review"] is not True:
            errors.append(prefix + "semantic uncertainty requires review")
        if pref["requires_human_review"] is True:
            if pref["recommended_action"] != "request_confirmation":
                errors.append(prefix + "review requires request_confirmation")
            if not all(nonempty(pref.get(k)) for k in ("review_reason", "suggested_clarification")):
                errors.append(prefix + "review requires reason and clarification")
        elif pref["recommended_action"] == "request_confirmation":
            errors.append(prefix + "request_confirmation requires human review")
        if pref["scope"] == "this_call" and not pref["requires_human_review"]:
            if pref["duration"] != "one_time" or pref["recommended_action"] != "no_update":
                errors.append(prefix + "ended this_call preference cannot update future state")
    expected_status = ("review_required" if any(isinstance(p, dict) and
                       p.get("requires_human_review") is True for p in preferences)
                       else "preferences_detected" if preferences else "no_preference_detected")
    if output["status"] != expected_status:
        errors.append("status does not match the proposals")
    return errors


def type_matches(actual, expected):
    return actual.get("preference_type") in expected.get("accepted_types", [expected["preference_type"]])


def align(actual, expected):
    if len(actual) != len(expected) or len(actual) > 6:
        return None
    for ordered in itertools.permutations(actual):
        if all(type_matches(a, e) for a, e in zip(ordered, expected)):
            return ordered
    return None


def score(suite, run):
    cases = suite["cases"]
    ids = [case["id"] for case in cases]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate case IDs")
    results = run["results"]
    result_ids = [r["id"] for r in results]
    if len(result_ids) != len(set(result_ids)):
        raise ValueError("Duplicate result IDs")
    actuals = {r["id"]: r["output"] for r in results}
    missing = set(ids) - actuals.keys()
    if missing:
        raise ValueError("Missing actual results: " + ", ".join(sorted(missing)))
    counts = {key: [0, 0] for key in ("type_accuracy", "duration_accuracy", "scope_accuracy",
              "action_accuracy", "false_positive_rate", "ambiguity_handling",
              "multi_preference_handling", "over_broad_update_rate", "contract_validity", "case_pass_rate")}
    details = []
    for case in cases:
        actual = actuals[case["id"]]
        errors = validate(case["input"], actual)
        aps = actual.get("preferences", []) if isinstance(actual, dict) else []
        if not isinstance(aps, list) or any(not isinstance(a, dict) for a in aps):
            aps = []
        eps = case["expected"]["preferences"]
        matched = align(aps, eps)
        checks = {"type_accuracy": matched is not None}
        for field, metric in (("duration", "duration_accuracy"), ("scope", "scope_accuracy"),
                              ("recommended_action", "action_accuracy")):
            checks[metric] = matched is not None and all(a.get(field) == e[field] for a, e in zip(matched, eps))
        values_ok = matched is not None and all("value" not in e or a.get("value") == e["value"]
                                                for a, e in zip(matched, eps))
        reviews_ok = matched is not None and all(a.get("requires_human_review") == e["requires_human_review"]
                                                 for a, e in zip(matched, eps))
        status_ok = isinstance(actual, dict) and actual.get("status") == case["expected"]["status"]
        passed = all(checks.values()) and values_ok and reviews_ok and status_ok and not errors
        # This metric checks encoded duration/scope/action constraints. Human semantic
        # review is still needed for value widths, negation, qualifiers and omissions.
        broad = any(any("consent" in str(k).lower() and bool(v) for k, v in a.items()) for a in aps)
        if isinstance(actual, dict):
            broad = broad or any("consent" in str(k).lower() and bool(v) for k, v in actual.items())
        srank = {"this_call": 0, "this_task": 1, "this_campaign": 2, "organization": 3}
        for a in aps:
            if a.get("recommended_action") != "update_preference":
                continue
            candidates = [e for e in eps if type_matches(a, e)]
            if not candidates:
                broad = True
                continue
            if all(e["recommended_action"] != "update_preference" or
                   (a.get("duration") == "ongoing" and e["duration"] != "ongoing") or
                   (a.get("duration") == "time_bounded" and e["duration"] == "one_time") or
                   srank.get(a.get("scope"), 99) > srank.get(e["scope"], -1)
                   for e in candidates):
                broad = True
        checks.update(contract_validity=not errors, case_pass_rate=passed, over_broad_update_rate=broad)
        if not eps:
            checks["false_positive_rate"] = bool(aps)
        if any(e["requires_human_review"] and
               (e["scope"] == "unknown" or e["duration"] == "unknown" or "value" not in e) for e in eps):
            checks["ambiguity_handling"] = (status_ok and reviews_ok and
                all(a.get("recommended_action") != "update_preference" for a in aps))
        if len(eps) > 1:
            checks["multi_preference_handling"] = passed
        for key, outcome in checks.items():
            counts[key][0] += int(outcome)
            counts[key][1] += 1
        details.append({"id": case["id"], "passed": passed, "checks": checks,
                        "value_match": values_ok, "review_match": reviews_ok,
                        "status_match": status_ok, "contract_errors": errors})
    return {"suite": suite["suite"], "case_count": len(cases),
            "metrics": {k: {"numerator": n, "denominator": d, "rate": n / d if d else None}
                        for k, (n, d) in counts.items()}, "details": details,
            "limitations": "Case-level synthetic checks. Empty cases count as correct categorical outputs. "
            "Over-broad metric covers encoded assertions only; human semantic review is required. "
            "This script scores saved outputs and does not invoke a model."}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("proposal")
    check.add_argument("--input", required=True)
    check.add_argument("--proposal", required=True)
    evaluate = sub.add_parser("score")
    evaluate.add_argument("--cases", required=True)
    evaluate.add_argument("--actual", required=True)
    args = parser.parse_args()
    try:
        if args.command == "proposal":
            errors = validate(read_json(args.input), read_json(args.proposal))
            print(json.dumps({"valid": not errors, "errors": errors}, indent=2))
            return int(bool(errors))
        report = score(read_json(args.cases), read_json(args.actual))
        print(json.dumps(report, indent=2))
        return int(report["metrics"]["case_pass_rate"]["rate"] != 1)
    except (ValueError, KeyError, TypeError, OSError) as exc:
        parser.exit(2, f"Invalid evaluation input: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
