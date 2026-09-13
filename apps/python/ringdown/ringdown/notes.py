from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable

from ringdown.audit import DETAIL_LIMIT
from ringdown.calle import (
    assert_trusted_url,
    error_envelope,
    redirect_refused,
    refusing_redirects,
)
from ringdown.escalate import LadderResult
from ringdown.exits import EXIT_UNRESOLVED, EXIT_UNVERIFIED
from ringdown.incident import mask_phone

NOTE_LIMIT = 2000


@dataclass(frozen=True)
class Vendor:
    name: str
    live: tuple[str, ...]
    path: str
    authorization: str
    body: Callable[[str], dict]
    token_env: tuple[str, str]
    headers: tuple[tuple[str, str], ...] = ()
    sender_env: tuple[str, str] | None = None


VENDORS = {
    "pagerduty": Vendor(
        name="PagerDuty",
        live=("https://api.pagerduty.com", "https://api.eu.pagerduty.com"),
        path="/incidents/{id}/notes",
        authorization="Token token={token}",
        body=lambda content: {"note": {"content": content}},
        token_env=("PAGERDUTY_TOKEN", "RINGDOWN_FAKE_PAGERDUTY_TOKEN"),
        headers=(("Accept", "application/vnd.pagerduty+json;version=2"),),
        sender_env=("PAGERDUTY_FROM", "RINGDOWN_FAKE_PAGERDUTY_FROM"),
    ),
    "opsgenie": Vendor(
        name="Opsgenie",
        live=("https://api.opsgenie.com", "https://api.eu.opsgenie.com"),
        path="/v2/alerts/{id}/notes?identifierType=id",
        authorization="GenieKey {token}",
        body=lambda content: {"note": content, "source": "Ringdown"},
        token_env=("OPSGENIE_API_KEY", "RINGDOWN_FAKE_OPSGENIE_API_KEY"),
    ),
}

SETTLED = {
    "acknowledged": "acknowledged the page",
    "declined": "declined the page",
    "unacknowledged": "did not acknowledge the page",
    "unknown": "left the page unresolved",
}

CORROBORATION = {
    EXIT_UNVERIFIED: (
        "The second channel contradicted this run, so the acknowledgement is not trustworthy. "
        "Treat this incident as unowned until a human confirms it."
    ),
    EXIT_UNRESOLVED: (
        "The second channel could not corroborate this run, so nothing here is cross-verified."
    ),
}


_OPENER = refusing_redirects(
    lambda url, newurl, code: OSError(redirect_refused(url, newurl, code))
)


@dataclass(frozen=True)
class NoteResult:
    delivered: bool
    detail: str


def note_text(result: LadderResult, code: int, records: int, head: str) -> str:
    deciding = result.deciding
    if deciding is None:
        return "Ringdown placed no call for this incident."
    contact = deciding.rung.contact
    lines = [
        f"Ringdown called {contact.name} ({mask_phone(contact.phone)}) "
        f"as {deciding.rung.scope}: {SETTLED[result.verdict]}.",
    ]
    if code in CORROBORATION:
        lines.append(CORROBORATION[code])
    if deciding.reason:
        lines.append(f"Reason recorded: {deciding.reason}.")
    extraction = deciding.extraction
    if extraction is not None:
        if extraction.eta_minutes is not None:
            lines.append(f"Stated ETA: {extraction.eta_minutes} minutes.")
        spans = (extraction.owner_span, extraction.disposition_span, extraction.eta_span)
        lines += [f'Heard: "{span}"' for span in dict.fromkeys(spans) if span]
    if deciding.instructed:
        lines.append(
            "The transcript carried an instruction addressed to the agent. "
            "It was recorded as evidence and not followed."
        )
    lines.append(
        f"Ringdown placed {result.placed} call(s) across {len(result.attempts)} rung(s), "
        f"and exited {code}. Ledger at the verdict: {records} records, head {head}."
    )
    lines.append("This note is a record of a phone call. It changes no incident state.")
    return "\n".join(lines)[:NOTE_LIMIT]


def post_note(
    vendor: Vendor,
    url: str,
    token: str,
    sender: str,
    incident_id: str,
    content: str,
    timeout: float = 15.0,
) -> NoteResult:
    base = assert_trusted_url(url, vendor.live)
    target = vendor.path.format(id=urllib.parse.quote(incident_id, safe=""))
    request = urllib.request.Request(
        f"{base}{target}",
        data=json.dumps(vendor.body(content)).encode(),
        method="POST",
    )
    request.add_header("Authorization", vendor.authorization.format(token=token))
    request.add_header("Content-Type", "application/json")
    for name, value in vendor.headers:
        request.add_header(name, value)
    if vendor.sender_env is not None:
        request.add_header("From", sender)
    try:
        with _OPENER.open(request, timeout=timeout) as response:
            return NoteResult(True, f"http {response.status}")
    except urllib.error.HTTPError as error:
        message = str(error_envelope(error).get("message") or "")
        return NoteResult(False, f"http {error.code} {message}".strip()[:DETAIL_LIMIT])
    except OSError as error:
        return NoteResult(False, f"transport failure: {error}"[:DETAIL_LIMIT])
