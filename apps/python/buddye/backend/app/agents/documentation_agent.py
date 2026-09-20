"""The paperwork, on the forms an emergency operations centre already reads.

Incident management is largely paperwork, and the forms are not arbitrary: ICS-214 (Activity Log)
and ICS-213 (General Message) are what a US EOC, a fire department and a county emergency manager
have all been trained on. A document a duty officer can read at a glance beats a prettier one they
have to learn, so BuddyE writes those.

The thing that makes this agent different from a summariser is what happens when it is unsure. This
is a document somebody may have to defend — to a family, to a county after-action review, to a
coroner. So:

* **Every statement is grounded in the record.** The agent is given the call outcomes, the times, the
  dispatches and what the person actually said, and it may use nothing else. "Not recorded" is a
  correct and useful entry; a plausible guess is a defect.
* **Code checks the grounding, it does not trust the instruction.** Quoted speech in the generated
  body must be traceable to something in the record (the same `quote_is_grounded` the reconciler
  uses on transcripts), and every number in it must appear in the record — an invented count or an
  invented time is the failure mode that matters here, and both are mechanically detectable.
* **The document exists either way.** Each form has a deterministic renderer that lays out the same
  record in the same ICS structure with no model involved. A failed, unparseable or ungrounded
  generation falls back to it, so an EOC is never left without its log because a free-tier gateway
  was busy. The model's contribution is readable narrative, not the facts.

Returned dicts are keyed exactly by `models.IncidentDocument` columns, so the API layer can build the
row directly. `approved_by` is not among them: a generated document is unsigned until a human signs
it, and there is no code path here that could fill that column in.

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
from datetime import date, datetime
from typing import Any, Sequence

from app import obs
from app.agents.client import AgentClient, record_action
from app.orchestrator.reconcile import quote_is_grounded

log = logging.getLogger("buddye.agents.documentation")

AGENT = "documentation_agent"
ACTION_KIND = "documentation"

NOT_RECORDED = "not recorded"

SYSTEM = (
    "You are the documentation unit of a neighbourhood emergency operations centre. You write the "
    "incident paperwork on the standard ICS forms, from the record of what actually happened: automated "
    "welfare calls to people on a block captain's list during a hazard, what those calls found, and what "
    "was sent to whom.\n\n"
    "THIS IS A LEGAL RECORD, NOT A SUMMARY. Somebody may have to defend it later — to a family, to a "
    "county after-action review, to an inquest. Every statement you write must come from the record you "
    "are given. You may condense, order and phrase; you may not add.\n\n"
    "NEVER INVENT A DETAIL. Not a time, not a count, not a unit, not an address, not an outcome, and "
    "above all not something a person said. If the record does not establish it, write \"not recorded\" "
    "— that is a correct entry and the people who read this rely on it. A plausible guess is the worst "
    "thing you can put on this form, because it is indistinguishable from a fact.\n\n"
    "NUMBERS AND TIMES ARE COPIED, NEVER COMPUTED. Every number and every timestamp in your document "
    "must appear in the record exactly as it appears there. Do not convert a time to another format, do "
    "not work out a duration, do not total anything that is not already totalled for you. A number you "
    "produced yourself will be rejected.\n\n"
    "QUOTED SPEECH IS VERBATIM. If you quote what somebody said, copy it from the record word for word. "
    "Never paraphrase inside quotation marks and never write a sentence nobody said.\n\n"
    "PLAIN, FACTUAL, CHRONOLOGICAL. Short entries in the past tense: what was done, when, by whom, what "
    "came of it. No adjectives about how serious it was, no reassurance, no blame, no speculation about "
    "why. An unanswered call is a finding, so log it as one — \"no answer\" is an outcome, not a gap.\n\n"
    "Reply with a single JSON object and nothing else — no prose, no markdown fences:\n"
    '{"title": "<short form title>", "body": "<the document body as plain text, lines separated by \\n>", '
    '"notes": "<anything the record leaves unresolved that a human should chase, or \\"\\">"}'
)

#: Quoted spans long enough to be a sentence somebody said. The floor keeps possessives and
#: contractions out of the check; a very short invented quote ("I'm dying") slips past it, which is
#: the known limit of this check and the reason the prompt carries the rule as well.
_QUOTED = re.compile(r"[\"“”']{1}([^\"“”'\n]{12,})[\"“”']{1}")
_DIGITS = re.compile(r"\d+")
#: Digit runs that are part of the form furniture rather than a claim about the incident.
_FORM_NUMBERS = frozenset({"214", "213", "911", "24"})
#: An ICS block number or a list marker: a digit opening a line, followed by a full stop or bracket.
_BLOCK_NUMBER = re.compile(r"^[ \t]*\d+[.)]", re.M)

#: Every timestamp in a record is rendered this way before anything sees it. The record arrives
#: carrying real `datetime` columns (`CheckCall.completed_at`, `Dispatch.committed_at`), and
#: `str(datetime)` keeps seconds and microseconds — so a model writing the sensible "14:02" would be
#: producing digits the record does not literally contain, and every document would fail the number
#: check and fall back forever. Normalising once, before the renderer, the prompt and the grounding
#: corpus are built from it, keeps all three in the same terms.
_TIME_FORMAT = "%Y-%m-%dT%H:%M"


def normalise_record(value: Any) -> Any:
    """Recursively render datetimes to one fixed minute-precision form. Everything else is untouched."""
    if isinstance(value, datetime):
        return value.strftime(_TIME_FORMAT)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: normalise_record(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalise_record(v) for v in value]
    return value


# ------------------------------------------------------------------ deterministic renderers
# Each of these produces a complete, correct document from the record with no model involved. They
# are the fallback, and they are also the yardstick: the model is only ever asked to say the same
# things more readably.

def _fmt_at(value: Any) -> str:
    return str(value) if value not in (None, "") else NOT_RECORDED


def _entry_line(entry: dict[str, Any]) -> str:
    at = _fmt_at(entry.get("at") or entry.get("time"))
    text = str(entry.get("text") or entry.get("activity") or "").strip() or NOT_RECORDED
    quote = str(entry.get("quote") or "").strip()
    line = f"{at:<20} {text}"
    if quote:
        line += f' — said: "{quote}"'
    return line


def render_activity_log(*, hazard: dict[str, Any], entries: Sequence[dict[str, Any]],
                        unit: str, prepared_by: str, incident: dict[str, Any] | None = None) -> str:
    incident = incident or {}
    lines = [
        "ICS-214 ACTIVITY LOG",
        "",
        f"1. Incident Name: {hazard.get('headline') or NOT_RECORDED}",
        f"2. Operational Period: {_fmt_at(hazard.get('starts_at'))} to {_fmt_at(hazard.get('ends_at'))}",
        f"3. Unit Name/Designators: {unit}",
        f"4. Prepared by: {prepared_by or NOT_RECORDED}",
    ]
    if incident:
        lines.append(
            f"5. Incident: {incident.get('id') or NOT_RECORDED} — {incident.get('address') or NOT_RECORDED}"
            f" (priority {incident.get('priority', NOT_RECORDED)})"
        )
    lines += ["", "6. Activity Log:", f"{'TIME':<20} ACTIVITY"]
    lines += [_entry_line(e) for e in entries] or [f"{NOT_RECORDED:<20} No activity recorded."]
    return "\n".join(lines)


def render_general_message(*, hazard: dict[str, Any], to: str, to_position: str, frm: str,
                           from_position: str, subject: str, at: str, message: str,
                           reply_requested: str = "") -> str:
    lines = [
        "ICS-213 GENERAL MESSAGE",
        "",
        f"1. Incident Name: {hazard.get('headline') or NOT_RECORDED}",
        f"2. To (Name/Position): {to or NOT_RECORDED}{f' / {to_position}' if to_position else ''}",
        f"3. From (Name/Position): {frm or NOT_RECORDED}{f' / {from_position}' if from_position else ''}",
        f"4. Subject: {subject or NOT_RECORDED}",
        f"5. Date/Time: {_fmt_at(at)}",
        "",
        "6. Message:",
        message.strip() or NOT_RECORDED,
    ]
    if reply_requested:
        lines += ["", f"7. Reply requested: {reply_requested}"]
    lines += ["", "8. Reply: (unanswered)"]
    return "\n".join(lines)


def render_situation_report(*, hazard: dict[str, Any], stats: dict[str, Any],
                            entries: Sequence[dict[str, Any]] = (), prepared_by: str = "") -> str:
    lines = [
        f"SITUATION REPORT — {hazard.get('headline') or NOT_RECORDED}",
        "",
        f"Area: {hazard.get('area') or NOT_RECORDED}",
        f"Operational period: {_fmt_at(hazard.get('starts_at'))} to {_fmt_at(hazard.get('ends_at'))}",
        f"Prepared by: {prepared_by or NOT_RECORDED}",
        "",
        "Current situation:",
    ]
    lines += [f"  {k.replace('_', ' ')}: {v}" for k, v in stats.items()] or [f"  {NOT_RECORDED}"]
    if entries:
        lines += ["", "Significant activity:"] + [f"  {_entry_line(e)}" for e in entries]
    lines += ["", "Prepared from the call and dispatch record. Unsigned until reviewed."]
    return "\n".join(lines)


# ------------------------------------------------------------------ grounding

def record_corpus(payload: Any) -> str:
    """Everything the model was shown, flattened, as the thing generated text must be traceable to."""
    return json.dumps(payload, default=str, ensure_ascii=False)


def ungrounded_quotes(body: str, corpus: str) -> list[str]:
    """Quoted speech in the document that nothing in the record supports.

    Reuses the reconciler's fuzzy grounding — punctuation and transcription noise are tolerated, an
    invented sentence is not — by presenting the record as a single spoken turn.
    """
    turns = [{"speaker": "record", "text": corpus}]
    return [q.strip() for q in _QUOTED.findall(body) if not quote_is_grounded(q, turns)]


def ungrounded_numbers(body: str, corpus: str) -> list[str]:
    """Numbers in the document that do not appear in the record.

    The cheapest possible check for the most expensive kind of invention: a count of households that
    nobody counted, or a time nobody logged, reads exactly like a fact once it is on an ICS form.

    Block numbers are excluded, not by allow-listing small numbers — "4 of them needed water" is
    exactly the kind of invented count this is here to catch — but by position: a digit that opens a
    line and is followed by a full stop is the form's own numbering ("1. Incident Name"), never a
    claim about the incident.
    """
    found = set(_DIGITS.findall(corpus))
    # "02" in the record and "2" in the prose are the same minute. Accepting the zero-stripped form
    # costs nothing — an invented 17 is still an invented 17 — and saves a document over a leading zero.
    known = found | {n.lstrip("0") or "0" for n in found} | _FORM_NUMBERS
    claims = _BLOCK_NUMBER.sub("", body)
    return [n for n in _DIGITS.findall(claims) if n not in known]


def _document(
    *,
    hazard_id: str,
    incident_id: str | None,
    form: str,
    title: str,
    body: str,
    fields: dict[str, Any],
    generated_by: str,
) -> dict[str, Any]:
    """Keyed exactly by IncidentDocument columns, so a caller can do IncidentDocument(**doc)."""
    return {
        "hazard_id": hazard_id,
        "incident_id": incident_id,
        "form": form,
        "title": title,
        "body": body,
        "fields": fields,
        "generated_by": generated_by,
        # approved_by is deliberately absent; nothing here may sign a document.
    }


async def _generate(
    *,
    agent_form: str,
    hazard_id: str,
    incident_id: str | None,
    record: dict[str, Any],
    instruction: str,
    fallback_title: str,
    fallback_body: str,
    fields: dict[str, Any],
    client: AgentClient | None,
    session: Any = None,
) -> dict[str, Any]:
    """Shared path: try the model, check its work against the record, fall back to the rendered form."""
    inputs = {"form": agent_form, "record": record}
    corpus = record_corpus(record)
    source, fallback_reason, title, body = "deterministic", "", fallback_title, fallback_body
    model_name, latency, error = "", None, None

    if client is None:
        fallback_reason = "no model configured"
    else:
        user = (
            instruction
            + "\n\nThe record — everything you know, and the only thing you may write from:\n"
            + json.dumps(obs.redact(record), indent=1, default=str)
            + "\n\nThe same document rendered mechanically from that record. Yours must contain the same "
              "facts, the same numbers and the same times, laid out in the same ICS structure, written so "
              "a duty officer can read it quickly:\n"
            + fallback_body
        )
        call = await client.complete_json(agent=AGENT, system=SYSTEM, user=user)
        model_name, latency, error = call.model, call.latency_ms, call.error
        if call.data is None:
            fallback_reason = call.error or "no reply"
        else:
            candidate_body = str(call.data.get("body") or "").strip()
            candidate_title = str(call.data.get("title") or "").strip() or fallback_title
            bad_quotes = ungrounded_quotes(candidate_body, corpus)
            bad_numbers = ungrounded_numbers(candidate_body, corpus)
            if not candidate_body:
                fallback_reason = "model returned an empty body"
            elif bad_quotes:
                # Words put in a frightened person's mouth, on a form somebody may act on.
                fallback_reason = f"quote not in the record: {bad_quotes[0][:80]!r}"
            elif bad_numbers:
                fallback_reason = f"number not in the record: {', '.join(sorted(set(bad_numbers))[:4])}"
            else:
                source, title, body = "model", candidate_title, candidate_body
                notes = str(call.data.get("notes") or "").strip()
                if notes:
                    fields = {**fields, "notes": notes}

    if fallback_reason:
        log.info("documentation_agent.fallback form=%s reason=%s", agent_form, fallback_reason)

    fields = {**fields, "source": source, "fallback_reason": fallback_reason}
    action_id = record_action(
        hazard_id=hazard_id, incident_id=incident_id, kind=ACTION_KIND, agent=AGENT, model=model_name,
        inputs=inputs, output={"form": agent_form, "title": title, "body": body, "source": source},
        rationale=fallback_reason or f"{agent_form} generated from the record by {model_name or 'the renderer'}.",
        latency_ms=latency, error=error or (fallback_reason or None), session=session,
    )
    fields = {**fields, "operator_action_id": action_id}
    generated_by = f"{AGENT}/{model_name}" if source == "model" else f"{AGENT}/renderer"
    return _document(hazard_id=hazard_id, incident_id=incident_id, form=agent_form, title=title,
                     body=body, fields=fields, generated_by=generated_by)


# ------------------------------------------------------------------ public API

async def write_activity_log(
    *,
    hazard_id: str,
    hazard: dict[str, Any],
    entries: Sequence[dict[str, Any]],
    incident_id: str | None = None,
    incident: dict[str, Any] | None = None,
    unit: str = "BuddyE Neighbourhood Check-in",
    prepared_by: str = "",
    client: AgentClient | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """ICS-214 for a sweep or a single incident.

    `entries` are the record: `{"at": <timestamp as it is stored>, "text": ..., "quote": <verbatim,
    optional>}`, in the order they happened. Nothing else reaches the document.
    """
    hazard, incident, entries = normalise_record((hazard, incident or {}, list(entries)))
    record = {"hazard": hazard, "incident": incident, "unit": unit,
              "prepared_by": prepared_by, "entries": entries}
    body = render_activity_log(hazard=hazard, entries=entries, unit=unit,
                               prepared_by=prepared_by, incident=incident)
    scope = (incident or {}).get("address") or hazard.get("area") or ""
    title = f"ICS-214 Activity Log — {scope}".strip(" —")
    return await _generate(
        agent_form="ICS-214", hazard_id=hazard_id, incident_id=incident_id, record=record,
        instruction="Write the ICS-214 Activity Log for this operational period. Keep the numbered form "
                    "structure and log every entry in the record, in order, one line each.",
        fallback_title=title, fallback_body=body,
        fields={"unit": unit, "prepared_by": prepared_by, "entry_count": len(list(entries))},
        client=client, session=session,
    )


async def write_general_message(
    *,
    hazard_id: str,
    hazard: dict[str, Any],
    to: str,
    frm: str,
    subject: str,
    message_record: dict[str, Any],
    to_position: str = "",
    from_position: str = "Block Captain / BuddyE",
    at: str = "",
    reply_requested: str = "",
    incident_id: str | None = None,
    client: AgentClient | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """ICS-213 to another unit or agency.

    `message_record` is what the message is about — the findings, the times, the dispatches — not
    prose. The wording is generated from it; the facts are not.
    """
    hazard, message_record, at = normalise_record((hazard, message_record, at))
    record = {"hazard": hazard, "to": to, "to_position": to_position, "from": frm,
              "from_position": from_position, "subject": subject, "at": at,
              "reply_requested": reply_requested, "content": message_record}
    mechanical = "\n".join(f"{k}: {v}" for k, v in message_record.items())
    body = render_general_message(hazard=hazard, to=to, to_position=to_position, frm=frm,
                                  from_position=from_position, subject=subject, at=at,
                                  message=mechanical, reply_requested=reply_requested)
    return await _generate(
        agent_form="ICS-213", hazard_id=hazard_id, incident_id=incident_id, record=record,
        instruction="Write the ICS-213 General Message. Keep the numbered form structure. Block 6 is the "
                    "message itself: what the recipient needs to know and what is being asked of them, in "
                    "a few plain sentences drawn only from the record. Leave block 8 (Reply) unanswered.",
        fallback_title=f"ICS-213 — {subject}" if subject else "ICS-213 General Message",
        fallback_body=body,
        fields={"to": to, "to_position": to_position, "from": frm, "from_position": from_position,
                "subject": subject, "at": at, "reply_requested": reply_requested},
        client=client, session=session,
    )


async def write_situation_report(
    *,
    hazard_id: str,
    hazard: dict[str, Any],
    stats: dict[str, Any],
    entries: Sequence[dict[str, Any]] = (),
    prepared_by: str = "",
    client: AgentClient | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """The whole-hazard picture: how many were contacted, how many were not, what was sent.

    `stats` are counted by the caller from the record and are passed through to the document
    unchanged. The model may describe them; it may not recount them, and a number it produces that
    is not in `stats` is what sends this back to the renderer.
    """
    hazard, stats, entries = normalise_record((hazard, stats, list(entries)))
    record = {"hazard": hazard, "stats": stats, "entries": entries, "prepared_by": prepared_by}
    body = render_situation_report(hazard=hazard, stats=stats, entries=entries, prepared_by=prepared_by)
    return await _generate(
        agent_form="situation_report", hazard_id=hazard_id, incident_id=None, record=record,
        instruction="Write the situation report for this hazard: what is happening, how many people were "
                    "contacted and what was found, who could not be reached, what has been sent, and what "
                    "is outstanding. Every count comes from the record's stats block, copied exactly. "
                    "People who could not be reached are reported as an open item, never as \"no issues\".",
        fallback_title=f"Situation Report — {hazard.get('headline') or hazard.get('area') or 'hazard'}",
        fallback_body=body,
        fields={"stats": dict(stats), "prepared_by": prepared_by},
        client=client, session=session,
    )
