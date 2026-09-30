#!/usr/bin/env python3
"""Check one CALL-E structured_result against the outcome evidence schema.

    python3 check_evidence_schema.py result.json
    cat result.json | python3 check_evidence_schema.py -

No network, no credentials, no calls. Reports two things:

* errors  - the result is malformed and a planner would misread it
* notes   - the result parses, but something in it will be discarded

The notes matter more than they look. A referral whose number is unusable is the difference
between an agent that finds the depot and one that stops at the supplier, and nothing else
in the run will tell you it was dropped.

Exit status is 1 if there are errors, 0 otherwise.
"""

from __future__ import annotations

import json
import re
import sys

VERDICTS = ("no_answer", "refused", "blocked", "partial", "offer", "confirmed")
REACHED_VALUES = ("yes", "no", "unknown")
E164 = re.compile(r"^\+[1-9][0-9]{6,14}$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONEY = re.compile(r"-?\d+(?:[\d,]*\d)?(?:\.\d+)?")


def parse_money(value: object) -> float | None:
    """Mirror of the parser a planner should use: unreadable is None, never zero."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    match = MONEY.search(value.replace(" ", ""))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def said_no(value: object) -> bool:
    """Read a yes/no/unknown field without turning "unknown" into "no".

    CALL-E prefers string enums with an `unknown` member over booleans, because
    a phone call often cannot settle the question. Both shapes are accepted: a
    model that returns `false` and one that returns `"no"` mean the same thing.
    "unknown" is not a no.
    """
    if value is False:
        return True
    return isinstance(value, str) and value.strip().lower() == "no"


def check(result: object) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    notes: list[str] = []

    if not isinstance(result, dict):
        return ([f"Top level must be an object, got {type(result).__name__}."], [])

    # Only `verdict` is required. CALL-E returns null for the whole result when
    # it cannot satisfy the schema, so a longer required list is a longer list
    # of ways to lose the entire call.
    if "verdict" not in result:
        errors.append("Missing required field 'verdict'.")

    reached = result.get("reached")
    if "reached" in result and not (
        isinstance(reached, bool) or (isinstance(reached, str) and reached in REACHED_VALUES)
    ):
        errors.append(
            f"'reached' must be one of {', '.join(REACHED_VALUES)}; got {reached!r}."
        )

    verdict = result.get("verdict")
    if "verdict" in result and verdict not in VERDICTS:
        errors.append(f"'verdict' must be one of {', '.join(VERDICTS)}; got {verdict!r}.")

    for key in ("facts", "blockers"):
        value = result.get(key, [])
        if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
            errors.append(f"{key!r} must be an array of strings.")

    if said_no(reached) and verdict not in (None, "no_answer", "refused"):
        notes.append(
            f"reached says no with verdict={verdict!r}: nothing was established, so a "
            "planner will read this as no_answer and discard the rest."
        )

    referrals = result.get("referrals", [])
    if not isinstance(referrals, list):
        errors.append("'referrals' must be an array.")
    else:
        for index, referral in enumerate(referrals):
            label = f"referrals[{index}]"
            if not isinstance(referral, dict):
                errors.append(f"{label} must be an object.")
                continue
            name = str(referral.get("org_name") or "").strip()
            phone = str(referral.get("phone") or "").strip().replace(" ", "").replace("-", "")
            if not name:
                errors.append(f"{label} has no org_name.")
            if not phone:
                notes.append(f"{label} ({name or 'unnamed'}) has no number and will be dropped.")
            elif not E164.match(phone):
                notes.append(
                    f"{label} ({name or 'unnamed'}) has a phone that is not E.164 and will be "
                    "dropped. This lead will never be called."
                )

    offer = result.get("offer")
    if offer is not None:
        if not isinstance(offer, dict):
            errors.append("'offer' must be an object.")
        else:
            # `what_is_offered` is the wire name: `summary` is a reserved
            # recipient response field in CALL-E. Both are read, because a model
            # handed either description may reach for the shorter word.
            summary = str(offer.get("what_is_offered") or offer.get("summary") or "").strip()
            price_raw = offer.get("price")
            price = parse_money(price_raw)
            eta = offer.get("eta")
            if not summary and price is None and not eta:
                notes.append(
                    "'offer' has no description, price or date and will be read as no offer."
                )
            if price_raw not in (None, "") and price is None:
                notes.append(
                    f"offer.price {price_raw!r} is unreadable and will be treated as unknown, "
                    "so a budget constraint cannot block this offer."
                )
            if price is None and price_raw in (None, ""):
                notes.append(
                    "offer.price is absent: a budget constraint will judge this unknown, "
                    "not satisfied."
                )
            if eta and not ISO_DATE.match(str(eta)):
                notes.append(
                    f"offer.eta {eta!r} is not YYYY-MM-DD; a deadline constraint may not "
                    "be able to compare it."
                )
            if not offer.get("reference") and verdict == "confirmed":
                notes.append(
                    "verdict is 'confirmed' but the offer carries no reference number; the "
                    "user has nothing to quote back."
                )
    elif verdict in ("offer", "confirmed"):
        notes.append(f"verdict is {verdict!r} but there is no offer to evaluate.")

    unknown = set(result) - {
        "reached", "verdict", "facts", "blockers", "referrals", "offer",
    }
    for key in sorted(unknown):
        notes.append(f"Unknown field {key!r} will be ignored.")

    return errors, notes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    source = sys.stdin if argv[1] == "-" else open(argv[1], encoding="utf-8")
    try:
        payload = json.load(source)
    except json.JSONDecodeError as exc:
        print(f"ERROR: not valid JSON: {exc}", file=sys.stderr)
        return 1
    finally:
        if source is not sys.stdin:
            source.close()

    errors, notes = check(payload)
    for message in errors:
        print(f"ERROR: {message}")
    for message in notes:
        print(f"NOTE:  {message}")
    if not errors and not notes:
        print("OK: valid, and every field is usable.")
    elif not errors:
        print(f"OK: valid, with {len(notes)} note(s) above.")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
