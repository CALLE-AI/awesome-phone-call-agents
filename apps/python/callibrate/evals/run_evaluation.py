"""Score the evidence pipeline on conversations whose right answer is known.

Every case below is a transcript plus the verdict a careful person would reach
reading it. The harness runs each one through the production reader and the
production policy and counts two kinds of error separately, because they are not
the same kind of mistake:

  * a **missed update** is a change the call did establish and the policy would
    not apply. It costs a curator thirty seconds.
  * a **false automatic mutation** is a change the policy applied that the call
    did not establish. It publishes a wrong address for a food bank.

The thresholds are set for that asymmetry, so a rising miss rate is a tuning
question and a single false mutation is a defect.

    python evals/run_evaluation.py
    python evals/run_evaluation.py --json
"""

from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from callibrate.calling.models import CallOutcome  # noqa: E402
from callibrate.contracts.models import (  # noqa: E402
    Subject,
    Trigger,
    TriggerType,
    VerificationContract,
)
from callibrate.evidence.reconcile import build_evidence  # noqa: E402
from callibrate.evidence.transcript import normalize_turns  # noqa: E402
from callibrate.policy.evidence_policy import Authority, classify, overall  # noqa: E402

DISCLOSURE = (
    "Hello, this is an automated assistant calling on behalf of the community "
    "resource directory about the weekly grocery pickup."
)


def contract(fields: list[str] | None = None) -> VerificationContract:
    return VerificationContract(
        id="vc_eval",
        subject=Subject(name="Weekly grocery pickup", organization="Meridian Community Pantry", record_id="svc"),
        authoritative_phone="+15550101101",
        current_record={"schedule": "WE 09:00-12:00", "status": "active"},
        fields_to_verify=fields or ["schedule"],
        trigger=Trigger(type=TriggerType.STALE_RECORD),
    )


def turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"speaker": speaker, "text": text} for speaker, text in pairs]


#: (name, expected verdict, outcome, conversation)
CASES: list[tuple[str, Authority, CallOutcome, list[dict[str, str]]]] = [
    (
        "explicit change, read back, confirmed",
        Authority.APPLY,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " We publish Wednesdays nine until twelve. Is that still right?"),
            ("user", "It moved to ten until one."),
            ("bot", "So that is Wednesdays, ten in the morning until one in the afternoon?"),
            ("user", "Yes, that is right."),
        ),
    ),
    (
        "change stated twice, second time in the confirmation",
        Authority.APPLY,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " We publish Wednesdays nine until twelve. Is that still right?"),
            ("user", "That changed. It is ten until one now."),
            ("bot", "Wednesdays, ten in the morning until one in the afternoon. Have I got that right?"),
            ("user", "Yes, ten to one on Wednesdays is correct."),
        ),
    ),
    (
        "unchanged record, confirmed on a readback",
        Authority.REFRESH,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " We publish Wednesdays, nine in the morning until twelve. Is that still right?"),
            ("user", "That is correct, unchanged."),
        ),
    ),
    (
        "no readback at all",
        Authority.REVIEW,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " Is Wednesday nine until twelve still right?"),
            ("user", "No, it is ten until one now."),
            ("bot", "Thank you, I have made a note."),
        ),
    ),
    (
        "readback with one part wrong",
        Authority.REVIEW,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " Is Wednesday nine until twelve still right?"),
            ("user", "It moved to ten until one."),
            ("bot", "Wednesdays, ten in the morning until three in the afternoon?"),
            ("user", "Yes."),
        ),
    ),
    (
        "agreement carrying a correction",
        Authority.REVIEW,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " Is Wednesday nine until twelve still right?"),
            ("user", "It moved to ten until one."),
            ("bot", "Wednesdays, ten in the morning until one in the afternoon?"),
            ("user", "Yes, but actually it changed again last week."),
        ),
    ),
    (
        "provider corrects the readback",
        Authority.REVIEW,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " We publish Wednesdays nine until twelve."),
            ("user", "It moved to ten until one."),
            ("bot", "So that is Wednesdays, ten in the morning until three in the afternoon?"),
            ("user", "No, one in the afternoon, not three."),
        ),
    ),
    (
        "two sessions in one sentence, read back faithfully",
        Authority.REVIEW,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " We publish Wednesdays nine until twelve. Is that still right?"),
            ("user", "Tuesdays ten to twelve and Thursdays one to three."),
            ("bot", "So that is Tuesdays ten to twelve and Thursdays one to three, correct?"),
            ("user", "Yes, that is right."),
        ),
    ),
    (
        "readback that adds a day and a time",
        Authority.REVIEW,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " Is Wednesday nine until twelve still right?"),
            ("user", "It moved to ten until one."),
            ("bot", "So Wednesdays ten in the morning until one in the afternoon, and Thursdays two until four?"),
            ("user", "Yes."),
        ),
    ),
    (
        "hedged volunteer",
        Authority.REVIEW,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " Is Wednesday nine until twelve still right?"),
            ("user", "I think it might be ten until one, but I would have to check."),
            ("bot", "Wednesdays, ten in the morning until one in the afternoon?"),
            ("user", "Probably, yes."),
        ),
    ),
    (
        "value introduced by the agent, agreed to",
        Authority.REVIEW,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " I think you moved to ten until one on Wednesdays?"),
            ("user", "Sure."),
        ),
    ),
    (
        "closure mentioned on a call about hours",
        Authority.REVIEW,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE),
            ("user", "We are ending that program next month, it closed to new people already."),
            ("bot", "Thank you for telling me. Someone from the directory will be in touch."),
        ),
    ),
    (
        "eligibility change",
        Authority.REVIEW,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " We publish that anyone in the county can use it. Is that still right?"),
            ("user", "It is referral only now."),
            ("bot", "Referral only?"),
            ("user", "Yes."),
        ),
    ),
    (
        "stop request",
        Authority.STOP,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE),
            ("user", "Please stop calling and take us off your list."),
        ),
    ),
    (
        "a help seeker answers the provider's phone",
        Authority.STOP,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE),
            ("user", "I need food for my children, can you help me?"),
        ),
    ),
    (
        "wrong number",
        Authority.REVIEW,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE),
            ("user", "I think you have the wrong number, this is a private line."),
        ),
    ),
    (
        "no disclosure",
        Authority.STOP,
        CallOutcome.COMPLETED,
        turns(
            ("bot", "Hi, quick question about your opening hours."),
            ("user", "They are ten until one now."),
            ("bot", "Wednesdays ten in the morning until one in the afternoon?"),
            ("user", "Yes."),
        ),
    ),
    (
        "nobody answers",
        Authority.REFRESH,
        CallOutcome.NO_ANSWER,
        [],
    ),
    (
        "voicemail",
        Authority.REFRESH,
        CallOutcome.VOICEMAIL,
        [],
    ),
    (
        "the call establishes nothing",
        Authority.REVIEW,
        CallOutcome.COMPLETED,
        turns(
            ("bot", DISCLOSURE + " Is Wednesday nine until twelve still right?"),
            ("user", "You would have to ask the coordinator, she is not in."),
        ),
    ),
]

