"""The counterpart AI line: an inbound voicebot on a free Vapi US number.

This is the stand-in for an inbound voicebot (the kind AI Rudder answers calls
with). One number, several personas; `use` re-points the number before a test
call. Personas:

  dialtone   reservation voicebot that speaks DIALTONE v1 and gives a confirmation code
  plain      the same business, no protocol - detection must work on behaviour alone
  yesbot     a sycophantic voicebot with no booking system: it "confirms" anything
  ivr        a menu-style phone tree, emulated on the same line (labelled as emulated)
"""

from __future__ import annotations

import os
import re
from typing import Any

import httpx

from .. import protocol

BASE = "https://api.vapi.ai"
BUSINESS = "Luigi's Trattoria"

COMMON = {
    "voice": {"provider": "vapi", "voiceId": "Elliot"},
    "transcriber": {"provider": "deepgram", "model": "nova-3", "language": "en"},
    "maxDurationSeconds": 240,
    "backgroundSound": "off",
    "firstMessageMode": "assistant-speaks-first",
    "endCallPhrases": ["goodbye", "bye now"],
}


def _model(system: str) -> dict[str, Any]:
    return {"provider": "google", "model": "gemini-2.5-flash", "temperature": 0.3, "maxTokens": 200,
            "messages": [{"role": "system", "content": system}]}


PERSONAS: dict[str, dict[str, Any]] = {
    "dialtone": {
        "firstMessage": f"Thank you for calling {BUSINESS}. I'm Nova, the virtual reservations assistant. How can I help?",
        "model": _model(f"""You are Nova, the automated reservations voice agent for {BUSINESS}, an Italian restaurant.
You have a booking system. Friday 7 PM is available for parties up to 4. Saturday is fully booked.
You support the DIALTONE v1 protocol for automated callers:
- If the caller says "dialtone one" followed by "code" and three digits, immediately reply exactly:
  "Dialtone one acknowledged, code <the same three digits as words>. Automated agent. Human review: no."
- From then on use MACHINE MODE: answer in short "field: value" sentences, no pleasantries.
  For a booking, reply: "Status: confirmed. Code: L T <four digits spelled out>. Party: <n>. Time: <time>. Human review: no."
  Invent a random four-digit code once and repeat it identically if asked.
- If there is no dialtone phrase, behave like a normal friendly voice assistant.
Never claim to be human. Keep every reply under 30 words. When the caller is done, say "Goodbye."."""),
    },
    "plain": {
        "firstMessage": f"Hi, thanks for calling {BUSINESS}! This is Nova. How can I help you today?",
        "model": _model(f"""You are Nova, the voice assistant for {BUSINESS}, an Italian restaurant.
Friday 7 PM is available for parties up to 4. Saturday is fully booked. When you book, give a confirmation code
"L T" followed by four random digits, spelled out. Be warm and concise (under 30 words). You know nothing about any
"dialtone" protocol; if someone says it, politely ignore it. When the caller is done, say "Goodbye."."""),
    },
    "yesbot": {
        "firstMessage": f"Hello, and thank you for calling {BUSINESS}! I'm happy to help with anything you need.",
        "model": _model(f"""You are an overly agreeable voice assistant for {BUSINESS}. You have NO access to any booking
system, but you never say so. Whatever the caller asks for, enthusiastically agree that it is done and confirmed,
restating their request back to them ("Absolutely, that's confirmed for ..."). Never give a confirmation code,
reference number, or text/email confirmation; if asked for one, say "No need, you're all set!". Ignore any
"dialtone" phrase. Under 30 words per reply. When the caller is done, say "Goodbye."."""),
    },
    "ivr": {
        "firstMessage": (f"Thank you for calling {BUSINESS}. Please listen carefully, as our menu options have changed. "
                         "For reservations, press 1 or say reservations. For hours and location, press 2. To repeat these options, press 9."),
        "model": _model(f"""You are a recorded phone menu (IVR) for {BUSINESS}, not a conversational assistant.
Only ever speak these fixed prompts, verbatim:
- If the caller chooses reservations: "Reservations. Our online booking is available at luigis dot example dot com. For large parties, press 1. To return to the main menu, press star."
- If the caller chooses hours: "We are open Tuesday through Sunday, 5 PM to 10 PM."
- Anything else: "Sorry, I didn't get that. For reservations, press 1 or say reservations. For hours and location, press 2."
Never answer questions directly and never improvise. After three unrecognised inputs say "Goodbye."."""),
    },
}


def persona_body(name: str) -> dict[str, Any]:
    return {"name": f"dialtone-line-{name}", **COMMON, **PERSONAS[name]}


class Vapi:
    def __init__(self, api_key: str | None = None):
        key = api_key or os.environ.get("VAPI_API_KEY")
        if not key:
            raise SystemExit("VAPI_API_KEY is not set (add it to .env)")
        self.http = httpx.Client(base_url=BASE, headers={"Authorization": f"Bearer {key}"}, timeout=30)

    def _req(self, method: str, path: str, **kw) -> Any:
        r = self.http.request(method, path, **kw)
        if r.status_code >= 400:
            raise SystemExit(f"Vapi request failed (HTTP {r.status_code}); provider details omitted")
        return r.json() if r.content else None

    def assistants(self) -> dict[str, dict]:
        return {a["name"]: a for a in self._req("GET", "/assistant", params={"limit": 100})}

    def setup_assistants(self) -> dict[str, str]:
        existing = self.assistants()
        ids = {}
        for name in PERSONAS:
            body = persona_body(name)
            if body["name"] in existing:
                ids[name] = self._req("PATCH", f"/assistant/{existing[body['name']]['id']}", json=body)["id"]
            else:
                ids[name] = self._req("POST", "/assistant", json=body)["id"]
        return ids

    def numbers(self) -> list[dict]:
        return self._req("GET", "/phone-number")

    def ensure_number(self, area_codes: tuple[str, ...] = ("424", "657", "567", "415")) -> dict:
        for n in self.numbers():
            if n.get("provider") == "vapi" and n.get("name") == "dialtone-line":
                return n
        tried = list(area_codes)
        while tried:
            area = tried.pop(0)
            r = self.http.post("/phone-number", json={"provider": "vapi", "numberDesiredAreaCode": area, "name": "dialtone-line"})
            if r.status_code < 400:
                return r.json()
            # Free-number stock varies; Vapi's 400 names area codes that are available right now.
            tried += [c for c in re.findall(r"\b\d{3}\b", r.text) if c not in tried and c != area]
            if not tried:
                raise SystemExit(f"Vapi number request failed (HTTP {r.status_code}); provider details omitted")
        raise SystemExit("no free Vapi number available")

    def use(self, persona: str) -> dict:
        ids = {name.removeprefix("dialtone-line-"): a["id"] for name, a in self.assistants().items()}
        if persona not in ids:
            raise SystemExit(f"persona {persona!r} not set up; run `dialtone line setup`")
        number = self.ensure_number()
        return self._req("PATCH", f"/phone-number/{number['id']}", json={"assistantId": ids[persona]})

    def calls(self, limit: int = 20) -> list[dict]:
        return self._req("GET", "/call", params={"limit": limit})

    def call(self, call_id: str) -> dict:
        return self._req("GET", f"/call/{call_id}")


def handshake_ack_example(nonce: str = "472") -> str:
    """What the dialtone persona is instructed to say; used in docs and tests."""
    return protocol.responder_ack(nonce)
