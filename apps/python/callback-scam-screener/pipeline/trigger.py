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
    # Added after a second real email (a fake "Geek Squad" renewal) also
    # slipped past: "did not authorize this transaction" instead of
    # "unauthorized" — not a substring of it, so the existing keyword didn't
    # catch it either.
    "did not authorize",
]

PHONE_RE = re.compile(r"(\(?\+?\d[\d\-.() ]{7,}\d\)?)")

# The same two real emails said "in the next 24 hours" and "you have 12
# hours" rather than "within 24 hours" — a fixed string for every hour count
# and phrasing doesn't generalize, so this catches the pattern (any hour
# count, any of the observed real-world prepositions) instead of
# hard-coding more literal phrases each time a new one turns up.
HOUR_DEADLINE_RE = re.compile(r"\b(?:within|in the next|you have)\s+\d+\s+hours?\b", re.IGNORECASE)

# Real emails routinely contain other phone-number-shaped noise earlier in
# the document than the actual callback number — invoice/transaction IDs,
# amounts, and especially dates (e.g. "Renewal Date: 2026-08-20", which
# PHONE_RE happily matches as an 8-digit sequence). A real test against a
# real "Geek Squad" renewal email proved this: the date was extracted as the
# phone number instead, and only screen.py's separate --to-phone mismatch
# guard caught it before dialing anything — extract_alert itself must not
# rely on that downstream safety net. Preferring a match on the same line as
# one of these words is a much stronger signal than "first match in the
# whole document" for which digit sequence is actually a callback number.
CONTACT_LINE_KEYWORDS = ["call", "phone", "dial", "reach", "contact", "help desk", "helpdesk", "support"]


def _find_callback_phone(email_body: str) -> str | None:
    for line in email_body.splitlines():
        if any(kw in line.lower() for kw in CONTACT_LINE_KEYWORDS):
            match = PHONE_RE.search(line)
            if match:
                return match.group(1)
    # Fallback for emails where the number isn't on an obvious "contact"
    # line — preserves prior behavior rather than returning nothing.
    match = PHONE_RE.search(email_body)
    return match.group(1) if match else None


def extract_alert(email_body: str, sender_domain: str) -> Alert | None:
    """Flags an email as a suspected callback scam if it combines urgency
    language with a phone number to call back. Returns None otherwise —
    the pipeline never dials unless this bar is met."""
    urgency_hit = any(kw in email_body.lower() for kw in URGENCY_KEYWORDS) or HOUR_DEADLINE_RE.search(email_body)
    phone_number = _find_callback_phone(email_body)
    if not (urgency_hit and phone_number):
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
        phone_number=phone_number,
        sender_domain=sender_domain,
        source_email_excerpt=email_body.strip()[:500],
    )
