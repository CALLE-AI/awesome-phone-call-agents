import warnings as _warnings

from .models import CallMetadata, ScreeningResult, SignalTag

REMOTE_ACCESS_SIGNAL_ID = "C1"


def score(tags: list[SignalTag], catalog: dict, transcript: str, call_metadata: CallMetadata) -> ScreeningResult:
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
