from dataclasses import dataclass, field


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

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "score": self.score,
            "triggered_signals": [
                {"id": t.id, "name": t.name, "category": t.category, "quote": t.quote}
                for t in self.triggered_signals
            ],
            "warnings": self.warnings,
            "transcript": self.transcript,
            "structured_result": self.structured_result,
            "completion_confidence": self.completion_confidence,
            "call_metadata": {
                "number_dialed": self.call_metadata.number_dialed,
                "duration_seconds": self.call_metadata.duration_seconds,
                "timestamp": self.call_metadata.timestamp,
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
