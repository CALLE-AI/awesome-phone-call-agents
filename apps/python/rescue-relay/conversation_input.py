"""Interpret *fictional* transcript inputs without silently truncating greetings.

Only the mock adapter uses these helpers. Existing call evidence is never rewritten.
Auto mode is deliberately conservative: substantive/ambiguous transcripts stay exact.
"""
from __future__ import annotations
import re

RECIPIENT_ROLES = {"recipient", "user", "human", "callee", "contact"}
# A refusal is an end to the conversation, not permission to invent an agreement.
END_CALL = re.compile(
    r"(?:^\s*no[.!]?\s*$|\b(?:wrong (?:number|person)|do not call|don't call|stop calling|not interested|"
    r"not available (?:today|now|for this)|"
    r"(?:cannot|can't|won't|will not|unable to) (?:continue|speak)|"
    r"(?:cannot|can't|won't|will not|unable to) (?:help|assist)"
    r"(?=\s*(?:[.!?,;]|$)|\s+(?:today|now|at all|with (?:this|the) (?:rescue|request|case)|with any|with (?:the )?remaining))|"
    r"(?:please )?(?:hang up|end (?:this|the) call)|goodbye|no thanks)\b)", re.I)
SUBSTANTIVE = re.compile(
    r"\b(?:pkrs?|rupees?|rs\.?|usd|fee|price|charge|cost|free|minutes?|"
    r"transport|contain|capture|injur\w*|clinic|vet\w*|hospital|"
    r"cannot|can't|unable|decline|not available|"
    r"(?:i|we) (?:agree|confirm|accept|will|can (?:rescue|handle|help (?:with|today)|provide|take))|"
    r"only after|pending approval)\b", re.I)
OPENING = re.compile(
    r"\b(?:hello|hi|hey|yeah|yes|speaking|who (?:is|are)|who'?s|"
    r"what (?:do you want|is (?:this|it)|can i|can we)|what'?s (?:this|up)|"
    r"how (?:can|may) (?:i|we) help|this is|am i speaking|are you)\b", re.I)
OUTCOME = re.compile(
    r"\b(?:cannot|can't|unable|decline|not available|not interested|"
    r"(?:i|we|our team|our clinic|our driver) (?:confirm|agree|accept|will|can|may|might)|"
    r"(?:only after|pending|need|needs) .{0,45}(?:approval|confirm|supervisor)|"
    r"price.{0,40}(?:not confirmed|unknown)|we have not confirmed a price|"
    r"(?:wrong number|no thanks))\b", re.I)


def recipient_turns(turns: list[dict]) -> list[str]:
    return [t.get("text", "") for t in turns if t.get("speaker") in RECIPIENT_ROLES]


def opening_only(turns: list[dict]) -> bool:
    """Recognize a short greeting/identity/question prefix, not arbitrary dialogue."""
    if not turns or len(turns) > 6:
        return False
    texts = [t.get("text", "").strip() for t in turns]
    joined = " ".join(texts)
    if len(joined) > 1000 or SUBSTANTIVE.search(joined) or END_CALL.search(joined):
        return False
    return all(bool(OPENING.search(t)) for t in texts if t) and bool(joined)


def resolve_input_mode(requested: str, turns: list[dict], contact_name: str = "") -> str:
    if not turns:
        return "persona"
    if requested == "exact":
        return "exact"
    # Never continue a supplied explicit refusal or request to end the call.
    if any(END_CALL.search(t) for t in recipient_turns(turns)):
        return "exact"
    # Names such as "Central Veterinary Clinic" or "Free Transport Rescue"
    # are identity, not medical/price/capability statements in a greeting.
    greeting_turns = [{**t, "text": re.sub(re.escape(contact_name), "this contact", t.get("text", ""), flags=re.I)}
                      for t in turns] if contact_name else turns
    if requested == "opening" or opening_only(greeting_turns):
        return "opening"
    return "exact"


def has_outcome(turns: list[dict]) -> bool:
    # A greeting, identity, or a question by itself is never an inquiry outcome.
    return any((END_CALL.search(t) or OUTCOME.search(t)) and not opening_only([{"speaker": "recipient", "text": t}])
               for t in recipient_turns(turns))


def completion_state(turns: list[dict]) -> str:
    if not turns:
        return "no_answer"
    return "complete" if has_outcome(turns) else "incomplete"
