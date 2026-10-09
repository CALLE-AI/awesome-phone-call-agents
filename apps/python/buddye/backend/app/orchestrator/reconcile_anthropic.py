"""LLM reconciler backed by the Anthropic SDK. Only used when ANTHROPIC_API_KEY is set.

It is given the call schema restricted to the failing fields, the transcript, and the provider
summary, and must return a JSON object containing only those fields. Structured outputs
(`output_config.format`) guarantee the shape; merge_reconciled() in reconcile.py still refuses
any *_quote that cannot be traced to something a human turn actually contains.

The GLM reconciler is the one that has been run against live calls, and its SYSTEM prompt carries
the full account of how people under-report. This one states the same rule in short: it exists as
the fallback when TokenRouter is not configured.
"""
from __future__ import annotations

import json
from typing import Any

from app import obs

SYSTEM = (
    "You reconcile the outcome of an automated welfare check-in call made to a neighbour during a hazard — "
    "extreme heat, a power cut, a flood. You will be given the JSON schema of the fields that are still "
    "unresolved, the call transcript, and the provider's summary. Fill in ONLY those fields, from what was "
    "actually said.\n\n"
    "Judge by what the person DESCRIBES, not by how they rate themselves. Older people play things down: "
    "\"I'm fine\", \"I don't want to be any trouble\" are said by people who are not fine, and when a "
    "reassurance is followed by a concrete detail — the cooler stopped, they cannot get out of the chair, "
    "the water ran out, the pills ran out — the detail decides the field. Do not manufacture alarm from "
    "politeness, a quiet voice, or living alone, and never record a symptom nobody described.\n\n"
    "Confusion or disorientation is a finding in its own right. Someone who cannot hear the questions has "
    "not answered them: those fields are \"unknown\", never \"no\". If a relative or carer answered, the "
    "person themselves was not reached, though what the third party reports is still usable. Nobody "
    "answering is not an error and not a \"no\": it means nothing was established.\n\n"
    "Use \"unknown\" (or \"\", or an empty list) whenever the transcript does not clearly establish a "
    "value. Help that was never said out loud on the call was neither accepted nor declined. For any "
    "*_quote field, copy the person's exact words from a human turn, or return \"\" — most calls have "
    "nothing alarming in them, and an invented sentence is the worst outcome this system can produce. "
    "Do not add fields."
)


class AnthropicReconciler:
    name = "anthropic"

    def __init__(self, *, api_key: str, model: str = "claude-opus-5") -> None:
        from anthropic import AsyncAnthropic

        self.client = AsyncAnthropic(api_key=api_key)
        self.model = model

    async def reconcile(
        self,
        *,
        schema: dict[str, Any],
        partial_result: dict[str, Any] | None,
        failing_fields: list[str],
        transcript: list[dict[str, Any]],
        summary: str | None,
        # Accepted for protocol parity with GlmReconciler (and tolerant of the aliases a caller may
        # reach for); the offers are not sent, because this path is the fallback and the schema
        # descriptions already name the identifiers.
        help_offered: list[dict[str, Any]] | None = None,
        disclosures: list[dict[str, Any]] | None = None,
        help_offers: list[dict[str, Any]] | None = None,
        **_: Any,
    ) -> dict[str, Any] | None:
        from app.calls.contract import iter_schema_fields

        # Flatten to dotted paths so a nested condition check can be asked for by name.
        wanted = set(failing_fields)
        props = {path: spec for path, spec, _ in iter_schema_fields(schema) if path in wanted}
        if not props:
            return None
        sub_schema = {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}
        # Same rule as the GLM path: a named person's words leaving the process are redacted first.
        lines = [f"{t.get('speaker', 'unknown')}: {obs.redact(t.get('text', ''))}" for t in transcript]
        user = (
            "Unresolved fields (JSON Schema):\n" + json.dumps(sub_schema, indent=1)
            + "\n\nValues already extracted (for context only):\n" + json.dumps(obs.redact(partial_result or {}), indent=1)
            + "\n\nProvider summary:\n" + (obs.redact(summary) if summary else "(none)")
            + "\n\nTranscript:\n" + ("\n".join(lines) or "(no transcript — nobody spoke on this call)")
        )
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            system=SYSTEM,
            messages=[{"role": "user", "content": user}],
            output_config={"format": {"type": "json_schema", "schema": sub_schema}, "effort": "medium"},
        )
        if response.stop_reason == "refusal":
            return None
        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return None
        return data if isinstance(data, dict) else None
