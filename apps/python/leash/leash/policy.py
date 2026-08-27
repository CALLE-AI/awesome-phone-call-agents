"""The gate. Twelve conditions keep a lease alive; any one failure ends it.

Pure functions. No network, no clock, no files, no randomness: the same CallOutcome and
the same threshold always produce the same Verdict, which is what makes this module the
part of LEASH worth reading.

`evaluate()` reads one finished call and answers a single question: does the lease keep
running, or is it released. Released means the refresh token is revoked at Google's token
endpoint and the unattended agent cannot mint another one without a human at a browser.

The asymmetry is the whole design:

    keep     requires all twelve conditions in CONDITION_NAMES to hold simultaneously
    release  requires exactly one of them to fail

The call cannot hand the agent anything. "continue" is not something the person on the
phone gives out; it is the absence of a release, and that absence has to be established
twelve separate ways. Everything else lands on release: a machine answering, a call that
never reaches a terminal state, a null structured_result, a structured result that
disagrees with its own transcript, a wrong answer, a hesitation, or a defect in this
file. In a system that hands out capability, a failed call is a no-op. Here a failed call
is the loudest outcome there is.

Four consequences of the asymmetry, written down because they otherwise read as bugs:

  * Missing data never means "assume fine". Absent confidence, absent label, absent
    evidence, a malformed structured_result, wrong types, missing keys: each becomes a
    Condition with held=False and a detail string that says what was actually seen.
  * Nothing here may raise. Every check runs inside a guard that converts an exception
    into a failed condition, and so does every step of evaluate() after them, so a defect
    in this module releases the lease instead of keeping a live credential on data nobody
    managed to read. evaluate() returns a Verdict for any input at all, including None.
  * Unreadable numbers are not permissive numbers. NaN compares False against every
    threshold, and json.loads accepts a bare NaN by default, so both the score and the
    threshold are checked for being finite before they are compared. Without that, one
    NaN in a snapshot keeps the lease with all twelve conditions reported as holding.
  * Condition 12, and the read-back that condition 8 checks, exist because of things that
    happened on real calls to this number. Their comments say so; they are the most
    load-bearing lines here. Condition 10 is different: no voicemail has been observed on
    this number, and its comment claims only what the platform documents.

`expected_job_id` is not a thirteenth condition. It names the lease the verdict belongs
to, and it is stamped into the summary so a verdict can never be quoted for a different
job without the mismatch being visible. If the snapshot itself names a different job the
verdict releases. That guard can only ever release; nothing outside the twelve can make
this module keep a lease alive.

One invariant holds for every Verdict this module returns, so that no caller can
recompute the answer and disagree with it:

    verdict.release == bool(verdict.failed)

The twelve are always reported. The lease-identity guard is reported alongside them only
when it fires, which is the only way it can ever appear, because it has no holding state
to report.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable

from .outcomes import CallOutcome, Condition, Verdict

__all__ = [
    "CONDITION_NAMES",
    "CONTINUE_DECISION",
    "LEASE_IDENTITY_GUARD",
    "MIN_USER_TURNS",
    "MIN_USER_SPEECH_CHARS",
    "DEFAULT_MIN_CONFIDENCE",
    "evaluate",
    "reason_leans_stop",
    "evidence_supports_continue",
]

# The twelve, in the order they are reported. The wiring guard further down fails at
# import if this tuple and the check table drift apart; the README's count of them is
# prose and has to be kept in step by hand, so a test should assert this length too.
CONDITION_NAMES: tuple[str, ...] = (
    "reached_terminal",
    "status_completed",
    "task_completed_true",
    "confidence_at_or_above_threshold",
    "confidence_label_not_low",
    "structured_result_present",
    "decision_is_continue",
    "readback_confirmed",
    "spoke_with_person",
    "live_human_evidence_in_transcript",
    "evidence_supports_decision",
    "reason_does_not_contradict_decision",
)

# Not one of the twelve: it has no holding state and can only ever release. It is
# reported as a failed Condition when it fires so that release and failed never disagree.
LEASE_IDENTITY_GUARD = "verdict_is_about_this_lease"

# Reported only if writing the summary itself fails, which would otherwise be the one
# defect in this file that could leave release and failed disagreeing.
_SUMMARY_GUARD = "verdict_summary_written"

DEFAULT_MIN_CONFIDENCE = 0.80

# Voicemail guard thresholds. See _check_live_human_evidence_in_transcript.
MIN_USER_TURNS = 2
MIN_USER_SPEECH_CHARS = 40

# The only value of job_decision that can keep a lease. Anything else, including the
# in-band escape value "unclear", releases.
CONTINUE_DECISION = "continue_job"

# Labels that are not good enough to keep a credential alive. Any label containing "low"
# is treated as low as well, so "very_low" and "low_confidence" need no entry here.
_WEAK_CONFIDENCE_LABELS = frozenset(
    {"poor", "none", "unknown", "uncertain", "insufficient", "n/a", "na"}
)

# A threshold no score can meet. Used wherever the caller's threshold cannot be read as a
# number in [0, 1]: an unusable threshold has to become the strictest one, never the
# most permissive one.
_IMPOSSIBLE_THRESHOLD = float("inf")


# --------------------------------------------------------------------------------------
# Text normalisation and redaction
#
# Everything below matches against transcribed speech and model-written prose, so it has
# to survive curly apostrophes, contractions written both ways, doubled spaces (the live
# transcripts are full of them) and inconsistent case.
# --------------------------------------------------------------------------------------

_PUNCTUATION_FIXES = {
    "‘": "'",
    "’": "'",
    "‛": "'",
    "ʼ": "'",
    "“": '"',
    "”": '"',
    "–": "-",
    "—": "-",
    "…": " ",
}

_CONTRACTIONS: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(pattern), replacement)
    for pattern, replacement in (
        # "dont" with no apostrophe is common in speech transcription, so the apostrophe
        # is optional in every one of these.
        (r"\bdo\s?n'?t\b", "do not"),
        (r"\bdoes\s?n'?t\b", "does not"),
        (r"\bdid\s?n'?t\b", "did not"),
        (r"\bca\s?n'?t\b", "can not"),
        (r"\bcannot\b", "can not"),
        (r"\bwo\s?n'?t\b", "will not"),
        (r"\bwould\s?n'?t\b", "would not"),
        (r"\bshould\s?n'?t\b", "should not"),
        (r"\bis\s?n'?t\b", "is not"),
        (r"\bai\s?n'?t\b", "is not"),
        (r"\bit'?s\b", "it is"),
        (r"\bthat'?s\b", "that is"),
        (r"\blet'?s\b", "let us"),
    )
)

# Anything phone-number-shaped: an optional +, then at least seven digits, allowing the
# spaces, dashes, dots and brackets a transcriber or a provider might put between them.
_PHONE_SHAPED = re.compile(r"\+?\d[\d\s().\-]{5,}\d")


def _normalise(text: str) -> str:
    """Lowercase, straighten quotes, expand contractions, collapse whitespace.

    Sentence-ending periods are kept: the evidence patterns use them as boundaries so a
    verb in one sentence cannot bind to a word in the next.
    """
    out = text
    for bad, good in _PUNCTUATION_FIXES.items():
        out = out.replace(bad, good)
    out = out.lower()
    for pattern, replacement in _CONTRACTIONS:
        out = pattern.sub(replacement, out)
    return re.sub(r"\s+", " ", out).strip()


def _redact(text: str) -> str:
    """Mask anything phone-number-shaped before it can reach a detail string.

    Details end up in the run log and on screen. Three of the strings quoted in this
    module are free-form and outside our control: failure_code (no enum, provider-written
    prose), the evidence entries, and reason_sentence, which is whatever the person on the
    phone said. The house rule is that no unmasked number reaches a log, and the cheapest
    way to keep it here is to mask at the point of quoting rather than to trust every
    upstream writer.

    A long digit run that is not a phone number is masked too. That is the right trade:
    an account number or an order number in a spoken sentence is not something this
    module should be echoing either.
    """

    def mask(match: re.Match[str]) -> str:
        raw = match.group(0)
        digits = "".join(ch for ch in raw if ch.isdigit())
        if len(digits) < 7:
            return raw
        lead = "+" if raw.lstrip().startswith("+") else ""
        return f"{lead}{digits[:2]}{'*' * (len(digits) - 4)}{digits[-2:]}"

    return _PHONE_SHAPED.sub(mask, text)


def _clip(text: str, limit: int = 120) -> str:
    """Trim a quoted fragment so a detail string stays readable in a log line."""
    flat = re.sub(r"\s+", " ", text).strip()
    return flat if len(flat) <= limit else flat[: limit - 3] + "..."


def _safe(text: object, limit: int = 120) -> str:
    """Redact then clip. Every free-form string quoted in a detail goes through here."""
    return _clip(_redact(text if isinstance(text, str) else repr(text)), limit)


def _describe(exc: BaseException) -> str:
    """Name an exception without trusting its own __str__ not to raise in turn.

    This runs inside except blocks that exist so the lease can be released on a defect.
    An exception whose message raises while we are writing the failure detail would
    escape those blocks and take evaluate() with it, so the type name is the floor.
    """
    name = type(exc).__name__
    try:
        text = _safe(str(exc), 200)
    except Exception:  # noqa: BLE001 - the type name alone is enough to release on
        return name
    return f"{name}: {text}" if text else name


# --------------------------------------------------------------------------------------
# Condition 12: the contradiction check
# --------------------------------------------------------------------------------------

# Returned instead of None when there is no reason to read at all. None is the permissive
# answer in this module, and the permissive answer must never be the answer to garbage.
_UNREADABLE_REASON = "no readable reason"

# Phrases that make a sentence read as "end this", regardless of which word the caller
# picked when asked the direct question. The list is deliberately broad: a false match
# releases a lease that could have kept running, which costs one browser round trip, and
# a missed match keeps a live credential against the caller's actual intent.
_STOP_LEANING_REASON: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(pattern), label)
    for pattern, label in (
        # Derived from a live acceptance call of our own, where the caller chose
        # caller said "continue" twice, confirmed the read-back, then explained
        # continue and then gave a reason that plainly meant stop. The call identifier
        # and the verbatim wording are withheld under the repository privacy rule.
        (r"\btake (?:it|that|them|the job|the lease) back\b", "take it back"),
        (r"\bdone enough\b", "done enough"),
        (r"\b(?:that is|it is|thats) enough\b", "that is enough"),
        (r"\benough already\b", "enough already"),
        (r"\bshut (?:it|this|that|the job)? ?down\b", "shut it down"),
        (r"\bshut down\b", "shut down"),
        (r"\bdo not (?:let|want|need|trust)\b", "do not let it"),
        (r"\bno (?:longer|more)\b", "no more"),
        (r"\bnot any ?more\b", "not any more"),
        (r"\bstops?\b", "stop"),
        (r"\bstopping\b", "stopping"),
        (r"\bhalts?\b", "halt"),
        (r"\bcancel(?:led|ed|s)?\b", "cancel"),
        (r"\bkill (?:it|this|that|the job)\b", "kill it"),
        (r"\bkill it\b", "kill it"),
        (r"\babort\b", "abort"),
        (r"\bend (?:it|this|that|the job|the lease)\b", "end it"),
        (r"\bcut it off\b", "cut it off"),
        (r"\bcall it off\b", "call it off"),
        (r"\bpull the plug\b", "pull the plug"),
        (r"\brevoke\b", "revoke"),
        (r"\btake (?:it|the credential|the token) away\b", "take it away"),
        (r"\bhands? off\b", "hands off"),
        (r"\bback out\b", "back out"),
        (r"\broll (?:it|that|this) back\b", "roll it back"),
        (r"\bundo\b", "undo"),
        (r"\b(?:leave|keep) (?:it|the job) paused\b", "leave it paused"),
        (r"\bstay paused\b", "stay paused"),
        (r"\bwind (?:it|this|that) down\b", "wind it down"),
        (r"\bpause (?:it|the job)\b", "pause it"),
        (r"\bhold off\b", "hold off"),
    )
)


def reason_leans_stop(sentence: object) -> str | None:
    """Return the phrase that makes a reason read as stop-leaning, or None.

    This is a heuristic, and it is honest about being one. It is lexical: it does not
    parse the sentence and it does not model negation, so "do not stop it" matches on
    "stop" and reads as stop-leaning. That direction of error is chosen on purpose. A
    false match releases a lease and costs a person one trip to a browser; a missed match
    leaves a live Google credential in an unattended agent's hands after its owner has
    said, in their own words, that they want it back.

    The escape value "NONE" (the caller gave no reason) is not stop-leaning: the schema
    uses it precisely so the extractor never has to null the whole object, and treating
    it as intent would punish an ordinary call where nobody explained themselves.

    Anything that is not a readable sentence -- the wrong type, or empty after
    normalisation -- returns _UNREADABLE_REASON rather than None. An empty
    reason_sentence is not the schema's way of saying "no reason": that is the literal
    word NONE. Returning None for it would make a malformed field the permissive answer,
    which is the one thing this module never does.
    """
    if not isinstance(sentence, str):
        return _UNREADABLE_REASON
    text = _normalise(sentence)
    if not text:
        return _UNREADABLE_REASON
    if text.strip(" .") == "none":
        return None
    for pattern, label in _STOP_LEANING_REASON:
        if pattern.search(text):
            return label
    return None


# --------------------------------------------------------------------------------------
# Condition 11: does the free-text evidence agree with the enum
# --------------------------------------------------------------------------------------

# Both tables are anchored on the whole word "continue" or "stop" next to a word about
# choosing, never on a bare substring. Live evidence from a stop call read "A live person
# answered and continued the call." — a substring test for "continu" would have read that
# as agreement with a continue decision, which is exactly the failure this condition is
# supposed to catch.
_CONTINUE_CHOICE_EVIDENCE: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"continue_job",
        r"\b(?:chose|choose|chosen|selected|picked|said|stated|wanted|opted|elected|confirmed|asked)\b[^.]{0,60}?\bcontinue\b",
        r"\bcontinue\b[^.]{0,30}?\bjob\b",
        r"\bjob\b[^.]{0,30}?\b(?:should|to|will|can|may)\s+continue\b",
        r"\b(?:choice|decision|answer|response|instruction)\b[^.]{0,40}?\bcontinue\b",
        r"\bkeep (?:the )?(?:job )?(?:running|going)\b",
    )
)

_STOP_CHOICE_EVIDENCE: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"stop_job",
        r"\b(?:chose|choose|chosen|selected|picked|said|stated|wanted|opted|elected|confirmed|asked|requested)\b[^.]{0,60}?\bstop\b",
        r"\bstop (?:the )?job\b",
        r"\bjob\b[^.]{0,30}?\b(?:should|to|will|must)\s+stop\b",
        r"\b(?:choice|decision|answer|response|instruction)\b[^.]{0,40}?\bstop\b",
        r"\b(?:halt|halted|cancel|cancelled|canceled|terminate|terminated|abort|aborted|revoke|revoked)\b",
    )
)


def evidence_supports_continue(evidence: object) -> tuple[bool, str]:
    """Decide whether the evidence list backs the continue branch. Returns (held, detail).

    Conservative on both sides. At least one entry has to name the continue branch, and
    no entry may name the stop branch: an evidence list that argues both ways is a list
    nobody should keep a credential on. An empty or unusable list fails, because absence
    of evidence is not evidence, and this gate fails toward release.

    The known false-release mode, written down so nobody has to rediscover it: an evidence
    entry that paraphrases the question rather than the answer ("the caller was asked
    whether the job should continue or stop") names both branches and reads as opposing.
    Neither live snapshot on file does that, and the cost if it happens is one browser
    round trip, so the tables are not loosened to accommodate it.
    """
    if not isinstance(evidence, (list, tuple)):
        return False, f"evidence is {type(evidence).__name__}, not a list; nothing to read"
    strings = [e for e in evidence if isinstance(e, str) and e.strip()]
    if not strings:
        return False, "evidence list is empty; with nothing to corroborate the enum this fails to the safe side"

    supporting: list[str] = []
    opposing: list[str] = []
    for entry in strings:
        text = _normalise(entry)
        if any(p.search(text) for p in _STOP_CHOICE_EVIDENCE):
            opposing.append(entry)
        elif any(p.search(text) for p in _CONTINUE_CHOICE_EVIDENCE):
            supporting.append(entry)

    if opposing:
        return False, f"evidence names the stop branch: {_safe(opposing[0])!r}"
    if not supporting:
        return False, (
            f"none of the {len(strings)} evidence entries names the continue branch; "
            f"first entry was {_safe(strings[0])!r}"
        )
    return True, f"evidence corroborates continue: {_safe(supporting[0])!r}"


# --------------------------------------------------------------------------------------
# Small readers that never raise
# --------------------------------------------------------------------------------------


def _field(outcome: CallOutcome, key: str) -> tuple[bool, str | None, str]:
    """Read one flat scalar out of structured_result. Returns (readable, value, note)."""
    result = outcome.structured_result
    if not isinstance(result, dict):
        # Extraction failure is silent and total: the whole object becomes null, so every
        # field-level condition has nothing to read and every one of them fails.
        return False, None, "structured_result is not present"
    if key not in result:
        return False, None, f"structured_result has no {key!r} (keys present: {sorted(map(str, result))})"
    value = result[key]
    if not isinstance(value, str):
        return False, None, f"{key} is {type(value).__name__} {_safe(value)}, expected a string"
    return True, value, ""


def _enum_condition(outcome: CallOutcome, name: str, key: str, wanted: str, note: str) -> Condition:
    readable, value, problem = _field(outcome, key)
    if not readable:
        return Condition(name, False, problem)
    if value.strip().lower() != wanted:
        return Condition(name, False, f"{key} is {_safe(value)!r}, not {wanted!r}; {note}")
    return Condition(name, True, f"{key} is {wanted!r}")


# --------------------------------------------------------------------------------------
# The twelve
# --------------------------------------------------------------------------------------


def _check_reached_terminal(outcome: CallOutcome, min_confidence: float) -> Condition:
    if not outcome.reached_terminal:
        return Condition(
            "reached_terminal",
            False,
            f"call never reached a terminal snapshot (last status seen: {outcome.status!r}); "
            "a call that does not finish is not a no-op here",
        )
    return Condition("reached_terminal", True, f"terminal snapshot observed with status {outcome.status!r}")


def _check_status_completed(outcome: CallOutcome, min_confidence: float) -> Condition:
    # failure_code is a free-form string on this platform, not an enum. It is recorded
    # verbatim (redacted, never parsed) and never compared against constants; a failed
    # call releases regardless of what the string says, so there is nothing to switch on.
    if outcome.status != "completed":
        extra: list[str] = []
        if outcome.failure_code:
            extra.append(f"failure_code (free-form, recorded verbatim): {_safe(outcome.failure_code)!r}")
        if outcome.error_code:
            extra.append(f"error code: {_safe(outcome.error_code)!r}")
        tail = "; " + "; ".join(extra) if extra else ""
        return Condition("status_completed", False, f"status is {outcome.status!r}, not 'completed'{tail}")
    return Condition("status_completed", True, "status is 'completed'")


def _check_task_completed_true(outcome: CallOutcome, min_confidence: float) -> Condition:
    if outcome.task_completed is True:
        return Condition("task_completed_true", True, "task_completed is True")
    return Condition(
        "task_completed_true",
        False,
        f"task_completed is {outcome.task_completed!r}; only True holds",
    )


def _check_confidence_at_or_above_threshold(outcome: CallOutcome, min_confidence: float) -> Condition:
    name = "confidence_at_or_above_threshold"
    score = outcome.confidence_score
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        return Condition(name, False, f"confidence score is {score!r}; there is no number to compare with {min_confidence:.2f}")
    value = float(score)
    # NaN compares False against everything, so "value < threshold" would hold this
    # condition for a score that means nothing. json.loads parses a bare NaN into a float
    # by default, which puts it one malformed payload away from the snapshot. An
    # infinity is nonsense for a 0-1 score as well; both release.
    if not math.isfinite(value):
        return Condition(name, False, f"confidence score is {score!r}, which is not a finite number")
    if value < min_confidence:
        return Condition(name, False, f"confidence {value:.2f} is below the {min_confidence:.2f} threshold")
    return Condition(name, True, f"confidence {value:.2f} is at or above the {min_confidence:.2f} threshold")


def _check_confidence_label_not_low(outcome: CallOutcome, min_confidence: float) -> Condition:
    name = "confidence_label_not_low"
    label = outcome.confidence_label
    if not isinstance(label, str) or not label.strip():
        return Condition(name, False, f"confidence label is {label!r}; an absent label cannot be confirmed as not-low")
    norm = re.sub(r"[\s_-]+", " ", label.strip().lower())
    if "low" in norm or norm in _WEAK_CONFIDENCE_LABELS:
        return Condition(name, False, f"confidence label is {_safe(label)!r}")
    return Condition(name, True, f"confidence label is {_safe(label)!r}")


def _check_structured_result_present(outcome: CallOutcome, min_confidence: float) -> Condition:
    name = "structured_result_present"
    result = outcome.structured_result
    if isinstance(result, dict):
        return Condition(name, True, f"structured_result present with keys {sorted(map(str, result))}")
    # Extraction failure is silent and total on this platform: one bad field nulls the
    # whole object while task_completed, confidence, evidence and the transcript survive.
    # That is why those four carry their own conditions and this one exists at all.
    return Condition(name, False, f"structured_result is {_safe(result)}; extraction failure is silent and total")


def _check_decision_is_continue(outcome: CallOutcome, min_confidence: float) -> Condition:
    return _enum_condition(
        outcome,
        "decision_is_continue",
        "job_decision",
        CONTINUE_DECISION,
        "'stop_job' and the escape value 'unclear' both release",
    )


def _check_readback_confirmed(outcome: CallOutcome, min_confidence: float) -> Condition:
    # The read-back is its own condition because speech recognition is not reliable on
    # this channel: on one of our live calls the caller's decision word was mis-transcribed as
    # a different single word, and only the agent repeating the choice back and getting a
    # "yes" recovered
    # the intent.
    return _enum_condition(
        outcome,
        "readback_confirmed",
        "choice_readback_confirmed",
        "yes",
        "an unconfirmed or corrected read-back releases",
    )


def _check_spoke_with_person(outcome: CallOutcome, min_confidence: float) -> Condition:
    return _enum_condition(
        outcome,
        "spoke_with_person",
        "spoke_with_person",
        "yes",
        "silence, a recording or an answering machine all release",
    )


def _check_live_human_evidence_in_transcript(outcome: CallOutcome, min_confidence: float) -> Condition:
    # Voicemail guard, built on what the platform documents rather than on anything we
    # have seen: CallStatus has exactly five values and none of them is voicemail, and the
    # docs state that a machine picking up can arrive as status "completed" with a machine
    # transcript. We have not had a voicemail on this number, so this condition is the one
    # place in the file where the reasoning is from the spec, not from a recording.
    # A machine cannot produce a back-and-forth, so the transcript itself has to show a
    # person taking more than one turn and saying more than a greeting's worth of words.
    #
    # Turns are counted, never quoted: the transcript is the least controlled text in the
    # system and it does not belong in a log line.
    name = "live_human_evidence_in_transcript"
    turns = outcome.user_turns
    if not isinstance(turns, (list, tuple)):
        return Condition(name, False, f"user turns are {type(turns).__name__}, not a sequence")
    texts = [t.text for t in turns if isinstance(getattr(t, "text", None), str) and t.text.strip()]
    speech_chars = sum(len(t.strip()) for t in texts)
    if len(texts) < MIN_USER_TURNS or speech_chars < MIN_USER_SPEECH_CHARS:
        return Condition(
            name,
            False,
            f"{len(texts)} user turn(s) and {speech_chars} characters of user speech; "
            f"need at least {MIN_USER_TURNS} turns and {MIN_USER_SPEECH_CHARS} characters "
            "to tell a person from a recording",
        )
    return Condition(
        name,
        True,
        f"{len(texts)} user turn(s), {speech_chars} characters of user speech",
    )


def _check_evidence_supports_decision(outcome: CallOutcome, min_confidence: float) -> Condition:
    # Continue is the only branch that can keep a lease, so this always asks whether the
    # evidence backs continue. On a stop call it fails, alongside decision_is_continue,
    # and both failures are true statements about the call.
    #
    # This condition exists because structured_result has been watched, live, to disagree
    # with the transcript and evidence it was extracted from at 0.88 to 0.93 confidence.
    # The enum alone is not a witness to anything.
    held, detail = evidence_supports_continue(outcome.evidence)
    return Condition("evidence_supports_decision", held, detail)


def _check_reason_does_not_contradict_decision(outcome: CallOutcome, min_confidence: float) -> Condition:
    """The contradiction check: the reason has to agree with the word the caller chose.

    On a live acceptance call of our own, to a phone we own, the caller
    said "continue" twice, confirmed the read-back, and then gave the reason "the jobs
    meant stop, at 0.92 confidence. Extraction was faithful; the person was
    the inconsistent party. A gate that trusted job_decision alone would have kept a live
    Google credential in an unattended agent against its owner's plainly stated intent.

    The check is lexical and heuristic, and it is biased toward release: see
    reason_leans_stop for what that costs and why the trade is made in that direction.
    """
    name = "reason_does_not_contradict_decision"
    readable, reason, problem = _field(outcome, "reason_sentence")
    if not readable:
        return Condition(name, False, f"{problem}; without the reason there is nothing to cross-check the decision against")

    decision_readable, decision, _ = _field(outcome, "job_decision")
    if not decision_readable:
        return Condition(name, False, "job_decision could not be read, so the reason cannot be checked against it")
    if (decision or "").strip().lower() != CONTINUE_DECISION:
        # Nothing to contradict: only a continue decision can keep the lease, and
        # decision_is_continue already governs the rest.
        return Condition(name, True, f"job_decision is {_safe(decision)!r}, so there is no continue claim for the reason to contradict")

    leaning = reason_leans_stop(reason)
    if leaning == _UNREADABLE_REASON:
        return Condition(
            name,
            False,
            "reason_sentence is empty; the schema's escape value for no reason given is the "
            "word NONE, so an empty string is a malformed field rather than a silent all-clear",
        )
    if leaning is not None:
        return Condition(
            name,
            False,
            f"decision says continue but the reason reads as stop (matched {leaning!r}): {_safe(reason)!r}",
        )
    return Condition(name, True, f"reason does not read as stop-leaning: {_safe(reason)!r}")


_Check = Callable[[CallOutcome, float], Condition]

_CHECKS: tuple[tuple[str, _Check], ...] = (
    ("reached_terminal", _check_reached_terminal),
    ("status_completed", _check_status_completed),
    ("task_completed_true", _check_task_completed_true),
    ("confidence_at_or_above_threshold", _check_confidence_at_or_above_threshold),
    ("confidence_label_not_low", _check_confidence_label_not_low),
    ("structured_result_present", _check_structured_result_present),
    ("decision_is_continue", _check_decision_is_continue),
    ("readback_confirmed", _check_readback_confirmed),
    ("spoke_with_person", _check_spoke_with_person),
    ("live_human_evidence_in_transcript", _check_live_human_evidence_in_transcript),
    ("evidence_supports_decision", _check_evidence_supports_decision),
    ("reason_does_not_contradict_decision", _check_reason_does_not_contradict_decision),
)

if tuple(name for name, _ in _CHECKS) != CONDITION_NAMES:  # pragma: no cover - wiring guard
    raise RuntimeError("policy check table has drifted from CONDITION_NAMES")

if LEASE_IDENTITY_GUARD in CONDITION_NAMES:  # pragma: no cover - wiring guard
    raise RuntimeError("the lease identity guard is not one of the twelve and must not be named like one")


# --------------------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------------------


def _usable_threshold(min_confidence: object) -> float:
    """Coerce the caller's threshold, or return one no score can meet.

    float() accepts NaN and infinity without raising, and NaN loses every comparison, so
    a NaN threshold would silently hold condition 4 for any score at all. Confidence on
    this platform is a 0-1 score, so anything outside that range cannot be a threshold
    either. Every unusable value becomes the strictest threshold, never the loosest.
    """
    try:
        value = float(min_confidence)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return _IMPOSSIBLE_THRESHOLD
    if not math.isfinite(value) or not 0.0 <= value <= 1.0:
        return _IMPOSSIBLE_THRESHOLD
    return value


def _run(name: str, check: _Check, outcome: CallOutcome, min_confidence: float) -> Condition:
    """Run one check so that no input can make evaluate() raise.

    A malformed outcome is expected traffic, not an error path, and a bug in a check is
    not a reason to keep a credential alive: either way the condition is recorded as
    failed and the lease is released.
    """
    try:
        condition = check(outcome, min_confidence)
    except Exception as exc:  # noqa: BLE001 - deliberately total; failure means release
        return Condition(name, False, f"check raised {_describe(exc)}")
    # The returned object is described by type, never repr'd: repr on an unknown object
    # can run arbitrary code, and this is the path we take when something is already wrong.
    if not isinstance(condition, Condition):
        return Condition(name, False, f"check returned a {type(condition).__name__} instead of a Condition named {name!r}")
    if condition.name != name:
        return Condition(name, False, f"check returned a Condition named {condition.name!r} instead of {name!r}")
    return condition


def _snapshot_job_id(outcome: CallOutcome) -> str | None:
    """Pull the job id the supervisor stamped into the call metadata, if it is there."""
    raw = outcome.raw if isinstance(outcome.raw, dict) else {}
    metadata = raw.get("metadata")
    if not isinstance(metadata, dict):
        return None
    value = metadata.get("job_id")
    return value.strip() if isinstance(value, str) and value.strip() else None


def _lease_identity_guard(outcome: CallOutcome, expected_job_id: str) -> Condition | None:
    """Catch a verdict computed against the wrong lease. Can only release, never keep.

    Returns a failed Condition when the snapshot names a different job, and None when
    there is nothing to say. It is never returned in a holding state: it is not one of the
    twelve and must not look like a reason a lease survived. It is reported alongside them
    when it fires only so that Verdict.release and Verdict.failed cannot disagree.

    Deliberately compared against call metadata rather than the transcript: on a live call
    the text-to-speech read LEASH-0001 aloud as "capitalized L, capitalized E, capitalized
    A, capitalized S, capitalized H, dash, zero, zero, zero, one", so a transcript match on
    the job id would have failed a perfectly good call. That is also why the job id is not
    one of the twelve.

    A snapshot with no job id in its metadata is not a mismatch. That is a deliberate
    limit, and it is the reason this guard is not load-bearing: it catches a verdict
    quoted for the wrong lease, not a supervisor that forgot to stamp the metadata. What
    the call actually said is what the twelve are for.
    """
    expected = expected_job_id.strip() if isinstance(expected_job_id, str) else ""
    observed = _snapshot_job_id(outcome)
    if not expected or not observed:
        return None
    if expected.casefold() == observed.casefold():
        return None
    return Condition(
        LEASE_IDENTITY_GUARD,
        False,
        f"snapshot metadata names job {_safe(observed)!r}, not the expected {_safe(expected)!r}",
    )


def _summarise(
    outcome: CallOutcome,
    expected_job_id: str,
    failed: tuple[Condition, ...],
    guard: Condition | None,
) -> str:
    job = expected_job_id.strip() if isinstance(expected_job_id, str) and expected_job_id.strip() else "<unnamed job>"
    call_id = outcome.call_id if isinstance(outcome.call_id, str) and outcome.call_id else "<no call id>"
    head = f"job {_safe(job, 60)} call {_safe(call_id, 60)}"
    if not failed and guard is None:
        return f"{head}: keep the lease, all {len(CONDITION_NAMES)} conditions held"
    reasons = [f"{c.name}: {c.detail}" for c in failed]
    if guard is not None:
        reasons.append(f"{guard.name}: {guard.detail}")
    if failed:
        count = f"{len(failed)} of {len(CONDITION_NAMES)} conditions did not hold"
    else:
        count = f"all {len(CONDITION_NAMES)} conditions held, but this verdict is not about this lease"
    return f"{head}: release the lease and revoke ({count}) - " + " | ".join(reasons)


def evaluate(
    outcome: CallOutcome,
    *,
    expected_job_id: str,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
) -> Verdict:
    """Decide whether the lease keeps running. All twelve hold, or it is released.

    Every condition is reported, held or not, so the caller can log the full picture
    rather than the first failure: on a bad call the list of what did not hold is the
    interesting artifact.

    This function does not raise. Every step that touches the outcome is guarded, and any
    exception becomes a failed condition, so the worst a malformed snapshot or a bug in
    here can do is release the lease.
    """
    threshold = _usable_threshold(min_confidence)

    conditions = tuple(_run(name, check, outcome, threshold) for name, check in _CHECKS)

    try:
        guard = _lease_identity_guard(outcome, expected_job_id)
    except Exception as exc:  # noqa: BLE001 - an unreadable snapshot releases
        guard = Condition(LEASE_IDENTITY_GUARD, False, f"lease identity guard raised {_describe(exc)}")

    failed_twelve = tuple(c for c in conditions if not c.held)
    reported = conditions if guard is None else conditions + (guard,)

    try:
        summary = _summarise(outcome, expected_job_id, failed_twelve, guard)
    except Exception as exc:  # noqa: BLE001 - a verdict that cannot be described still stands
        summary = f"release the lease and revoke: the verdict could not be summarised ({type(exc).__name__})"
        reported = reported + (
            Condition(_SUMMARY_GUARD, False, f"summarising the verdict raised {type(exc).__name__}"),
        )

    failed = tuple(c for c in reported if not c.held)
    return Verdict(
        release=bool(failed),
        conditions=reported,
        summary=summary,
    )
