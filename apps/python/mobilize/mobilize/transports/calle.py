"""Real CALL-E transport, implemented directly against the REST API rather
than the synchronous `calle-ai` SDK.

Why REST instead of the SDK's `create_and_wait`: `create_and_wait` blocks the
calling thread until the call reaches a terminal state, which makes true
concurrent wave dispatch impossible without one thread per call. The REST
API's `create` (non-blocking dispatch) + `get` (poll) pair, called through
`httpx.AsyncClient`, lets many calls run concurrently on one event loop --
which is the entire point of this project. This is the "REST API" surface
named in the integration plan, used because the architecture requires it,
not for coverage's sake.
"""

from __future__ import annotations

import os
import re

import httpx

from mobilize.core.commitment import calibrated_commitment
from mobilize.core.types import Candidate, CallOutcome, CallResult, utcnow
from mobilize.transports.base import (
    MOBILIZE_RESULT_SCHEMA,
    build_task_prompt,
    validate_e164,
    validate_trusted_base_url,
)

CALLE_BASE_URL = os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com")
TERMINAL_STATUSES = {"completed", "failed", "canceled"}

# structured_result is a provider-authored extraction and can be wrong or
# stale, especially on a call that didn't cleanly complete -- can_come=="yes"
# is not itself proof the recipient agreed. This cross-checks against the
# recipient's OWN spoken words in the transcript (speaker == "user").
#
# A denial-word blocklist alone fails open: "Maybe, I am not sure." and "I
# will stay home." contain none of the tokens below on their own, so a
# denial-only check would let provider-authored can_come="yes" through
# uncorroborated for both. Corroboration instead requires the recipient's
# own words to contain some AFFIRMATIVE commitment language -- absence of a
# denial is not the same as presence of an agreement. Hedge language
# ("maybe", "i think", "we'll see" -- mirroring commitment.py's own
# HEDGE_MARKERS) deliberately does NOT count as affirmation: a hedge is not
# a commitment, firm or soft, in the recipient's own words.
#
# Two further failure modes on top of the denial-phrase list, both about
# the SAME root cause: an affirmation regex matched an embedded phrase
# with no regard for what wraps it. "Not right now" matches on "right
# now"; "I don't think I can make it" matches on "i can make it" -- and a
# denial-phrase list can only ever catch wordings someone anticipated,
# never the next unlisted reversal. Listing more phrases forever chases
# the last repro instead of closing the class of bug.
#
# Fixed properly with two mechanisms instead of a longer list:
#
# 1. NEGATION SCOPE, not more denial phrases: split each recipient turn
#    into clauses (on sentence punctuation and contrastive words like
#    "but"/"actually"/"however"), and if a GENERIC negation cue (no, not,
#    don't, doesn't, won't, can't, never, unable, ...) appears anywhere in
#    a clause, the WHOLE clause is treated as a denial -- including any
#    affirmative-sounding phrase later in that same clause. This fails
#    closed on any embedded affirmation the cue happens to wrap, not just
#    the specific phrasings already on a list.
# 2. LATEST clause wins, not just latest turn: "Yes, I am definitely
#    coming" ... "Actually I need to stay home" must resolve to the LATER
#    statement, the same way a human listening to the whole call would.
_NEGATION_CUE_RE = re.compile(
    r"\b(no|not|never|don'?t|doesn'?t|didn'?t|won'?t|can'?t|cannot|unable|nope|nah)\b",
    re.IGNORECASE,
)
_RECIPIENT_DENIAL_RE = re.compile(
    # Decline phrases that don't contain a generic negation cue word above
    # and so wouldn't otherwise be caught by _NEGATION_CUE_RE.
    r"\b(not going to make it|stay(ing)?\s+home|stay(ing)?\s+in|change[ds]?\s+my\s+mind)\b",
    re.IGNORECASE,
)
_RECIPIENT_AFFIRMATION_RE = re.compile(
    # "sure" deliberately excluded on its own -- "not sure" is a hedge, not
    # an affirmation, and a bare word-boundary match can't tell them apart.
    # "for sure" is kept since that phrase itself only occurs as agreement.
    r"\b(yes|yeah|yep|yup|absolutely|definitely|for sure|okay|ok|"
    r"i can (come|make it|help)|i'?ll (come|be there|help)|"
    r"coming|on my way|leaving(\s+now)?|be there|right now)\b",
    re.IGNORECASE,
)
_CLAUSE_SPLIT_RE = re.compile(r"[.,;!?]+|\bbut\b|\bactually\b|\bhowever\b", re.IGNORECASE)


def _recipient_text(transcript: list[dict]) -> str:
    return " ".join(turn.get("text", "") for turn in transcript if turn.get("speaker") == "user")


