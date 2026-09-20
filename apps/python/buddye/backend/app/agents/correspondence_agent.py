"""Messages to the people around a neighbour: the contact they nominated, a family member, an agency.

These are the messages a block captain writes at eleven at night and gets wrong, because writing to
somebody's daughter about their mother is hard: too little and she does not understand why you rang,
too much and she is driving across town at midnight for a woman who is sitting down with a glass of
water. So the agent drafts them — warm, plain, specific, no jargon, and no alarm it cannot point at
a fact for.

Two properties are enforced by code rather than asked for in the prompt:

* **A draft is not a message.** Everything returned here is keyed by `models.Correspondence` columns
  and `sent_at` is not one of them, nor is `approved_by`. There is no path in this module that could
  populate either. Nobody has been contacted until a human releases it, which is the same boundary
  the handoff packet draws.
* **A draft may never imply it was already sent, or that help is already coming.** That is the one
  failure that turns a helpful note into a harmful one: a daughter who reads "we've let the
  paramedics know" stops making her own calls. `implies_already_sent` checks the generated text and
  sends it back to the template if it makes that claim.

The recipient's phone number or email is set from the record by code and never goes to the model:
the wording of a message to Rosa's daughter does not depend on her phone number, so it does not
leave the process.

A note for the caller, and it is not a style preference: **do not hold a database session open across
a call to one of these agents.** The model takes 20-100 s on the free tier, sqlite is in WAL mode with
a five-second busy timeout, and the provenance write would sit behind your open transaction, stall for
five seconds and then be lost. Either call the agent with no session open, or pass your own session as
`session=` and the row is written into it.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Sequence

from app import obs
from app.agents.client import AgentClient, record_action
from app.agents.documentation_agent import (
    normalise_record,
    record_corpus,
    ungrounded_numbers,
    ungrounded_quotes,
)

log = logging.getLogger("buddye.agents.correspondence")

AGENT = "correspondence_agent"
ACTION_KIND = "correspondence"

SYSTEM = (
    "You draft short messages on behalf of a neighbourhood block captain whose volunteers ring round "
    "vulnerable neighbours when there is a hazard — extreme heat, a power cut, a flood. You are writing "
    "to somebody who cares about the person: the contact they nominated, a son or daughter, sometimes an "
    "agency that has been asked to help.\n\n"
    "WARM, PLAIN AND SHORT. Write the way one neighbour writes to another. No jargon, no incident "
    "numbers, no \"per protocol\", no \"we are reaching out\". Four or five sentences. Say who you are, "
    "why you are writing, exactly what happened, and exactly what you are asking them to do.\n\n"
    "SPECIFIC, NOT DRAMATIC. Give the facts from the record — when the call was made, what was found or "
    "not found, what was arranged — and let them speak. Do not add urgency the record does not support, "
    "and do not soften a real finding into nothing either. Somebody deciding whether to drive over needs "
    "to know what is actually true.\n\n"
    "NEVER SAY HELP IS ALREADY COMING. You may say what has been arranged only if the record says it "
    "was. Never write that emergency services have been called, that an ambulance is on its way, that "
    "anyone has been notified, or that this message has already been sent to someone else. A person who "
    "believes help is coming stops calling for it themselves, and that is the most dangerous sentence "
    "you could write.\n\n"
    "NEVER INVENT. Not a time, not a symptom, not a diagnosis, not a sentence the person said. Quote "
    "them only word for word from the record. If something is unknown — and after nobody answers the "
    "phone almost everything is unknown — say so plainly: not knowing is exactly why you are writing.\n\n"
    "GIVE THEM ONE CLEAR THING TO DO, and make it easy: look in on her, ring her, ring us back and say "
    "whether you got hold of her. Ask, never instruct, and never imply they have done something wrong.\n\n"
    "Reply with a single JSON object and nothing else — no prose, no markdown fences:\n"
    '{"subject": "<short subject line>", "body": "<the message>"}'
)

#: Claims a draft must not make. This is deliberately narrow: the property being defended is that
#: nobody reads a draft and believes help is already on its way, or that someone else has been told.
#: A general "unjustified alarm" detector would be a regex zoo; this is one testable rule.
_ALREADY_SENT = [
    (re.compile(r"\b(ambulance|paramedics?|fire (crew|department)|police)\b[^.]{0,40}\b(is|are|have been|has been|'s)\b"
                r"[^.]{0,20}\b(on (the|its|his|her|their) way|en route|coming|dispatched|called|notified|sent)\b", re.I),
     "says an agency is already coming"),
    (re.compile(r"\b(we|i)\s+(have|'ve|has)?\s*(already\s+)?(called|rung|phoned|notified|alerted|contacted)\s+"
                r"(911|9-1-1|emergency services|the paramedics|the ambulance|the fire|the police)\b", re.I),
     "claims emergency services were contacted"),
    (re.compile(r"\bhelp is (on the way|coming)\b", re.I), "says help is on the way"),
    (re.compile(r"\bthis (message|note) (has been|was) sent\b", re.I), "claims the message was already sent"),
    (re.compile(r"\bwe (have|'ve) (also )?(sent|forwarded|passed) this (on|message|note)\b", re.I),
     "claims the message was already passed on"),
]


def implies_already_sent(text: str) -> str:
    """Why this draft must not go out as written, or "" if it is clean."""
    for pattern, why in _ALREADY_SENT:
        if pattern.search(text or ""):
            return why
    return ""


def _draft(
    *,
    hazard_id: str,
    incident_id: str | None,
    neighbour_id: str | None,
    channel: str,
    to_name: str,
    to_ref: str,
    subject: str,
    body: str,
    drafted_by: str,
) -> dict[str, Any]:
    """Keyed exactly by Correspondence columns — minus `sent_at` and `approved_by`, which no code
    path in this module can reach."""
    return {
        "hazard_id": hazard_id,
        "incident_id": incident_id,
        "neighbour_id": neighbour_id,
        "channel": channel,
        "to_name": to_name,
        "to_ref": to_ref,
        "subject": subject,
        "body": body,
        "drafted_by": drafted_by,
    }


async def _compose(
    *,
    hazard_id: str,
    incident_id: str | None,
    neighbour_id: str | None,
    channel: str,
    to_name: str,
    to_ref: str,
    record: dict[str, Any],
    instruction: str,
    fallback_subject: str,
    fallback_body: str,
    client: AgentClient | None,
    session: Any = None,
) -> dict[str, Any]:
    """Try the model, check what it wrote, and fall back to the plain template if anything is off."""
    corpus = record_corpus(record)
    source, fallback_reason = "template", ""
    subject, body = fallback_subject, fallback_body
    model_name, latency, error = "", None, None

    if client is None:
        fallback_reason = "no model configured"
    else:
        user = (
            instruction
            + "\n\nThe record — everything known, and the only thing you may write from:\n"
            + str(obs.redact(_readable(record)))
            + "\n\nThe plain version somebody would otherwise send. Yours must say the same things, "
              "better:\n" + fallback_body
        )
        call = await client.complete_json(agent=AGENT, system=SYSTEM, user=user)
        model_name, latency, error = call.model, call.latency_ms, call.error
        if call.data is None:
            fallback_reason = call.error or "no reply"
        else:
            candidate = str(call.data.get("body") or "").strip()
            claim = implies_already_sent(candidate)
            bad_quotes = ungrounded_quotes(candidate, corpus)
            bad_numbers = ungrounded_numbers(candidate, corpus)
            if not candidate:
                fallback_reason = "model returned an empty body"
            elif claim:
                fallback_reason = f"draft {claim}"
            elif bad_quotes:
                fallback_reason = f"quote not in the record: {bad_quotes[0][:80]!r}"
            elif bad_numbers:
                fallback_reason = f"number not in the record: {', '.join(sorted(set(bad_numbers))[:4])}"
            else:
                source = "model"
                body = candidate
                subject = str(call.data.get("subject") or "").strip() or fallback_subject

    if fallback_reason:
        log.info("correspondence_agent.fallback to=%s reason=%s", channel, fallback_reason)

    action_id = record_action(
        hazard_id=hazard_id, incident_id=incident_id, kind=ACTION_KIND, agent=AGENT, model=model_name,
        inputs={"channel": channel, "to_name": to_name, "record": record},
        # `sent` is recorded as a fact about the draft, and it is always false here: this agent
        # produces text, and only a human's release makes it a message.
        output={"subject": subject, "body": body, "source": source, "sent": False},
        rationale=fallback_reason or f"Drafted for {to_name or 'the contact'}; awaiting a human release.",
        latency_ms=latency, error=error or (fallback_reason or None), session=session,
    )
    drafted_by = f"{AGENT}/{model_name}" if source == "model" else f"{AGENT}/template"
    draft = _draft(hazard_id=hazard_id, incident_id=incident_id, neighbour_id=neighbour_id,
                   channel=channel, to_name=to_name, to_ref=to_ref, subject=subject, body=body,
                   drafted_by=drafted_by)
    draft["operator_action_id"] = action_id  # provenance for the API layer; not a Correspondence column
    return draft


def _readable(record: dict[str, Any]) -> str:
    return json.dumps(record, indent=1, default=str, ensure_ascii=False)


def _attempt_lines(attempts: Sequence[dict[str, Any]]) -> str:
    if not attempts:
        return "  (no attempts recorded)"
    return "\n".join(
        f"  - {a.get('at') or 'time not recorded'}: {a.get('outcome') or a.get('status') or 'no answer'}"
        for a in attempts
    )


# ------------------------------------------------------------------ public API

async def draft_contact_message(
    *,
    hazard_id: str,
    hazard: dict[str, Any],
    neighbour: dict[str, Any],
    attempts: Sequence[dict[str, Any]] = (),
    incident_id: str | None = None,
    channel: str = "sms",
    captain_name: str = "",
    client: AgentClient | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """To the emergency contact after an UNREACHABLE.

    The hardest of the three to write, because nothing is known: the honest message says a call was
    tried, says when, says nobody answered, and asks them to look in. It must not reassure and it
    must not frighten, and both are easy to do by accident.
    """
    hazard, neighbour, attempts = normalise_record((hazard, neighbour, list(attempts)))
    name = neighbour.get("name") or "your neighbour"
    to_name = neighbour.get("contact_name") or ""
    relation = neighbour.get("contact_relation") or ""
    record = {
        "hazard": {k: hazard.get(k) for k in ("headline", "area", "severity", "kind")},
        "neighbour": {"name": name, "address": neighbour.get("address"), "lives_alone": neighbour.get("lives_alone")},
        "attempts": list(attempts),
        "outcome": "UNREACHABLE — nobody answered",
        "captain": captain_name,
        "what_is_known": "Nothing about how they are. The call was not answered.",
    }
    body = (
        f"Hello{f' {to_name}' if to_name else ''}, this is {captain_name or 'the block captain'} from the "
        f"neighbourhood check-in in {hazard.get('area') or 'the area'}.\n\n"
        f"We are ringing round during the {hazard.get('headline') or 'current hazard'} and we tried "
        f"{name} today:\n{_attempt_lines(attempts)}\n\n"
        f"Nobody answered, so we do not know how they are — that is the only reason we are writing, and "
        f"it may well be nothing. You are listed as {relation or 'their contact'}. Could you try them, or "
        f"look in if you are nearby, and let us know either way?"
    )
    return await _compose(
        hazard_id=hazard_id, incident_id=incident_id, neighbour_id=neighbour.get("id"),
        channel=channel, to_name=to_name, to_ref=neighbour.get("contact_phone") or "",
        record=record,
        instruction=f"Write to {to_name or 'the contact'} ({relation or 'nominated contact'}) of {name}. "
                    "Nobody answered the check-in call, so nothing is known about how they are: say that "
                    "plainly, say when the call was tried, and ask them to check and reply either way.",
        fallback_subject=f"Check-in call to {name} — no answer",
        fallback_body=body, client=client, session=session,
    )


async def draft_family_update(
    *,
    hazard_id: str,
    hazard: dict[str, Any],
    neighbour: dict[str, Any],
    visit: dict[str, Any],
    incident_id: str | None = None,
    channel: str = "sms",
    captain_name: str = "",
    to_name: str = "",
    to_ref: str = "",
    client: AgentClient | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """To a family member after a welfare visit: what was found, what was done, what is next.

    `visit` is the record of the visit — who went, when they arrived, what they found, what was left
    behind, what is still outstanding. The agent may phrase it; it may not add to it.
    """
    hazard, neighbour, visit = normalise_record((hazard, neighbour, visit))
    name = neighbour.get("name") or "your relative"
    to_name = to_name or neighbour.get("contact_name") or ""
    record = {
        "hazard": {k: hazard.get(k) for k in ("headline", "area", "severity", "kind")},
        "neighbour": {"name": name, "address": neighbour.get("address")},
        "visit": dict(visit),
        "captain": captain_name,
    }
    found = visit.get("found") or "not recorded"
    done = visit.get("actions") or visit.get("done") or "not recorded"
    outstanding = visit.get("outstanding") or "nothing outstanding was recorded"
    body = (
        f"Hello{f' {to_name}' if to_name else ''}, this is {captain_name or 'the block captain'} from the "
        f"neighbourhood check-in.\n\n"
        f"{visit.get('who') or 'One of our volunteers'} called at {name}'s at "
        f"{visit.get('arrived_at') or 'a time we have not recorded'} during the "
        f"{hazard.get('headline') or 'current hazard'}.\n\n"
        f"What they found: {found}.\nWhat they did: {done}.\nStill outstanding: {outstanding}.\n\n"
        f"We wanted you to know how they are. If you would like us to look in again, just say."
    )
    return await _compose(
        hazard_id=hazard_id, incident_id=incident_id, neighbour_id=neighbour.get("id"),
        channel=channel, to_name=to_name, to_ref=to_ref or neighbour.get("contact_phone") or "",
        record=record,
        instruction=f"Write to {to_name or 'the family'} about {name} after a volunteer's welfare visit. "
                    "Say what was found, what was done, and what is still outstanding, from the visit "
                    "record only. Reassure only as far as the record actually reassures.",
        fallback_subject=f"We looked in on {name} today",
        fallback_body=body, client=client, session=session,
    )


async def draft_agency_message(
    *,
    hazard_id: str,
    hazard: dict[str, Any],
    neighbour: dict[str, Any],
    packet: dict[str, Any],
    agency: str,
    incident_id: str | None = None,
    channel: str = "call_script",
    captain_name: str = "",
    client: AgentClient | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """The covering message that goes alongside a handoff packet, for the human releasing it to read.

    Still a draft. A handoff packet is released by a named person and this message goes with it; the
    agent prepares the words so that release is one decision instead of two, and prepares nothing
    else. Addresses and access notes are included on purpose — a packet with the address masked
    helps nobody — and the phone numbers are masked on the way out, as everywhere else.
    """
    hazard, neighbour, packet = normalise_record((hazard, neighbour, packet))
    name = neighbour.get("name") or "the resident"
    record = {
        "hazard": {k: hazard.get(k) for k in ("headline", "area", "severity", "kind")},
        "resident": {
            "name": name, "address": neighbour.get("address"), "unit": neighbour.get("unit"),
            "access_notes": neighbour.get("access_notes"), "age_band": neighbour.get("age_band"),
            "lives_alone": neighbour.get("lives_alone"), "mobility": neighbour.get("mobility"),
            "conditions": neighbour.get("conditions"), "power_dependent": neighbour.get("power_dependent"),
        },
        "packet": {k: packet.get(k) for k in
                   ("last_contact_at", "last_words", "concerns", "attempts_summary", "recommended_action")},
        "requested_by": captain_name,
        "status": "PREPARED — not released. A named human must authorise this before it is sent.",
    }
    concerns = packet.get("concerns") or []
    unit_suffix = f", {neighbour['unit']}" if neighbour.get("unit") else ""
    body = (
        f"For {agency}, from the {hazard.get('area') or 'neighbourhood'} block check-in"
        f"{f' ({captain_name})' if captain_name else ''}.\n\n"
        f"Resident: {name}, {neighbour.get('address') or 'address not recorded'}{unit_suffix}.\n"
        f"Access: {neighbour.get('access_notes') or 'not recorded'}.\n"
        f"Relevant: {', '.join(neighbour.get('conditions') or []) or 'not recorded'}"
        f"{'; depends on mains power for medical equipment' if neighbour.get('power_dependent') else ''}.\n"
        f"Hazard: {hazard.get('headline') or 'not recorded'}.\n"
        f"Last contact: {packet.get('last_contact_at') or 'not recorded'}.\n"
        f"What they said: {packet.get('last_words') or 'not recorded'}.\n"
        f"Concerns: {'; '.join(str(c) for c in concerns) or 'not recorded'}.\n"
        f"What we are asking for: {packet.get('recommended_action') or 'not recorded'}.\n\n"
        f"This is a draft prepared by the check-in system. It has not been sent."
    )
    return await _compose(
        hazard_id=hazard_id, incident_id=incident_id, neighbour_id=neighbour.get("id"),
        channel=channel, to_name=agency, to_ref="", record=record,
        instruction=f"Write the covering message to {agency} that goes with this handoff packet: who the "
                    "resident is, where they are, how to get in, what is wrong, when they were last in "
                    "contact, and what is being asked for. Factual and complete — a crew reads it on the "
                    "way. Do not state or imply that it has been sent or that anyone is already going.",
        fallback_subject=f"Welfare handoff — {name}, {neighbour.get('address') or 'address not recorded'}",
        fallback_body=body, client=client, session=session,
    )
