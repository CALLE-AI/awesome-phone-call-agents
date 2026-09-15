"""Optional model pass that widens detection, and cannot widen anything else.

The rules in `detect.py` are the floor: deterministic, offline, no key, and
readable by anyone who wants to know exactly what fires. A model raises recall
on phrasings the rules were never written for. It does not replace them.

Three properties hold regardless of what the model returns:

* **It cannot invent evidence.** Every finding must quote a question and a reply
  that appear verbatim in the thread. A finding whose quotes are not found is
  discarded, which is the guard against a confident hallucination becoming a
  proposal to phone a real person.
* **It cannot produce a destination.** Numbers come from the thread or the user,
  by the same code path as before. Nothing here touches a phone number.
* **It cannot place a call.** A model finding reaches the same human approval
  gate as a rule finding: the question and the destination are shown, and the
  user presses a button that names them.
* **It cannot leak its own key.** The provider origin is pinned and redirects
  are refused, because `urllib` re-sends request headers to a redirect target
  without checking the host.

Off by default: no key, no network, no model.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from .detect import Finding
from .thread import Thread, spoken_text
from .verify import verify_finding

TIMEOUT_SECONDS = 20
MAX_FINDINGS = 3

PROMPT = """You are reviewing an email thread to find questions that are still open \
because a reply looked like an answer but was not.

Report a finding ONLY for these two patterns:

A. unclear_choice - the sender offered two or more options, and the reply agreed \
without naming any of them.
B. vague_commitment - the sender asked for something, and the reply agreed without \
naming a date, time, or quantity.

Do NOT report a finding when:
- the reply names one of the options, even in shorthand ("Tues" for Tuesday);
- the reply gives a date, time, or quantity;
- the reply does not agree to anything ("I'll check and revert");
- the reply asks a question back, because the conversation is still live;
- nothing was actually asked.

Silence is the correct answer far more often than a finding. The user will be \
offered the chance to telephone a real person about anything you report, so a \
false positive has a real cost. When in doubt, report nothing.

Return JSON only, in this exact shape:

{"findings": [{
  "kind": "unclear_choice" or "vague_commitment",
  "asked_index": <index of the message containing the question>,
  "replied_index": <index of the message containing the non-answer>,
  "question": "<the exact sentence from the thread, copied character for character>",
  "reply": "<the exact sentence from the thread, copied character for character>",
  "options": ["<option>", "<option>"],
  "call_question": "<the single question a phone call should ask to settle it>"
}]}

"options" must be [] for vague_commitment. "question" and "reply" must be copied \
verbatim from the messages below; anything paraphrased will be rejected.

Report at most %d findings. If nothing qualifies, return {"findings": []}.

The thread:

%s
""".strip()


class ModelUnavailable(RuntimeError):
    """The model could not be consulted. Detection falls back to rules alone."""


# --- providers ---------------------------------------------------------------

class _Provider:
    name = ""

    def complete(self, prompt: str) -> str:
        raise NotImplementedError


class Gemini(_Provider):
    name = "gemini"
    ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    def __init__(self, api_key: str, model: str) -> None:
        self._api_key = api_key
        self._model = model or "gemini-2.0-flash"

    def complete(self, prompt: str) -> str:
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
        }
        request = urllib.request.Request(
            self.ENDPOINT.format(model=self._model),
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": self._api_key},
        )
        payload = _send(request)
        try:
            return payload["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ModelUnavailable(f"unexpected Gemini response shape: {exc}") from exc


class Anthropic(_Provider):
    name = "anthropic"
    ENDPOINT = "https://api.anthropic.com/v1/messages"

    def __init__(self, api_key: str, model: str) -> None:
        self._api_key = api_key
        self._model = model or "claude-sonnet-5"

    def complete(self, prompt: str) -> str:
        body = {
            "model": self._model,
            "max_tokens": 2048,
            "temperature": 0,
            "messages": [{"role": "user", "content": prompt}],
        }
        request = urllib.request.Request(
            self.ENDPOINT,
            data=json.dumps(body).encode(),
            headers={
                "Content-Type": "application/json",
                "x-api-key": self._api_key,
                "anthropic-version": "2023-06-01",
            },
        )
        payload = _send(request)
        try:
            return payload["content"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ModelUnavailable(f"unexpected Anthropic response shape: {exc}") from exc


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


# Derived from the pinned endpoints above rather than written out again, so the
# allowlist cannot drift away from the URLs actually used.
ALLOWED_ORIGINS = frozenset({_origin(Gemini.ENDPOINT), _origin(Anthropic.ENDPOINT)})


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    """Refuse every redirect rather than follow one carrying the key.

    `urllib` copies the request headers onto a redirected request and does not
    check the host first, so a 30x away from the pinned endpoint would hand the
    model API key to whoever sent it. Both endpoints are fixed HTTPS API URLs
    with no reason to redirect, so a redirect is a fault, not a route.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ModelUnavailable(
            f"model provider redirected ({code}); refusing to resend the key elsewhere"
        )


