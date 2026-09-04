from .models import Alert, PrecheckResult

KNOWN_SCAM_NUMBERS: set[str] = set()  # placeholder — wire up a real scam-number feed/API


def run_prechecks(alert: Alert, official_support_number: str | None = None) -> PrecheckResult:
    notes: list[str] = []

    number_known_scam = _normalize(alert.phone_number) in KNOWN_SCAM_NUMBERS
    if number_known_scam:
        notes.append("Number matches a known-scam-number list entry.")

    number_matches_official = None
    if official_support_number:
        number_matches_official = _normalize(alert.phone_number) == _normalize(official_support_number)
        if not number_matches_official:
            notes.append("Number does not match the claimed company's published support number.")

    return PrecheckResult(
        number_known_scam=number_known_scam,
        number_matches_official_support=number_matches_official,
        sender_auth_passed=None,  # placeholder for SPF/DKIM/DMARC lookup
        notes=notes,
    )


def _normalize(number: str) -> str:
    return "".join(ch for ch in number if ch.isdigit())[-10:]