def _clause_signal(clause: str) -> str:
    """"affirm" / "deny" / "neutral" for a single clause. A negation cue OR
    a listed decline phrase ANYWHERE in the clause fails the whole clause
    closed as a denial -- checked before affirmation, so an affirmative
    phrase later in the SAME clause never overrides the negation that
    wraps it."""
    if _NEGATION_CUE_RE.search(clause) or _RECIPIENT_DENIAL_RE.search(clause):
        return "deny"
    if _RECIPIENT_AFFIRMATION_RE.search(clause):
        return "affirm"
    return "neutral"


def _recipient_effective_position(transcript: list[dict]) -> str:
    """"affirm" / "deny" / "neutral" -- the recipient's LATEST clearly-
    signaled position, not just whether an affirmative phrase appears
    anywhere in the call. Each recipient turn is split into clauses and
    each clause classified independently, in order; a clause with a clear
    signal updates the running position, a clause with neither leaves it
    unchanged. The position after the LAST signaled clause is returned --
    so a later retraction always wins over an earlier "yes", exactly as it
    would for a human listening to the whole call."""
    position = "neutral"
    for turn in transcript:
        if turn.get("speaker") != "user":
            continue
        for clause in _CLAUSE_SPLIT_RE.split(turn.get("text", "")):
            clause = clause.strip()
            if not clause:
                continue
            signal = _clause_signal(clause)
            if signal != "neutral":
                position = signal
    return position


def _recipient_corroborates_commitment(transcript: list[dict]) -> bool:
    return _recipient_effective_position(transcript) == "affirm"


class CalleTransport:
    def __init__(self, *, api_key: str | None = None, base_url: str = CALLE_BASE_URL, region: str = "US", locale: str = "en-US"):
        validate_trusted_base_url(base_url)
        self._api_key = api_key or os.environ["CALLE_API_KEY"]
        self._region = region
        self._locale = locale
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
            timeout=30.0,
        )
        # Full candidate, keyed by call_id, so poll() can bind a returned
        # result back to the specific candidate it was dispatched for and
        # refuse to count a confirmation that doesn't match.
        self._candidate_by_call_id: dict[str, Candidate] = {}

    async def dispatch(self, candidate: Candidate, need_label: str, location: str, *, idempotency_key: str) -> str:
        validate_e164(candidate.phone)
        # Per-candidate region/locale override the transport's own default
        # -- a registry with recipients in more than one country cannot be
        # correctly represented by a single fixed region on the transport
        # instance. CALL-E uses this field for routing and compliance
        # checks, so getting it wrong is a real correctness issue, not
        # cosmetic.
        region = candidate.region or self._region
        locale = candidate.locale or self._locale
        body = {
            "task": build_task_prompt(need_label, location),
            "recipients": [{"phones": [candidate.phone], "region": region, "locale": locale}],
            "result_schema": MOBILIZE_RESULT_SCHEMA,
            "metadata": {"candidate_id": candidate.id},
        }
        # Use the ledger's own precomputed key as CALL-E's Idempotency-Key,
        # not an ad hoc one built here. If the process crashes after CALL-E
        # accepts the call but before the ledger write completes, a retry on
        # restart sends this exact same key -- CALL-E returns the original
        # call instead of placing a second one.
        headers = {"Idempotency-Key": idempotency_key[:255]}
        response = await self._client.post("/v1/calls", json=body, headers=headers)
        response.raise_for_status()
        payload = response.json()
        call_id = payload["id"]
        self._candidate_by_call_id[call_id] = candidate
        return call_id

    async def poll(self, call_id: str, *, expected_candidate: Candidate | None = None) -> CallResult | None:
        response = await self._client.get(f"/v1/calls/{call_id}")
        response.raise_for_status()
        call = response.json()

        if call.get("status") not in TERMINAL_STATUSES:
            return None

        # Prefer the caller-supplied candidate (the dispatcher knows who
        # every in-flight call_id belongs to, from the ledger, even after a
        # restart) over this instance's own in-memory cache, which is empty
        # on a fresh CalleTransport following a crash. Falling back to the
        # cache keeps binding validation working for direct callers of this
        # transport that don't pass expected_candidate explicitly.
        candidate = expected_candidate or self._candidate_by_call_id.get(call_id)
        return _to_call_result(call_id, call, candidate)

    async def aclose(self) -> None:
        await self._client.aclose()


