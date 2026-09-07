"""The evidence pack: what the chain proves, in the words that proved it.

This is the artifact a person takes to a regulator, an ombudsman, or a
supervisor. It says who was called, who they sent the request to, and in whose
words. Numbers are masked, because an evidence pack is written to be attached
to a complaint and read by strangers.
"""

from __future__ import annotations

from runaround import chain, phone
from runaround.case import Case

STATE_HEADLINES = {
    chain.CHAIN_RESOLVED: "An owner was found and answered the question.",
    chain.CHAIN_LOOP_DETECTED: (
        "The chain closed on itself: a desk referred the request back to a "
        "desk that had already been called."
    ),
    chain.CHAIN_SELF_REFERRAL: (
        "A desk referred the request to its own number."
    ),
    chain.CHAIN_REFERRED_TO_REQUESTER: (
        "A desk referred the request back to the requester."
    ),
    chain.CHAIN_LOOP_SUSPECTED: (
        "A second number was given for an organization already called."
    ),
    chain.CHAIN_AWAITING_APPROVAL: (
        "The next destination came from a call and has not been approved."
    ),
    chain.CHAIN_BUDGET_EXHAUSTED: (
        "The hop budget ran out before an owner was found."
    ),
    chain.CHAIN_NEEDS_HUMAN: "The chain stopped and needs a person.",
    chain.CHAIN_CONTINUE: "The chain is still running.",
    "open": "No call has been placed yet.",
}


def _quote_block(text: str) -> str:
    return "\n".join(f"> {line}" for line in text.splitlines() or [""])


def render(case: Case) -> str:
    """Return the evidence pack for ``case`` as markdown."""
    lines: list[str] = []
    lines.append(f"# Referral evidence: {case.case_id}")
    lines.append("")
    lines.append(f"**Subject.** {case.subject}")
    lines.append("")
    lines.append(f"**Question.** {case.question}")
    lines.append("")
    headline = STATE_HEADLINES.get(case.status, case.status)
    lines.append(f"**Outcome.** {headline}")
    lines.append("")
    lines.append(f"**Why.** {case.status_reason}")
    lines.append("")
    lines.append(
        f"**Calls placed.** {case.hops_used()} of a budget of {case.hop_budget}."
    )
    lines.append("")

    if case.loop_path:
        lines.append("## The loop")
        lines.append("")
        lines.append("```text")
        lines.append(" -> ".join(case.loop_path))
        lines.append("```")
        lines.append("")

    lines.append("## Call by call")
    lines.append("")
    if not case.hops:
        lines.append("No calls have been placed on this case.")
        lines.append("")

    for hop in case.hops:
        lines.append(f"### Hop {hop.index}: {hop.desk.name} ({hop.desk.masked()})")
        lines.append("")
        lines.append(f"- Destination authorized by: {hop.authorized_by}")
        lines.append(f"- CALL-E call id: {hop.call_id or 'none'}")
        lines.append(f"- Call status: {hop.call_status or 'unknown'}")
        lines.append(f"- Outcome: {hop.outcome or 'unknown'}")
        lines.append(f"- Reading: {hop.reason or 'not recorded'}")
        if hop.reference_number:
            lines.append(f"- Reference given: {hop.reference_number}")
        lines.append("")
        if hop.answer:
            lines.append("Answer given on this call:")
            lines.append("")
            lines.append(_quote_block(hop.answer))
            lines.append("")
        if hop.referral:
            target_name = hop.referral.get("target_name") or "an unnamed desk"
            target = phone.mask(hop.referral["target_phone"])
            lines.append(f"Referred the request to {target_name} ({target}), saying:")
            lines.append("")
            lines.append(_quote_block(hop.referral["quote"]))
            lines.append("")

    lines.append("## What this does and does not establish")
    lines.append("")
    lines.append(
        "- Each referral above is recorded with the words the recipient used. "
        "A referral without those words never advanced this chain."
    )
    lines.append(
        "- Names and job titles were not verified. This record establishes "
        "what was said on a call to the number shown, not who said it."
    )
    lines.append(
        "- Nothing in this pack was accepted, declined, or agreed to on the "
        "requester's behalf."
    )
    lines.append("")
    return "\n".join(lines)
