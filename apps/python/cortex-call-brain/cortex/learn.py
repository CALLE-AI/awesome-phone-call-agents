"""Turn a finished call into brain updates.

Design principle learned the hard way: **Gemini does the *understanding*, but
the brain's keys are *deterministic*.** An LLM reliably maps "sick to my stomach"
-> the canonical symptom ``nausea``, but if we let it also *phrase* the stored
fact freely, two calls about the same thing get worded differently and never
corroborate. So both extraction paths converge on a small normalized shape
``{summary, symptoms[], refill, missed}`` and a shared builder templates the
facts and signal keys from it. That makes corroboration bulletproof:

- Gemini path (default when a key is set): open-vocabulary understanding.
- Rule path (no key): keyword matching.

Both then fan out identically:
- ``sub_brain_summary`` + ``open_items`` -> the patient's private sub-brain
- ``candidate_facts`` -> master-brain facts (through the corroboration gate)
- ``signals`` -> anonymized aggregate patterns keyed as ``drug:X|symptom:Y``
- ``outcome`` -> the call log

Privacy: facts and signals are always general/anonymized; only the sub-brain
(the patient's own private row) holds personal detail.
"""

from __future__ import annotations

import re

from .llm import Gemini
from .memory import Memory

# Canonical symptom vocabulary. Gemini is told to map onto these exact words;
# the rule path matches them (plus a few synonyms) directly.
_SYMPTOMS = ["nausea", "dizziness", "headache", "vomiting", "rash", "drowsiness",
             "fatigue", "stomach pain", "diarrhea", "constipation", "insomnia"]
_SYNONYMS = {"dizzy": "dizziness", "drowsy": "drowsiness", "tired": "fatigue",
             "sick to my stomach": "nausea", "throwing up": "vomiting",
             "can't sleep": "insomnia", "loose motion": "diarrhea"}
_REFILL = ["refill", "run out", "ran out", "running out", "more tablets",
           "more pills", "need more", "reorder"]
_MISSED = ["forgot", "missed", "skip", "skipped", "didn't take", "did not take",
           "stopped taking"]

_CALLBACK = ["call me back", "call back", "call later", "call me later", "not a good time",
             "bad time", "busy right now", "i'm busy", "im busy", "can you call",
             "try again later", "reach me later", "in a meeting", "driving", "at a wedding",
             "at work", "later please", "some other time", "ring me later"]

_GEMINI_PROMPT = """You read a pharmacy medication check-in transcript and return ONLY JSON:
- "summary": 1-2 sentence private summary of THIS patient for next time.
- "symptoms": array of side effects the patient mentioned, each mapped to ONE of exactly these canonical words: {vocab}. Map paraphrases (e.g. "sick to my stomach" -> "nausea"). [] if none.
- "refill": true if they need/asked for a refill, else false.
- "missed": true if they mentioned missing/skipping/stopping doses, else false.
- "callback": true if they asked us to call back later or said now is not a good time, else false.
- "callback_reason": if callback is true, a SHORT phrase for what they are doing / why (e.g. "at a wedding", "driving", "in a meeting", "at work"). "" otherwise. Keep it under 6 words, no PII.
Never invent anything not supported by the transcript.
TRANSCRIPT:
{transcript}
"""


def _gemini_fields(gemini: Gemini, text: str) -> dict:
    d = gemini.json(_GEMINI_PROMPT.format(vocab=", ".join(_SYMPTOMS), transcript=text[:12000]))
    syms = [s.strip().lower() for s in (d.get("symptoms") or []) if isinstance(s, str)]
    syms = [_SYNONYMS.get(s, s) for s in syms]
    return {
        "summary": (d.get("summary") or "").strip(),
        "symptoms": sorted({s for s in syms if s in _SYMPTOMS}),
        "refill": bool(d.get("refill")),
        "missed": bool(d.get("missed")),
        "callback": bool(d.get("callback")),
        "callback_reason": (d.get("callback_reason") or "").strip(),
    }


