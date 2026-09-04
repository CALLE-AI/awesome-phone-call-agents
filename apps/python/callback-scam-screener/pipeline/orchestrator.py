from pathlib import Path
from typing import Callable

from .caller import CallEClient, RealCallEClient
from .guardrails import CallGuardrails, GuardrailViolation, full_digits_match, mask_phone_number, redact_phone_number
from .models import ScreeningResult, SignalTag
from .precheck import run_prechecks
from .signal_catalog import load_catalog, tag_transcript
from .scoring import USER_TURN_RE, score
from .trigger import extract_alert


class RecipientMismatch(RuntimeError):
    """Raised when CALL-E's own report of who it dialed doesn't match what
    was requested. Distinct from a plain RuntimeError (which screen.py
    reports as "CALL-E would not plan this call") because by the time this
    can fire, CALL-E has already planned, placed, and completed a real call
    — the failure is discovered *after* the fact, on the evidence, not
    during planning. Reported under its own exit code so the message and
    the documented meaning of the code both stay accurate."""

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
# - The recording/review disclosure near the top serves two purposes: it's
#   the kind of AI-voice-call disclosure regulators like the FCC's TCPA
#   rules expect (not a compliance guarantee — we're not lawyers), and it
#   protects the other party's data, not just ours — a real company rep
#   might otherwise recite genuine customer/account details without
#   thinking, not realizing the call is transcribed and reviewed.
SCREENER_TASK_TEMPLATE = """You are conducting a brief, transparent identity-verification call as an AI \
calling assistant contacting {phone_number}, on behalf of someone who received a callback request listing \
this number and wants to confirm it is genuine before acting on it.

Early in the call, let them know plainly that the call may be recorded and reviewed as part of this \
verification, and ask them not to share any sensitive personal, account, or payment details about \
themselves or anyone else — none are needed for this conversation.

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
    to_phone: str | None = None,
    official_support_number: str | None = None,
    catalog_path: Path | None = None,
    guardrails: CallGuardrails | None = None,
    tagger: Callable[[str, dict], list[SignalTag]] = tag_transcript,
) -> ScreeningResult | None:
    """tagger defaults to the cheap offline keyword tagger so screen.py's
    --demo scenarios need no API key. Pass signal_catalog.tag_transcript_llm
    for real calls — the keyword tagger does not generalize to real speech
    (see its docstring).

    to_phone is the human-confirmed, already-validated E.164 number to
    actually dial (screen.py's --to-phone, after it's been checked to match
    the email). When omitted (preview/--demo), the raw regex-extracted
    alert.phone_number is used instead purely for display/scoring — nothing
    is dialed in those paths anyway. Dialing the confirmed value rather than
    the loosely-formatted extracted text matters: the extraction regex finds
    numbers in whatever format a real email happens to use (e.g. "(800)
    555-0187"), which is not guaranteed to be a strict, unambiguous E.164
    number — --to-phone is what a human actually typed and CALL-E's
    guardrails validated."""
    alert = extract_alert(email_body, sender_domain)
    if alert is None:
        return None  # not flagged as suspicious — pipeline never dials

    # Fail closed at the library boundary too, not just in screen.py: a
    # caller that supplies a real, dialing client but skips guardrails would
    # otherwise dial with no allowlist, no repeat-dial protection, and no
    # call cap. MockCallEClient (--demo/preview) never dials, so it's exempt.
    if guardrails is None and isinstance(call_client, RealCallEClient):
        raise GuardrailViolation(
            "RealCallEClient was passed without guardrails — refusing to dial. "
            "Pass a CallGuardrails instance (with an explicit allowlist or unrestricted=True)."
        )

    precheck = run_prechecks(alert, official_support_number)
    catalog = load_catalog(catalog_path)

    dial_number = to_phone or alert.phone_number

    if guardrails is not None:
        guardrails.check(dial_number)  # raises GuardrailViolation and stops before dialing
        guardrails.record_attempt(dial_number)  # before dialing, not after — see record_attempt's docstring

    task = SCREENER_TASK_TEMPLATE.format(phone_number=dial_number)
    call_result = call_client.place_screening_call(dial_number, task)

    # Recipient binding: compare by full digit sequence (full_digits_match),
    # not exact string and not normalize_phone's last-10-digits form.
    # dial_number is always our own validated E.164 string, but
    # call_result.metadata.number_dialed may be CALL-E's own rendering of
    # the same real number — with or without "+", with different
    # separators — and an exact-string comparison would reject a
    # successfully completed real call over formatting alone, discarding
    # its transcript and permanently marking the number as an unresolved
    # attempt (see record_attempt) for no real reason. full_digits_match
    # still requires the complete digit sequence including country code,
    # so it stays safe against the cross-country aliasing exact matching
    # was introduced to prevent — only truncated forms (normalize_phone)
    # are unsafe here, not full untruncated ones.
    if not full_digits_match(call_result.metadata.number_dialed, dial_number):
        got = mask_phone_number(call_result.metadata.number_dialed, call_result.metadata.number_dialed)
        expected = mask_phone_number(dial_number, dial_number)
        raise RecipientMismatch(
            f"Call result is for {got!r} but {expected!r} was requested "
            "— refusing to score a verdict against a mismatched recipient. CALL-E already placed and "
            "completed this call; the transcript is being discarded rather than scored against the wrong "
            "number. Check `calle call status` for the actual destination before retrying."
        )

    if guardrails is not None:
        guardrails.record_call(dial_number)

    # Redact the phone number before it reaches a third-party LLM API — the
    # transcript is speech-to-text of a real conversation, so if either party
    # ever said the number aloud it would otherwise be sent verbatim. The
    # unredacted transcript is still what's scored and returned below; this
    # redaction is scoped to the LLM call only.
    #
    # Skip tagging entirely when CALL-E reports the call was picked up by an
    # answering machine, or when the transcript has no speech from the other
    # party at all (silent pickup/dead air) — score() discards any tags in
    # both cases anyway (see answered_by_machine and USER_TURN_RE), so
    # tagging first would just spend real LLM budget on a result that's
    # thrown away.
    if call_result.metadata.answered_by_machine or not USER_TURN_RE.search(call_result.transcript):
        tags = []
    else:
        redacted_transcript = redact_phone_number(call_result.transcript, dial_number)
        tags = tagger(redacted_transcript, catalog)

    result = score(tags, catalog, call_result.transcript, call_result.metadata)
    result.precheck = precheck
    result.structured_result = call_result.structured_result
    result.completion_confidence = call_result.completion_confidence
    return result
