"""
Python port of the generation layer described in TECHNICAL_ARCH.md section 5
(now engine/app/generator.py, not lib/generator.ts — see engine/README.md). Turns a
natural-language prompt (or an existing workflow plus an edit instruction) into a
Workflow object using the Gemini API.

Structured output comes from Gemini's JSON mode plus `response_json_schema` (JSON
Schema, not the more restrictive OpenAPI-subset `response_schema`) — this is the one
Gemini output mode that tolerates the recursive `OutcomeField.items` / `properties`
shape, via `$defs`/`$ref`. Gemini unrolls cyclic refs "to a limited degree" and only
within non-required properties, which is exactly how `items`/`properties` are already
modeled (both optional). Schema conformance from Gemini is still only a strong hint, not
a guarantee, so Pydantic validation is the actual gate, same retry-once-on-failure
behavior TECHNICAL_ARCH 5.3 describes.
"""

from __future__ import annotations

import json
import uuid
from collections import deque
from typing import Any

from google import genai
from google.genai import types
from pydantic import ValidationError

from app.config import settings
from app.models.workflow import Workflow

_OUTCOME_FIELD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "type": {
            "type": "string",
            "enum": ["string", "number", "integer", "boolean", "object", "array"],
        },
        "description": {"type": "string"},
        "enumValues": {"type": "array", "items": {"type": "string"}},
        "required": {"type": "boolean"},
        "items": {"$ref": "#/$defs/outcomeField"},
        "properties": {"type": "array", "items": {"$ref": "#/$defs/outcomeField"}},
    },
    "required": ["name", "type"],
}

_WORKFLOW_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "$defs": {"outcomeField": _OUTCOME_FIELD_SCHEMA},
    "properties": {
        "name": {
            "type": "string",
            "description": "A concise workflow name, no more than six words.",
        },
        "goal": {
            "type": "string",
            "description": "The overall purpose of the calling process, one sentence.",
        },
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Short unique id, e.g. n1"},
                    "type": {
                        "type": "string",
                        "enum": ["start", "question", "decision", "terminal"],
                    },
                    "label": {"type": "string", "description": "Short purpose label"},
                    "say": {"type": "string", "description": "What the agent says at this step"},
                    "captures": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "snake_case field names this node captures",
                    },
                },
                "required": ["id", "type", "label", "say", "captures"],
            },
        },
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "condition": {
                        "type": ["string", "null"],
                        "description": 'Branch label, e.g. "Yes", "Qualified". null if unconditional.',
                    },
                },
                "required": ["id", "from", "to", "condition"],
            },
        },
        "qualification": {
            "type": "object",
            "properties": {
                "rules": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {
                                "type": "string",
                                "description": "Must match a name in some node's captures",
                            },
                            "operator": {
                                "type": "string",
                                "enum": ["gte", "lte", "eq", "in"],
                            },
                            "value": {
                                "description": "string, number, or array of strings depending on operator"
                            },
                            "points": {"type": "number"},
                        },
                        "required": ["field", "operator", "value", "points"],
                    },
                },
                "threshold": {
                    "type": "number",
                    "description": "Total score at or above which the lead is qualified",
                },
            },
            "required": ["rules", "threshold"],
        },
        "outcomeSchema": {
            "type": "object",
            "properties": {
                "fields": {"type": "array", "items": {"$ref": "#/$defs/outcomeField"}},
                "nextStep": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Permitted next-step disposition values, e.g. book_advisor, send_info",
                },
            },
            "required": ["fields", "nextStep"],
        },
    },
    "required": ["name", "goal", "nodes", "edges", "qualification", "outcomeSchema"],
}

_SYSTEM_PROMPT = """You are Veyra's workflow generator. Veyra turns a natural-language \
description of an outbound calling process into a structured, editable conversation \
workflow.

Given the user's prompt, do the following, in order:
1. Create a concise workflow name of no more than six words.
2. Identify the goal of the calling process.
3. Identify what information needs to be collected from the contact.
4. Generate a sequence of conversation nodes, including branches for consent, the \
qualification outcome, and any domain-specific branches the prompt implies (e.g. risk \
tolerance tiers). Node types are exactly: "start", "question", "decision", "terminal". \
There must be exactly one "start" node and at least one "terminal" node. Every \
non-terminal node needs at least one outgoing edge; every id referenced by an edge must \
exist.
5. Generate qualification rules scored from the fields the nodes capture, plus a \
threshold.
6. Generate the outcome schema: the structured data the campaign should return, plus the \
permitted next-step disposition values.
7. Respond with only the workflow object matching the required schema. Do not include \
x/y layout coordinates or a workflow-level id — the caller assigns those.

CALL-E's Calls API places exactly one adaptive AI conversation per call and cannot \
connect that call live to a human mid-conversation — there is no in-call transfer \
capability available through this API, and even where CALL-E's platform supports \
transfer elsewhere, it must be separately enabled per account. If the process escalates \
to a human (a specialist, advisor, broker, or agent), always phrase that step as an \
asynchronous follow-up the AI promises on the call — for example "a specialist will \
call you back within one business day" or "we will email you a summary" — never as a \
live handoff. Do not write step text like "stay on the line", "connecting you now", \
"transferring you", or "put you through".

If the prompt is ambiguous, default to a sensible assumption rather than asking a \
clarifying question — for example, if no escalation path is described, default to a \
single qualified / not-ready branch. Keep the graph as small as the process allows; do \
not add nodes the prompt does not imply.

The outcome schema fields end up in a result schema CALL-E validates strictly. Only use \
field types "string", "number", "integer", "boolean", "object", or "array". Do not use \
$ref, oneOf, anyOf, or allOf anywhere, and never set additionalProperties to true. Object \
fields need "properties"; array fields need "items"."""