def _rule_fields(text: str) -> dict:
    low = (text or "").lower()
    for phrase, canon in _SYNONYMS.items():
        if phrase in low:
            low += f" {canon}"
    syms = sorted({s for s in _SYMPTOMS if re.search(rf"\b{re.escape(s)}\b", low)})
    callback = any(k in low for k in _CALLBACK)
    reason = ""
    for ctx in ("at a wedding", "driving", "in a meeting", "at work", "at a funeral", "in class"):
        if ctx in low:
            reason = ctx
            break
    return {"summary": "", "symptoms": syms,
            "refill": any(k in low for k in _REFILL),
            "missed": any(k in low for k in _MISSED),
            "callback": callback, "callback_reason": reason}


def _build(fields: dict, summary: str, drug: str) -> dict:
    """Shared, deterministic builder — same output whichever path produced fields."""
    symptoms = fields["symptoms"]
    facts = [f"{drug} may cause {s} in some patients" for s in symptoms] if drug else []
    signals = [{"key": f"drug:{drug}|symptom:{s}",
                "description": f"Patients on {drug} reported {s}"} for s in symptoms] if drug else []
    open_items = [f"check if {s} settled" for s in symptoms]
    if fields["refill"]:
        open_items.append("arrange refill")

    outcome = ("side_effect" if symptoms else "needs_refill" if fields["refill"]
               else "missed_doses" if fields["missed"] else "adherent")

    sub = fields.get("summary") or summary or "Completed a medication check-in."
    if symptoms and not fields.get("summary"):
        sub += f" Reported: {', '.join(symptoms)}."
    # The summary is LLM/provider-derived free text that later lands in the next
    # call goal, so flatten to a single line and clamp it — same discipline as
    # callback_reason — to bound any prompt-injection surface.
    sub = " ".join((sub or "").split())[:240].strip()
    return {"sub_brain_summary": sub, "open_items": open_items,
            "candidate_facts": facts, "signals": signals, "outcome": outcome}


def learn_from_call(memory: Memory, phone: str, transcript: str, *,
                    summary: str = None, drug: str = None, gemini: Gemini = None) -> dict:
    """Extract structured knowledge from a call and write it into the brain."""
    gemini = gemini or Gemini()

    if not transcript and not summary:
        # No content to learn from. The caller/campaign already logged this run
        # (real run_id) — do NOT write a second synthetic row here.
        return {"outcome": "no_answer", "candidate_facts": [], "signals": [],
                "_promoted_to_canonical": [], "_flagged_to_staff": []}

    text = transcript or summary
    fields = _gemini_fields(gemini, text) if gemini.available else _rule_fields(text)
    data = _build(fields, summary, drug)

    memory.upsert_patient(phone, summary=data["sub_brain_summary"],
                          open_items=data["open_items"])

    # Callback continuity: if they asked us to try later, remember why so the next
    # call opens by referencing it; if they engaged, any pending callback is resolved.
    if fields.get("callback"):
        memory.set_callback(phone, fields.get("callback_reason") or "")
    else:
        memory.clear_callback(phone)

    promoted = []
    for fact in data["candidate_facts"]:
        if memory.add_candidate_fact(fact, source_phone=phone)["status"] == "canonical":
            promoted.append(fact)

    flagged = []
    for sig in data["signals"]:
        count = memory.bump_signal(sig["key"], sig["description"], source_phone=phone)
        if count >= 2:
            flagged.append({"description": sig["description"], "count": count})

    data["_promoted_to_canonical"] = promoted
    data["_flagged_to_staff"] = flagged
    return data


if __name__ == "__main__":
    import os
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    m = Memory(db_path=":memory:", promotion_min=2)
    g = Gemini()
    print("gemini:", g.available)
    print("P1:", learn_from_call(m, "+12025550111", "Taking daily but feel sick to my stomach each morning.",
                                 summary="P1", drug="Drug X", gemini=g)["outcome"])
    r2 = learn_from_call(m, "+12025550122", "Taking it fine, a bit of nausea. Also need a refill.",
                         summary="P2", drug="Drug X", gemini=g)
    print("P2 promoted:", r2["_promoted_to_canonical"], "| flagged:", r2["_flagged_to_staff"])