_OPENER = urllib.request.build_opener(_NoRedirects)


def _send(request: urllib.request.Request) -> dict:
    # Checked before the socket is opened, not after: the point is that the key
    # never leaves for an origin we did not pin.
    origin = _origin(request.full_url)
    if origin not in ALLOWED_ORIGINS:
        raise ModelUnavailable(f"refusing to send the model key to {origin}")

    try:
        with _OPENER.open(request, timeout=TIMEOUT_SECONDS) as response:
            return json.loads(response.read())
    except ModelUnavailable:
        raise
    except urllib.error.HTTPError as exc:
        # The body can echo the request; do not surface it, only the status.
        raise ModelUnavailable(f"model provider returned HTTP {exc.code}") from exc
    except Exception as exc:
        raise ModelUnavailable(f"model provider unreachable: {type(exc).__name__}") from exc


# --- wiring ------------------------------------------------------------------

def build_provider(env=None) -> _Provider | None:
    """Return a provider, or None when the model pass is disabled."""
    env = env if env is not None else os.environ
    choice = (env.get("DEFAULT_AI_ENV") or "").strip().upper()

    if choice == "GEMINI":
        key = (env.get("GEMINI_API_KEY") or "").strip()
        return Gemini(key, (env.get("GEMINI_MODEL_NAME") or "").strip()) if key else None
    if choice == "ANTHROPIC":
        key = (env.get("ANTHROPIC_API_KEY") or "").strip()
        return Anthropic(key, (env.get("ANTHROPIC_MODEL_NAME") or "").strip()) if key else None
    return None


def _render_thread(thread: Thread) -> str:
    lines = []
    for message in thread.messages:
        who = "the user" if message.from_me else (message.sender or "the other person")
        body = spoken_text(message.body)
        if body:
            lines.append(f"[{message.index}] from {who}:\n{body}")
    return "\n\n".join(lines)


def _extract_json(text: str) -> dict:
    """Models sometimes wrap JSON in prose or a fenced block."""
    text = (text or "").strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ModelUnavailable("model did not return JSON")
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise ModelUnavailable(f"model returned malformed JSON: {exc.msg}") from exc


def findings_from_model(thread: Thread, provider: _Provider) -> list[Finding]:
    """Ask the model, then discard anything it cannot substantiate.

    The substantiation itself lives in `verify.py`, because the browser panel
    hands back findings too and an untrusted finding is an untrusted finding
    whichever side of the wire it came from.
    """
    raw = provider.complete(PROMPT % (MAX_FINDINGS, _render_thread(thread)))
    payload = _extract_json(raw)

    findings: list[Finding] = []
    for item in (payload.get("findings") or [])[:MAX_FINDINGS]:
        finding = verify_finding(thread, item, source="model")
        if finding is not None:
            findings.append(finding)
    return findings


def merge(rule_findings: list[Finding], model_findings: list[Finding]) -> list[Finding]:
    """Rules win. The model only adds replies the rules said nothing about."""
    seen = {finding.replied_index for finding in rule_findings}
    merged = list(rule_findings)
    for finding in model_findings:
        if finding.replied_index not in seen:
            seen.add(finding.replied_index)
            merged.append(finding)
    merged.sort(key=lambda f: (-f.replied_index, f.kind))
    return merged
