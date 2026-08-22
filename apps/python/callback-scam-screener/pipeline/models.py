from dataclasses import dataclass, field

from .guardrails import mask_phone_number


@dataclass
class Alert:
    claimed_reason: str
    phone_number: str
    sender_domain: str
    source_email_excerpt: str


@dataclass
class PrecheckResult:
    number_known_scam: bool
    number_matches_official_support: bool | None
    sender_auth_passed: bool | None
    notes: list[str] = field(default_factory=list)


@dataclass
class CallMetadata:
    number_dialed: str
    duration_seconds: int
    timestamp: str
    # Defaults fail closed: a caller who forgets to set status gets treated
    # as unverified evidence (scoring.py requires COMPLETED to evaluate
    # signals), not silently as a clean completed call. Every real call site
    # (RealCallEClient, MockCallEClient) sets this explicitly; tests that
    # want a completed call must say so explicitly too.
    status: str = "UNKNOWN"
    call_id: str | None = None
    # CALL-E reports status=COMPLETED even when the call was picked up by an
    # answering machine, not a person — a real live test hit this exact case
    # (status COMPLETED, non-empty transcript, verdict computed as if a human
    # had answered). Derived from CALL-E's own result.outcome.evidence text
    # (see caller.py), not guessed — scoring.py must not treat this as real
    # evidence of legitimacy just because the call technically completed.
    answered_by_machine: bool = False


@dataclass
class SignalTag:
    id: str
    name: str
    category: str
    present: bool
    quote: str | None = None


@dataclass
class ScreeningResult:
    verdict: str
    score: int
    triggered_signals: list[SignalTag]
    warnings: list[str]
    transcript: str
    call_metadata: CallMetadata
    precheck: PrecheckResult | None = None
    structured_result: dict | None = None
    completion_confidence: float | None = None

    def to_dict(self, mask_numbers: bool = True) -> dict:
        """mask_numbers=True (the default) partially masks the dialed number
        everywhere it appears in the output — call_metadata.number_dialed and
        any occurrence within the transcript — so a full number doesn't end
        up verbatim in a copy-pasted log, screenshot, or bug report by
        default. Pass False to see the number in full (e.g. a SOC analyst
        who needs it to take further action on this specific case)."""
        number_dialed = self.call_metadata.number_dialed
        transcript = self.transcript
        warnings = self.warnings
        quotes = [t.quote for t in self.triggered_signals]
        if mask_numbers:
            transcript = mask_phone_number(transcript, number_dialed)
            warnings = [mask_phone_number(w, number_dialed) for w in warnings]
            quotes = [mask_phone_number(q, number_dialed) if q else q for q in quotes]
            number_dialed = mask_phone_number(number_dialed, number_dialed)

        return {
            "verdict": self.verdict,
            "score": self.score,
            "triggered_signals": [
                {"id": t.id, "name": t.name, "category": t.category, "quote": q}
                for t, q in zip(self.triggered_signals, quotes)
            ],
            "warnings": warnings,
            "transcript": transcript,
            "structured_result": self.structured_result,
            "completion_confidence": self.completion_confidence,
            "call_metadata": {
                "number_dialed": number_dialed,
                "duration_seconds": self.call_metadata.duration_seconds,
                "timestamp": self.call_metadata.timestamp,
                "status": self.call_metadata.status,
                "call_id": self.call_metadata.call_id,
                "answered_by_machine": self.call_metadata.answered_by_machine,
            },
            "precheck": (
                {
                    "number_known_scam": self.precheck.number_known_scam,
                    "number_matches_official_support": self.precheck.number_matches_official_support,
                    "sender_auth_passed": self.precheck.sender_auth_passed,
                    "notes": self.precheck.notes,
                }
                if self.precheck
                else None
            ),
        }