def _to_call_result(call_id: str, call: dict, expected_candidate: Candidate | None) -> CallResult:
    recipients = call.get("recipients") or []
    recipient = recipients[0] if recipients else {}
    structured = recipient.get("structured_result") or call.get("structured_result") or {}
    returned_candidate_id = (call.get("metadata") or {}).get("candidate_id", "unknown")

    # Bind the result to the candidate we actually dispatched to before
    # trusting anything it says. Two independent checks: the metadata we
    # attached at dispatch time round-trips, and the phone CALL-E dialed
    # matches the candidate's phone. A mismatch on either means something is
    # wrong upstream (a reused call_id, a metadata bug, a provider mixup) and
    # this result must never silently count as a confirmation.
    mismatch = False
    if expected_candidate is not None:
        if returned_candidate_id != expected_candidate.id:
            mismatch = True
        recipient_phones = recipient.get("phones") or []
        if recipient_phones and expected_candidate.phone not in recipient_phones:
            mismatch = True

    candidate_id = expected_candidate.id if expected_candidate is not None else returned_candidate_id

    if mismatch:
        return CallResult(
            call_id=call_id,
            candidate_id=candidate_id,
            outcome=CallOutcome.FAILED,
            commitment_score=0.0,
            stated_yes=False,
            evidence=(
                f"Result binding mismatch: expected candidate {candidate_id!r}, "
                f"call metadata/phone did not match. Discarded rather than counted."
            ),
            transcript=[],
            completed_at=utcnow(),
            raw=call,
        )

    attempts = recipient.get("attempts") or []
    transcript: list[dict] = []
    for attempt in attempts:
        transcript.extend(attempt.get("transcript_turns") or [])

    can_come = structured.get("can_come", "unknown")
    evidence = structured.get("evidence_summary", "") or (call.get("summary") or "")
    prior_showup_rate = expected_candidate.historical_showup_rate if expected_candidate is not None else 0.5
    # Only "yes" counts as an opt-out request -- "unknown" (e.g. the call
    # didn't connect clearly) must never be treated as a do-not-call signal.
    stop_requested = structured.get("wants_no_further_contact") == "yes"

    call_status = call.get("status")
    task_completed = call.get("task_completed")

    # A call that never actually completed must never become a
    # confirmation, no matter what structured_result claims. "canceled" was
    # already treated as terminal (poll() returns instead of waiting
    # forever), but outcome determination previously checked only for
    # "failed" explicitly -- a canceled call with some stray/partial
    # structured_result data could fall through to the can_come=="yes"
    # branch and be counted as a real, firm confirmation. Checked first,
    # before anything else looks at can_come.
    if call_status in ("failed", "canceled") or recipient.get("status") in ("failed", "canceled"):
        outcome, commitment = CallOutcome.NO_ANSWER, 0.0
    # CALL-E's own task_completed is a second, independent signal from the
    # structured extraction. If CALL-E itself says the call didn't
    # accomplish its task, a "yes" in structured_result is extraction noise
    # (or a stale/partial value), not a real confirmation -- don't trust it
    # over CALL-E's own completion judgment. (An explicit False is rejected
    # unconditionally here; the yes-branch below additionally requires an
    # explicit True rather than treating an absent/None value as "no
    # contradiction" -- see that branch for why.)
    elif task_completed is False:
        outcome, commitment = CallOutcome.NO_ANSWER, 0.0
    elif can_come == "no":
        outcome, commitment = CallOutcome.NO, 0.0
    elif can_come == "yes":
        # A "yes" with literally no transcript evidence behind it is
        # inherently suspicious -- either the call never really connected
        # (contradicting can_come) or the response is malformed. Refuse to
        # count it as a confirmation rather than trust an unsupported claim.
        if not transcript:
            outcome, commitment = CallOutcome.NO_ANSWER, 0.0
        # A confirmation requires CALL-E's OWN affirmative completion
        # signal -- not merely the absence of an explicit False. At this
        # point task_completed can only be True or None (False was already
        # rejected above), and None must not silently pass as "no
        # contradiction" when what's being decided is whether to count
        # someone as a real, confirmed commitment. Only an explicit True
        # is trusted.
        elif task_completed is not True:
            outcome, commitment = CallOutcome.NO_ANSWER, 0.0
        # Cross-check the structured "yes" against what the recipient
        # actually said. structured_result/evidence_summary are
        # provider-authored extractions and can misread or fabricate a
        # commitment -- the recipient's own words must affirmatively
        # corroborate it, not merely fail to contradict it.
        elif not _recipient_corroborates_commitment(transcript):
            outcome, commitment = CallOutcome.NO_ANSWER, 0.0
        else:
            # Score firmness from the recipient's OWN words (already
            # verified above to contain a real affirmation), not from
            # structured_result's evidence_summary -- that field is a
            # provider-authored paraphrase and can drift from what was
            # actually said. Gating the yes/no decision on the transcript
            # while still scoring confidence off an unverified paraphrase
            # would let fabricated firm language ("definitely, leaving
            # right now!") inflate a weak, only-just-corroborated response
            # into a firm_yes. `evidence` (evidence_summary) is kept on the
            # result purely for human-readable display, not for scoring.
            commitment = calibrated_commitment(
                evidence=_recipient_text(transcript), candidate_prior_showup_rate=prior_showup_rate
            )
            outcome = CallOutcome.FIRM_YES if commitment >= 0.6 else CallOutcome.SOFT_YES
    else:
        outcome, commitment = CallOutcome.NO_ANSWER, 0.0

    return CallResult(
        call_id=call_id,
        candidate_id=candidate_id,
        outcome=outcome,
        commitment_score=commitment,
        stated_yes=(can_come == "yes"),
        stop_requested=stop_requested,
        evidence=evidence,
        transcript=transcript,
        completed_at=utcnow(),
        raw=call,
    )