_EDIT_SYSTEM_SUFFIX = """

You are editing an existing workflow, not creating one from scratch. The user's message \
contains the current workflow as JSON followed by an edit instruction. Apply exactly the \
requested change and respond with the FULL updated workflow — every node and edge that \
is not affected by the instruction should be carried over unchanged, including existing \
ids and the workflow name. Do not regenerate parts of the workflow the instruction did \
not ask you to change."""

_MAX_ATTEMPTS = 2


class WorkflowGenerationError(Exception):
    pass


def _client() -> genai.Client:
    if not settings.gemini_api_key:
        raise WorkflowGenerationError("GEMINI_API_KEY is not configured")
    return genai.Client(api_key=settings.gemini_api_key)


def _to_workflow(raw: dict, workflow_id: str | None) -> Workflow:
    raw = dict(raw)
    raw["id"] = workflow_id or f"w_{uuid.uuid4().hex[:12]}"
    raw["nodes"] = _auto_layout(raw.get("nodes", []), raw.get("edges", []))
    return Workflow.model_validate(raw)


def _auto_layout(nodes: list[dict], edges: list[dict]) -> list[dict]:
    """Top-to-bottom layered layout by BFS depth from the start node(s), same idea
    TECHNICAL_ARCH 6.2 describes for the React Flow renderer — done here so every
    Workflow the engine returns already has valid x/y, since the schema requires them."""
    adjacency: dict[str, list[str]] = {}
    for edge in edges:
        adjacency.setdefault(edge["from"], []).append(edge["to"])

    starts = [n["id"] for n in nodes if n.get("type") == "start"]
    depth: dict[str, int] = {}
    queue: deque[tuple[str, int]] = deque((s, 0) for s in starts)
    while queue:
        node_id, d = queue.popleft()
        if node_id in depth:
            continue
        depth[node_id] = d
        for nxt in adjacency.get(node_id, []):
            queue.append((nxt, d + 1))

    max_depth = max(depth.values(), default=0)
    column_at_depth: dict[int, int] = {}
    laid_out = []
    for node in nodes:
        d = depth.get(node["id"], max_depth + 1)
        col = column_at_depth.get(d, 0)
        column_at_depth[d] = col + 1
        laid_out.append({**node, "x": 60 + col * 340, "y": 40 + d * 128})
    return laid_out


def _generate_content(client: genai.Client, system_prompt: str, contents: list) -> str:
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
            response_json_schema=_WORKFLOW_RESPONSE_SCHEMA,
        ),
    )
    if not response.text:
        raise WorkflowGenerationError("Empty response from Gemini")
    return response.text


def _run_with_retry(
    client: genai.Client,
    system_prompt: str,
    contents: list,
    workflow_id: str | None = None,
) -> Workflow:
    last_error: Exception | None = None
    for attempt in range(_MAX_ATTEMPTS):
        text = _generate_content(client, system_prompt, contents)
        try:
            raw = json.loads(text)
        except json.JSONDecodeError as exc:
            last_error = exc
            if attempt + 1 >= _MAX_ATTEMPTS:
                break
            contents = contents + [
                types.Content(role="model", parts=[types.Part(text=text)]),
                types.Content(
                    role="user",
                    parts=[types.Part(text=f"That was not valid JSON: {exc}. Try again.")],
                ),
            ]
            continue

        try:
            return _to_workflow(raw, workflow_id)
        except ValidationError as exc:
            last_error = exc
            if attempt + 1 >= _MAX_ATTEMPTS:
                break
            correction = (
                "The previous attempt failed schema validation with this error:\n"
                f"{exc}\nRespond again with a corrected workflow that fixes exactly this "
                "problem."
            )
            contents = contents + [
                types.Content(role="model", parts=[types.Part(text=text)]),
                types.Content(role="user", parts=[types.Part(text=correction)]),
            ]
    raise WorkflowGenerationError(f"Model output failed validation twice: {last_error}")


def generate_workflow(prompt: str) -> Workflow:
    client = _client()
    contents = [types.Content(role="user", parts=[types.Part(text=prompt)])]
    return _run_with_retry(client, _SYSTEM_PROMPT, contents)


def edit_workflow(workflow: Workflow, instruction: str) -> Workflow:
    client = _client()
    current_json = workflow.model_dump_json(by_alias=True)
    user_content = f"Current workflow:\n{current_json}\n\nEdit instruction:\n{instruction}"
    contents = [types.Content(role="user", parts=[types.Part(text=user_content)])]
    return _run_with_retry(
        client, _SYSTEM_PROMPT + _EDIT_SYSTEM_SUFFIX, contents, workflow_id=workflow.id
    )
