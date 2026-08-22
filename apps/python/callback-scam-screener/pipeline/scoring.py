import warnings as _warnings

from .models import CallMetadata, ScreeningResult, SignalTag

REMOTE_ACCESS_SIGNAL_ID = "C1"

# The only call status that represents real, scoreable evidence. Anything
# else (FAILED, NO_ANSWER, DECLINED, CANCELED/CANCELLED, VOICEMAIL, BUSY,
# EXPIRED, or an unrecognized/UNKNOWN status) means no real conversation
# happened — scoring it would silently produce a verdict with zero evidence
# behind it.
SCOREABLE_CALL_STATUS = "COMPLETED"


def score(tags: list[SignalTag], catalog: dict, transcript: str, call_metadata: CallMetadata) -> ScreeningResult:
    if call_metadata.answered_by_machine:
        return ScreeningResult(
            verdict="inconclusive",
            score=0,
            triggered_signals=[],
            warnings=[
                "Call was answered by an automatic voicemail/answering system, not a live person — no "
                "signals were evaluated. This is not the same as a clean call; escalate to a human rather "
                "than treating it as cleared."
            ],
            transcript=transcript,
            call_metadata=call_metadata,
        )

    if call_metadata.status != SCOREABLE_CALL_STATUS or not transcript.strip():
        return ScreeningResult(
            verdict="inconclusive",
            score=0,
            triggered_signals=[],
            warnings=[
                f"Call did not produce scoreable evidence (status={call_metadata.status!r}, "
                f"transcript_length={len(transcript.strip())}) — no signals were evaluated. This is not the "
                "same as a clean call; escalate to a human rather than treating it as cleared."
            ],
            transcript=transcript,
            call_metadata=call_metadata,
        )

    triggered = [t for t in tags if t.present]
    critical_hits = [t for t in triggered if t.category == "critical"]
    high_hits = [t for t in triggered if t.category == "high"]
    medium_hits = [t for t in triggered if t.category == "medium"]

    alert_messages: list[str] = []

    remote_access_hit = next((t for t in critical_hits if t.id == REMOTE_ACCESS_SIGNAL_ID), None)
    if remote_access_hit:
        message = (
            "WARNING: caller requested installation of remote-access/remote-desktop "
            f"software — critical scam indicator (quote: {remote_access_hit.quote!r})."
        )
        alert_messages.append(message)
        _warnings.warn(message, stacklevel=2)

    for hit in critical_hits:
        if hit.id != REMOTE_ACCESS_SIGNAL_ID:
            alert_messages.append(f"WARNING: critical scam indicator triggered — {hit.name} (quote: {hit.quote!r}).")

    if critical_hits:
        verdict = "likely_scam"
        numeric_score = catalog["thresholds"]["likely_scam_min_score"]
    else:
        numeric_score = len(high_hits) * catalog["categories"]["high"]["weight"]
        numeric_score += len(medium_hits) * catalog["categories"]["medium"]["weight"]
        if numeric_score >= catalog["thresholds"]["likely_scam_min_score"]:
            verdict = "likely_scam"
        elif numeric_score >= catalog["thresholds"]["inconclusive_min_score"]:
            verdict = "inconclusive"
        else:
            verdict = "likely_legitimate"

    return ScreeningResult(
        verdict=verdict,
        score=numeric_score,
        triggered_signals=triggered,
        warnings=alert_messages,
        transcript=transcript,
        call_metadata=call_metadata,
    )
