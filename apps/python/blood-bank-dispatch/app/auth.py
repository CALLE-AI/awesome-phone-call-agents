"""Minimal password gate for the operator UI.

Fail-safe: when APP_PASSWORD is unset or empty, every mutating and
result-viewing route must refuse to run. When set, a signed, expiring session
cookie (HMAC-SHA256 over an expiry + nonce, stdlib only) authorizes access.
"""

import hashlib
import hmac
import os
import secrets
import time

SESSION_COOKIE = "bbd_session"
SESSION_MAX_AGE = 12 * 60 * 60  # seconds


def password_is_set() -> bool:
    return bool(os.environ.get("APP_PASSWORD", "").strip())


def check_password(candidate: str) -> bool:
    # compare_digest rejects non-ASCII str inputs; compare bytes instead so a
    # malformed login attempt returns 401 rather than a 500.
    stored = os.environ.get("APP_PASSWORD", "").strip().encode("utf-8")
    attempt = str(candidate or "").strip().encode("utf-8")
    return secrets.compare_digest(attempt, stored)


def _key() -> bytes:
    return hashlib.sha256(("bbd-session:" + os.environ.get("APP_PASSWORD", "")).encode()).digest()


def make_token() -> str:
    expires = int(time.time()) + SESSION_MAX_AGE
    payload = f"{expires}:{secrets.token_hex(8)}"
    sig = hmac.new(_key(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def verify_token(token: str) -> bool:
    try:
        expires_s, nonce, sig = token.rsplit(":", 2)
        payload = f"{expires_s}:{nonce}"
        expected = hmac.new(_key(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return False
        return int(expires_s) > time.time()
    except (ValueError, TypeError):
        return False


def is_authed(request) -> bool:
    return password_is_set() and verify_token(request.cookies.get(SESSION_COOKIE, ""))


def allowed_destinations() -> set[str]:
    """Numbers the operator has pre-authorized for live ad hoc dialing."""
    raw = os.environ.get("ALLOWED_DESTINATIONS", "")
    return {p.strip() for p in raw.split(",") if p.strip()}
