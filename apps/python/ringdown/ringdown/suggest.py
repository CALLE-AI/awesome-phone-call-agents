from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from ringdown.adapter import adapt
from ringdown.audit import DETAIL_LIMIT
from ringdown.calle import (
    assert_trusted_url,
    error_envelope,
    redirect_refused,
    refusing_redirects,
)
from ringdown.incident import (
    REQUIRED_INCIDENT_FIELDS,
    SEVERITIES,
    IncidentError,
    parse_incident,
)
from ringdown.task import CALL_TASK, spoken_fields_in

LIVE = "https://generativelanguage.googleapis.com"
MODEL = "gemini-3.6-flash"
ATTEMPTS = 2

PROMPT = """Write a Ringdown field mapping for the alert payload below.

Ringdown pages an on-call engineer by phone. The mapping turns one vendor's alert into the incident
it dials, one entry per incident field.

Required keys: {required}.
Optional key: runbook_url, an http or https URL.

A value starting with '$' is a path into the payload. The only syntax is '.key' and '[0]'. There are
no wildcards, filters, defaults, expressions or functions.
Any other value is a literal and is copied through untouched. Use a literal when the payload has no
field for it, and omit an optional key rather than pointing it at a field the payload does not have.

severity must resolve to one of: {severities}.
ladder is a literal list of on-call scope names; use ["primary", "secondary", "incident_commander"]
unless the payload names better ones.
timezone is a literal IANA name.
summary is the sentence a woken engineer hears read aloud, so it must be a whole sentence, not a
field name.

The mapping is a flat object: every key is an incident field, at the top level, and nothing is
nested or wrapped. For a payload that kept its alert under "monitor", it would read:

{{"id": "$.monitor.ref", "title": "$.monitor.name", "severity": "$.monitor.tags[0]",
 "service": "$.monitor.target", "summary": "Checkout latency is above its objective.",
 "ladder": ["primary", "secondary", "incident_commander"], "timezone": "UTC"}}

Answer with the mapping object as JSON and nothing else.

Alert payload:
{payload}"""


REJECTED = """Your previous answer was rejected. The loader that rejected it is deterministic and
is not negotiable; the mapping has to satisfy it.

{rejection}

Answer again, with a corrected mapping object as JSON and nothing else."""


class SuggestionError(IncidentError):
    pass


def prompt_for(payload: Any) -> str:
    required = dict.fromkeys(REQUIRED_INCIDENT_FIELDS + spoken_fields_in(CALL_TASK) + ("timezone",))
    return PROMPT.format(
        required=", ".join(required),
        severities=", ".join(SEVERITIES),
        payload=json.dumps(payload, indent=2, sort_keys=True),
    )


def _post(url: str, api_key: str, body: Any, timeout: float) -> Any:
    opener = refusing_redirects(
        lambda url, newurl, code: OSError(redirect_refused(url, newurl, code))
    )
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
    request.add_header("x-goog-api-key", api_key)
    request.add_header("Content-Type", "application/json")
    try:
        with opener.open(request, timeout=timeout) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        message = str(error_envelope(error).get("message") or "")
        raise SuggestionError(f"http {error.code} {message}".strip()[:DETAIL_LIMIT]) from error
    except OSError as error:
        raise SuggestionError(f"transport failure: {error}"[:DETAIL_LIMIT]) from error
    except json.JSONDecodeError as error:
        raise SuggestionError("the model endpoint did not answer with JSON") from error


def _mapping_from(answer: Any) -> dict[str, Any]:
    try:
        mapping = json.loads(answer["candidates"][0]["content"]["parts"][0]["text"])
        if not isinstance(mapping, dict):
            raise TypeError(type(mapping).__name__)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise SuggestionError(
            f"no mapping object in the model's answer: {json.dumps(answer)[:DETAIL_LIMIT]}"
        ) from error
    return mapping


def _body(prompt: str) -> dict[str, Any]:
    return {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
    }


def _validated(payload: Any, mapping: dict[str, Any]) -> dict[str, Any]:
    try:
        parse_incident(adapt(payload, mapping))
    except IncidentError as error:
        raise SuggestionError(
            f"{error}. The model proposed {json.dumps(mapping, sort_keys=True)[:DETAIL_LIMIT]}"
        ) from error
    return mapping


def suggest_mapping(
    payload: Any, api_key: str, url: str = LIVE, timeout: float = 30.0
) -> dict[str, Any]:
    endpoint = f"{assert_trusted_url(url, LIVE)}/v1beta/models/{MODEL}:generateContent"

    def proposed(prompt: str) -> dict[str, Any]:
        return _mapping_from(_post(endpoint, api_key, _body(prompt), timeout))

    prompt = prompt_for(payload)
    for _ in range(ATTEMPTS - 1):
        try:
            return _validated(payload, proposed(prompt))
        except SuggestionError as rejection:
            prompt = f"{prompt_for(payload)}\n\n{REJECTED.format(rejection=rejection)}"
    return _validated(payload, proposed(prompt))
