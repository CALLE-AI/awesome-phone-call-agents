#!/usr/bin/env python3
"""Render a claim as an answer card, before and after the call.

# ponytail: presentation only. Every decision shown here is made in gate.py -
# this file renders them and owns no logic. It exists because the interesting
# thing about this skill is invisible in a status log: the answer the user was
# given CHANGES, and it changes only when a person actually said something.

    python3 scripts/demo_card.py --input assets/sample-claim.json          # before
    python3 scripts/demo_card.py --input assets/sample-claim.json \
        --result assets/sample-result.json --abstain false                 # after
"""

from __future__ import annotations

import argparse
import json
import sys

import gate

WIDTH = 74


def rule(char: str = "-") -> str:
    return char * WIDTH


def wrap(text: str, indent: str = "  ") -> list[str]:
    words, lines, line = text.split(), [], ""
    for word in words:
        if len(line) + len(word) + 1 > WIDTH - len(indent) - 1:
            lines.append(indent + line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(indent + line)
    return lines


def card(title: str, answer: str, source: str, quote: str = "") -> str:
    out = [rule("="), f"  {title}", rule()]
    out += wrap(answer)
    if quote:
        out += ["", "  they said:"] + wrap(f'"{quote}"', indent="    ")
    out += ["", f"  source: {source}", rule("=")]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", required=True, metavar="CLAIM.JSON")
    parser.add_argument("--result", metavar="RESULT.JSON", help="render the card AFTER the call")
    parser.add_argument("--abstain", choices=("true", "false"))
    args = parser.parse_args(argv)

    try:
        with open(args.input, encoding="utf-8") as handle:
            claim = gate.claim_from_dict(json.load(handle))
    except (gate.ClaimError, OSError, json.JSONDecodeError) as error:
        print(f"cannot read the claim: {error}", file=sys.stderr)
        return 2

    action, reason = gate.decide(claim)
    stale = f"web listing, {claim.evidence_age_days} days old"

    if not args.result:
        print(card("THE ANSWER RIGHT NOW", claim.provisional_answer, stale))
        print()
        print(f"  triage: {action.upper()} - {reason}")
        if action == "gate":
            print(f"  one question to ask: {gate.clean_question(claim.question)}")
        return 0

    try:
        with open(args.result, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        print(f"cannot read the result: {error}", file=sys.stderr)
        return 2

    result = payload.get("structured_result", payload)
    if not isinstance(result, dict):
        print("cannot read the result: structured_result is not an object", file=sys.stderr)
        return 2
    verdict = result.get("verdict", "unknown")
    if verdict not in gate.VERDICTS:
        verdict = "unknown"
    abstain = {"true": True, "false": False}.get(args.abstain)

    if not gate.release(verdict, abstain):
        # The whole point. A call that established nothing changes nothing.
        print(card("THE ANSWER, UNCHANGED", claim.provisional_answer, stale))
        print()
        print(f"  the call returned: {verdict}  ->  released: False")
        print("  absence of evidence is never evidence.")
        return 0

    quote = gate.mask_text(gate.safe_print(str(result.get("quoted_answer", ""))))
    print(card("CORRECTED", quote.rstrip(".") + ".", "verified by phone, just now", quote))
    print()
    print(f"  the call returned: {verdict}  ->  released: True")
    if result.get("valid_until_note"):
        print(f"  {gate.safe_print(str(result['valid_until_note']))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
