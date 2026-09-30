"""Ruling.

This module imports nothing that can place a call. It takes answers that already
exist and rules them against a rubric.

It rules on the value the call extracted, never on the transcript text. Matching
phrases against free speech cannot read negation, and a false deviation in a
staff audit is worse than a missed one. The quote travels with the finding as
evidence a human can check, but it is not what decides the verdict.
"""

from __future__ import annotations

from concord.models import Answer, Criterion, Finding, Rubric

UNRESOLVED = {"", "unclear", "unknown", "not_stated", "refused"}


def rule_one(criterion: Criterion, answer: Answer) -> Finding:
    """Rule a single answer.

    Silence is never a deviation. A branch that was not reached, or whose answer
    the call could not resolve into a value, is UNCLEAR and goes to a human.
    Treating an unreached branch as non-compliant would let a bad phone line
    look like a policy failure.
    """
    value = answer.value.strip().lower()

    if not answer.reached or value in UNRESOLVED:
        return Finding(
            branch_id=answer.branch_id,
            criterion_id=criterion.id,
            verdict="UNCLEAR",
            rationale=(
                "The branch was not reached."
                if not answer.reached
                else "The call could not resolve this question into a definite answer."
            ),
            quote=answer.quote,
            needs_human_review=True,
        )

    if not answer.quote:
        return Finding(
            branch_id=answer.branch_id,
            criterion_id=criterion.id,
            verdict="UNCLEAR",
            rationale=(
                f"The call returned {answer.value!r} but captured no words to support it. "
                "A ruling without quoted evidence is not a ruling."
            ),
            quote="",
            needs_human_review=True,
        )

    if criterion.options and value not in {o.lower() for o in criterion.options}:
        return Finding(
            branch_id=answer.branch_id,
            criterion_id=criterion.id,
            verdict="UNCLEAR",
            rationale=(
                f"The call returned {answer.value!r}, which is not one of the answers "
                f"this question allows. Treated as unresolved rather than guessed at."
            ),
            quote=answer.quote,
            needs_human_review=True,
        )

    if value == criterion.expect.strip().lower():
        return Finding(
            branch_id=answer.branch_id,
            criterion_id=criterion.id,
            verdict="COMPLIANT",
            rationale=f"Answered {answer.value!r}, which is what the policy requires.",
            quote=answer.quote,
        )

    return Finding(
        branch_id=answer.branch_id,
        criterion_id=criterion.id,
        verdict="DEVIATION",
        rationale=(
            f"Answered {answer.value!r} where policy requires {criterion.expect!r}. "
            f"Policy: {criterion.policy}"
        ),
        quote=answer.quote,
    )


def rule_all(
    rubric: Rubric,
    answers: list[Answer],
    branch_ids: list[str] | None = None,
) -> list[Finding]:
    """Rule every criterion for every expected or observed branch.

    A branch or criterion with no answer at all still produces UNCLEAR findings,
    so incomplete recorded results cannot make outstanding work disappear.
    """
    by_key = {(a.branch_id, a.criterion_id): a for a in answers}
    expected = set(branch_ids or ())
    expected.update(a.branch_id for a in answers)
    findings: list[Finding] = []
    for branch_id in sorted(expected):
        for criterion in rubric.criteria:
            answer = by_key.get(
                (branch_id, criterion.id),
                Answer(
                    branch_id=branch_id,
                    criterion_id=criterion.id,
                    value="",
                    quote="",
                    reached=False,
                ),
            )
            findings.append(rule_one(criterion, answer))
    return findings