#: A caller reporting a change the transcript does not contain. Scored apart,
#: because it is the failure mode the whole architecture exists to survive.
UNSUPPORTED_CLAIM = turns(
    ("bot", DISCLOSURE + " Is Wednesday nine until twelve still right?"),
    ("user", "Hmm."),
)


def evaluate() -> dict[str, object]:
    rows: list[dict[str, object]] = []
    false_mutations = 0
    missed_updates = 0

    for name, expected, outcome, conversation in CASES:
        subject = contract(["schedule", "eligibility"] if "eligibility" in name else None)
        evidence = build_evidence(
            subject, turns=normalize_turns(conversation), caller="eval", outcome=outcome
        )
        verdict = overall(classify(evidence, subject))
        if verdict is Authority.APPLY and expected is not Authority.APPLY:
            false_mutations += 1
        if expected is Authority.APPLY and verdict is not Authority.APPLY:
            missed_updates += 1
        rows.append(
            {
                "case": name,
                "expected": expected.name,
                "verdict": verdict.name,
                "match": verdict is expected,
            }
        )

    subject = contract()
    evidence = build_evidence(
        subject,
        turns=normalize_turns(UNSUPPORTED_CLAIM),
        caller="eval",
        outcome=CallOutcome.COMPLETED,
        caller_result={"structured_result": {"schedule": "WE 10:00-13:00"}},
    )
    verdict = overall(classify(evidence, subject))
    unsupported_blocked = verdict is not Authority.APPLY
    if not unsupported_blocked:
        false_mutations += 1
    rows.append(
        {
            "case": "caller asserts a change the transcript does not contain",
            "expected": "REVIEW",
            "verdict": verdict.name,
            "match": unsupported_blocked,
        }
    )

    matched = sum(1 for row in rows if row["match"])
    return {
        "cases": len(rows),
        "agreement": round(matched / len(rows), 3),
        "false_automatic_mutations": false_mutations,
        "missed_updates": missed_updates,
        "unsupported_claim_blocked": unsupported_blocked,
        "rows": rows,
    }


def main() -> int:
    result = evaluate()
    if "--json" in sys.argv:
        print(json.dumps(result, indent=2))
        return 0 if result["false_automatic_mutations"] == 0 else 1

    width = max(len(str(row["case"])) for row in result["rows"])
    print(f"{'case'.ljust(width)}  expected  verdict")
    print("-" * (width + 20))
    for row in result["rows"]:
        mark = " " if row["match"] else "  <-- disagrees"
        print(f"{str(row['case']).ljust(width)}  {str(row['expected']):8s}  {str(row['verdict']):8s}{mark}")
    print()
    print(f"cases                        {result['cases']}")
    print(f"agreement with the label     {result['agreement']:.1%}")
    print(f"missed updates               {result['missed_updates']}")
    print(f"false automatic mutations    {result['false_automatic_mutations']}")
    return 0 if result["false_automatic_mutations"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
