import re

from .models import Alert

URGENCY_KEYWORDS = [
    "act now", "immediately", "final notice", "suspended", "unauthorized",
    "verify your account", "unusual activity", "payment failed", "call back",
    "within 24 hours", "your account has been",
    # Added after a real phishing email (a fake "iApple" invoice) used none
    # of the phrasing above and would otherwise have gone completely
    # undetected — "call us right away" instead of "call back", "stop the
    # payment"/"protect your account" instead of "verify your account".
    "call us right away", "stop the payment", "protect your account",
]

PHONE_RE = re.compile(r"(\(?\+?\d[\d\-.() ]{7,}\d\)?)")

# The same real email said "in the next 24 hours" rather than "within 24
# hours" — a fixed string for every hour count doesn't generalize, so this
# catches the pattern (any hour count, either preposition) instead of
# hard-coding more literal phrases.
HOUR_DEADLINE_RE = re.compile(r"\b(?:within|in the next)\s+\d+\s+hours?\b", re.IGNORECASE)


def extract_alert(email_body: str, sender_domain: str) -> Alert | None:
    """Flags an email as a suspected callback scam if it combines urgency
    language with a phone number to call back. Returns None otherwise —
    the pipeline never dials unless this bar is met."""
    urgency_hit = any(kw in email_body.lower() for kw in URGENCY_KEYWORDS) or HOUR_DEADLINE_RE.search(email_body)
    phone_match = PHONE_RE.search(email_body)
    if not (urgency_hit and phone_match):
        return None

    reason_line = next(
        (
            line.strip().removeprefix("Subject:").strip()
            for line in email_body.splitlines()
            if not line.lower().startswith("subject:") and any(kw in line.lower() for kw in URGENCY_KEYWORDS)
        ),
        "",
    )

    return Alert(
        claimed_reason=reason_line,
        phone_number=phone_match.group(1),
        sender_domain=sender_domain,
        source_email_excerpt=email_body.strip()[:500],
    )
