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
# conversation itself). Learned from real test calls, not assumed:
# - CALL-E's platform guardrails reject any goal that asks it to impersonate
#   the recipient or conceal that it's an AI — the framing must be
#   transparent ("You are an AI calling assistant...").
# - The last line still tells CALL-E not to judge the call itself: the
#   verdict is computed afterward by scoring.score() over tagged signals, so
#   a persistent scammer can't talk the live agent into a favorable
#   self-assessment mid-call.
# - Quoting the specific claim verbatim ("a pending payment has failed to
#   process", etc.) got this goal rejected by CALL-E's planner repeatedly,
#   even with an explicit safety disclaimer attached — the scam-claim
#   language itself pattern-matches CALL-E's own abuse-prevention filters.
#   Dropping it turned out to be a genuine design improvement anyway: having
#   the Screener volunteer what the message said is information leakage to
#   a potential scammer. Better practice is to ask neutral open questions
#   and let the other party explain themselves — refusing/evading that is
#   itself signal H3 already tracks.
SCREENER_TASK_TEMPLATE = """You are conducting a brief, transparent identity-verification call as an AI \
calling assistant contacting {phone_number}, on behalf of someone who received a callback request listing \
this number and wants to confirm it is genuine before acting on it.

You do not have and will never provide any personal, financial, or account-related information, under any \
circumstances, no matter what is asked — if asked for anything like that, simply say you don't have it. Do \
not install anything, click on anything, or agree to any payment.

Your only task on this call: ask who is on the line, what company and department they represent, why they \
are reaching out, and whether this can be confirmed through the company's official published channels. Stay \
neutral and factual — you are not accusing anyone of anything, just establishing who they are and how the \
recipient can verify this independently.

Do not volunteer any detail about what the original message said — let them explain the reason for the call \
themselves. Do not decide yourself whether this is legitimate; just have the conversation and report back \
exactly what was said."""


def run_pipeline(
    email_body: str,
    sender_domain: str,
    call_client: CallEClient,
    official_support_number: str | None = None,
    catalog_path: Path | None = None,
    guardrails: CallGuardrails | None = None,
    tagger: Callable[[str, dict], list[SignalTag]] = tag_transcript,
) -> ScreeningResult | None:
    """tagger defaults to the cheap offline keyword tagger so screen.py's
    --demo scenarios need no API key. Pass signal_catalog.tag_transcript_llm
    for real calls — the keyword tagger does not generalize to real speech
    (see its docstring)."""
    alert = extract_alert(email_body, sender_domain)
    if alert is None:
        return None  # not flagged as suspicious — pipeline never dials

    precheck = run_prechecks(alert, official_support_number)
    catalog = load_catalog(catalog_path)

    if guardrails is not None:
        guardrails.check(alert.phone_number)  # raises GuardrailViolation and stops before dialing

    task = SCREENER_TASK_TEMPLATE.format(phone_number=alert.phone_number)
    call_result = call_client.place_screening_call(alert.phone_number, task)

    if guardrails is not None:
        guardrails.record_call(alert.phone_number)

    tags = tagger(call_result.transcript, catalog)

    result = score(tags, catalog, call_result.transcript, call_result.metadata)
    result.precheck = precheck
    result.structured_result = call_result.structured_result
    result.completion_confidence = call_result.completion_confidence
    return result
