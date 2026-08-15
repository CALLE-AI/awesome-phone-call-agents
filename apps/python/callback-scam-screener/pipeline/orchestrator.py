from pathlib import Path
from typing import Callable

from .caller import CallEClient
from .guardrails import CallGuardrails
from .models import ScreeningResult, SignalTag
from .precheck import run_prechecks
from .signal_catalog import load_catalog, tag_transcript
from .scoring import score
from .trigger import extract_alert

# See AGENT_PROMPTS.md — this is the Screener Agent's aim, expressed as a
# CALL-E `task` (a goal, not a branching script — CALL-E adapts the actual
# conversation itself). Two things learned from a real validated test call
# on 2026-08-09 are baked in here:
# - CALL-E's platform guardrails reject any goal that asks it to impersonate
#   the recipient or conceal that it's an AI — the framing must be
#   transparent ("You are an AI calling assistant...").
# - The last line still tells CALL-E not to judge the call itself: the
#   verdict is computed afterward by scoring.score() over tagged signals, so
#   a persistent scammer can't talk the live agent into a favorable
#   self-assessment mid-call.
SCREENER_TASK_TEMPLATE = """You are an AI calling assistant contacting {phone_number} on behalf of someone \
who received a message claiming: "{claimed_reason}", with this number listed to call back.
Be transparent that you are an AI assistant verifying this claim, not the account holder.
Ask who they are, what company and department they represent, why they're contacting the recipient, and \
whether this can be verified through the company's official published channels.
You have no real account numbers, passwords, verification codes, or payment methods, and cannot install \
software or click links — if asked, say so plainly.
Do not agree to any payment, software install, or provide any personal or account information under any \
circumstances.
Do not accuse or try to catch anyone out — establish the facts of the situation. Do not decide yourself \
whether this is a scam; just have the conversation and report what was actually said."""


def run_pipeline(
    email_body: str,
    sender_domain: str,
    call_client: CallEClient,
    official_support_number: str | None = None,
    catalog_path: Path | None = None,
    guardrails: CallGuardrails | None = None,
    tagger: Callable[[str, dict], list[SignalTag]] = tag_transcript,
) -> ScreeningResult | None:
    """tagger defaults to the cheap offline keyword tagger so demo.py's mock
    scenarios need no API key. Pass signal_catalog.tag_transcript_llm for
    real calls — the keyword tagger does not generalize to real speech (see
    its docstring)."""
    alert = extract_alert(email_body, sender_domain)
    if alert is None:
        return None  # not flagged as suspicious — pipeline never dials

    precheck = run_prechecks(alert, official_support_number)
    catalog = load_catalog(catalog_path)

    if guardrails is not None:
        guardrails.check(alert.phone_number)  # raises GuardrailViolation and stops before dialing

    task = SCREENER_TASK_TEMPLATE.format(
        phone_number=alert.phone_number,
        claimed_reason=alert.claimed_reason or "an urgent account issue",
    )
    call_result = call_client.place_screening_call(alert.phone_number, task)

    if guardrails is not None:
        guardrails.record_call(alert.phone_number)

    tags = tagger(call_result.transcript, catalog)

    result = score(tags, catalog, call_result.transcript, call_result.metadata)
    result.precheck = precheck
    result.structured_result = call_result.structured_result
    result.completion_confidence = call_result.completion_confidence
    return result
