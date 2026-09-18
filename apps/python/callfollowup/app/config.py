import ipaddress
import os
import socket

from dotenv import load_dotenv

load_dotenv()

APP_NAME = "CallFollowUp"

# ---------------------------------------------------------------------------
# CALL-E credentials - raw key is intentionally NOT exported publicly.
# Other modules must call get_calle_api_key() and pass it straight to
# CalleClient; they must never print, log, or surface it.
# ---------------------------------------------------------------------------
_CALLE_API_KEY = os.getenv("CALLE_API_KEY")


def get_calle_api_key():
    """Return the raw API key. Use only inside CalleClient constructor."""
    return _CALLE_API_KEY


def has_api_key():
    """True when a CALL-E API key is configured (does not reveal the key)."""
    return bool(_CALLE_API_KEY)


# ---------------------------------------------------------------------------
# Remote / public deployment authentication (Req 2)
# Set APP_USERNAME and APP_PASSWORD in env / Streamlit Secrets for deployments
# that are reachable from the public internet or carry CALLE_API_KEY.
# ---------------------------------------------------------------------------
APP_USERNAME = os.getenv("APP_USERNAME") or os.getenv("STREAMLIT_USERNAME")
APP_PASSWORD = os.getenv("APP_PASSWORD") or os.getenv("STREAMLIT_PASSWORD")


def _is_private_host():
    """
    Return True when running on localhost or an RFC-1918 private network.
    Remote / public deployments that carry credentials must require auth.
    """
    try:
        hostname = socket.gethostname()
        ip_str = socket.gethostbyname(hostname)
        ip = ipaddress.ip_address(ip_str)
        return ip.is_loopback or ip.is_private
    except Exception:
        # Cannot determine host - treat as non-private (safer default).
        return False


def require_auth():
    """
    True when basic-auth must be enforced.

    Rules:
      - If APP_USERNAME + APP_PASSWORD are set: always require auth.
      - If CALLE_API_KEY is present AND we are NOT on a private network: require auth.
      - Otherwise: no auth required (local/loopback usage).
    """
    if APP_USERNAME and APP_PASSWORD:
        return True
    if has_api_key() and not _is_private_host():
        return True
    return False
