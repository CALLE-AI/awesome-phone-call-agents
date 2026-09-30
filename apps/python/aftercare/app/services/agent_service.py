from __future__ import annotations

import inspect
import json
import logging
import re
from collections.abc import Callable
from typing import Any

from anthropic import Anthropic
from app.config import settings
from app.models.schemas import AgentChatResponse, AgentMessage
from app.repositories.agent_repository import AgentRepository
from app.services.agent_blocks import (
    AgentToolEvent,
    build_agent_blocks,
)
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 8

SYSTEM_INSTRUCTION = """
You are AfterCare Assistant, a clinical operations helper for hospital admins.

Tool use is mandatory. For any question about counts, lists, statistics, or a
specific patient, you MUST call the relevant tool first and answer only from its
result. Never say clinic data or tools are unavailable unless a tool you actually
called returned an error or an "unavailable" flag. Never say there was a "system
error" unless a tool result actually contains an error.

Tool selection guide:
- Unnamed patients ("the patient", "that one patient", "who are my patients")
  -> list_patients first. If the list has exactly one patient, immediately call
  get_patient_detail with that numeric id. If several, summarize the list and
  ask which id. Never guess id 1 from a count of 1.
- A name, phone number, or numeric id -> get_patient_detail with that string
- Emergency patients or emergency calls -> get_emergency_patients
- Totals, risk breakdown, overdue count, pending calls -> get_clinic_overview
- Who is overdue or missed a follow-up -> get_overdue_followups
- Recent discharges -> get_discharge_stats
- Patients at a specific risk level -> get_patients_by_risk
- Free-text clinical description of patients -> search_patients_semantic
- Symptoms or issues mentioned during calls -> search_call_transcripts

Call only the tools needed for the question. Do not call clinic overview,
emergency, or overdue tools unless the admin asked about those counts or lists.

If get_patient_detail returns ambiguous=true with candidates, list those
candidates (id, name, risk, diagnosis) and ask the admin which patient id
to use. Do not guess. When an id is known, call get_patient_detail again
with that numeric id.

Reply style:
- Start with a direct answer to the admin's question.
- Keep the reply to 2-6 short sentences or a few compact bullets.
- State important counts explicitly.
- Return clean plain text. Do not use markdown headings, bold markers, code
  fences, or tables.
- Mention only the most important details; the interface renders full tool
  results as structured cards below your reply.
- Do not produce markdown tables or repeat every row returned by a tool.
- Report zero clearly when a tool returns no records.

Be concise and factual. Do not invent patient data. Never provide medical
diagnosis or treatment advice; summarize recorded clinic data only.
""".strip()

ANTHROPIC_TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_clinic_overview",
        "description": (
            "Return clinic-wide counts: patients, risk breakdown, emergencies, "
            "overdue follow-ups, pending calls."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_discharge_stats",
        "description": (
            "Return patients discharged in the last N days with diagnosis and risk."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Number of days to look back.",
                    "default": 7,
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_patients_by_risk",
        "description": (
            "Return patients filtered by risk level: low, medium, high, or critical."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "level": {
                    "type": "string",
                    "description": "Risk level: low, medium, high, or critical.",
                },
            },
            "required": ["level"],
        },
    },
    {
        "name": "get_patient_detail",
        "description": (
            "Find one patient by name, phone number, or numeric id. "
            "Return demographics, protocol, and recent call summaries/symptoms."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name_or_id": {
                    "type": "string",
                    "description": "Patient name, phone number, or numeric id.",
                },
            },
            "required": ["name_or_id"],
        },
    },
    {
        "name": "list_patients",
        "description": (
            "List patients with id, name, risk, diagnosis, and protocol. "
            "Use when the admin asks about patients without giving a name, "
            "phone, or id."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of patients to return.",
                    "default": 25,
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_emergency_patients",
        "description": "Return recent emergency follow-up calls and related patients.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_overdue_followups",
        "description": (
            "Return patients whose follow-up is still pending and past the "
            "scheduled time."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "search_patients_semantic",
        "description": (
            "Semantic search over patient records for free-text clinical questions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Free-text clinical search query.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results.",
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "search_call_transcripts",
        "description": (
            "Semantic search over call summaries/transcripts for symptoms or "
            "issues mentioned."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Free-text search query.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results.",
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    },
]


def normalize_agent_reply(text: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        return "I could not generate a response from the available clinic data."

    cleaned = re.sub(r"\*\*(.*?)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"__(.*?)__", r"\1", cleaned)
    cleaned = re.sub(r"^#{1,6}\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = cleaned.replace("```", "").replace("`", "")
    return cleaned.strip()


def _friendly_llm_error(exc: Exception) -> str:
    """Map provider errors to short user-facing copy. Never forward raw API payloads."""
    message = str(exc)
    lowered = message.lower()

    if (
        "401" in lowered
        or "unauthenticated" in lowered
        or "invalid authentication" in lowered
        or "api key not valid" in lowered
        or "authentication_error" in lowered
        or "invalid_api_key" in lowered
        or "access_token_type_unsupported" in lowered
        or "permission_denied" in lowered
        or "403" in lowered
    ):
        return (
            "The AI service could not authenticate. "
            "Please contact your administrator to check the API configuration."
        )
    if "404" in lowered or "not_found" in lowered or "is not found" in lowered:
        return (
            "The configured AI model is unavailable. "
            "Please contact your administrator."
        )
    if (
        "503" in lowered
        or "unavailable" in lowered
        or "high demand" in lowered
        or "overloaded" in lowered
    ):
        return (
            "The AI service is temporarily busy. "
            "Please retry in a moment."
        )
    if (
        "429" in lowered
        or "quota" in lowered
        or "resource_exhausted" in lowered
        or "rate_limit" in lowered
    ):
        return (
            "The AI service has reached its current usage limit. "
            "Please try again later."
        )
    if "timeout" in lowered or "timed out" in lowered or "deadline" in lowered:
        return (
            "The AI service took too long to respond. "
            "Please try again."
        )

    return (
        "The clinical assistant is temporarily unavailable. "
        "Please try again in a moment."
    )


def _claude_text(response: Any) -> str:
    parts: list[str] = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return "\n".join(parts).strip()


def _invoke_tool(fn: Callable[..., dict[str, Any]], tool_input: dict[str, Any]) -> dict[str, Any]:
    signature = inspect.signature(fn)
    kwargs: dict[str, Any] = {}
    for name in signature.parameters:
        if name in tool_input:
            kwargs[name] = tool_input[name]
    return fn(**kwargs)


def _dedupe_tool_events(events: list[AgentToolEvent]) -> list[AgentToolEvent]:
    unique: list[AgentToolEvent] = []
    seen: set[str] = set()
    for event in events:
        key = json.dumps(
            {"name": event.name, "result": event.result},
            sort_keys=True,
            default=str,
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(event)
    return unique


class AgentServiceError(Exception):
    pass


class AgentService:
    def __init__(self, repo: AgentRepository) -> None:
        self.repo = repo

    def chat(
        self,
        *,
        message: str,
        history: list[AgentMessage] | None = None,
    ) -> AgentChatResponse:
        if not settings.agent_enabled:
            raise AgentServiceError(
                "The clinical assistant is currently disabled."
            )

        anthropic_ready = bool(settings.anthropic_api_key)
        gemini_ready = bool(settings.google_api_key and settings.agent_model)

        if not anthropic_ready and not gemini_ready:
            raise AgentServiceError(
                "The clinical assistant is not configured. "
                "Please contact your administrator."
            )

        prior_history = history or []
        tool_events: list[AgentToolEvent] = []
        tools_fns = self._build_tools(tool_events)
        last_error: Exception | None = None

        if anthropic_ready:
            try:
                reply = self._chat_with_claude(message, prior_history, tools_fns)
                return self._build_response(reply, tool_events)
            except Exception as exc:
                last_error = exc
                logger.exception("Claude chat failed")
                tool_events.clear()

        if gemini_ready:
            try:
                reply = self._chat_with_gemini(message, prior_history, tools_fns)
                return self._build_response(reply, tool_events)
            except Exception as exc:
                last_error = exc
                logger.exception("Gemini chat failed")

        raise AgentServiceError(
            _friendly_llm_error(last_error or Exception("not configured"))
        ) from last_error

    def _chat_with_claude(
        self,
        message: str,
        history: list[AgentMessage],
        tools_fns: list[Any],
    ) -> str:
        tools_by_name = {fn.__name__: fn for fn in tools_fns}
        client = Anthropic(api_key=settings.anthropic_api_key)
        messages: list[dict[str, Any]] = self._anthropic_history(history)
        messages.append({"role": "user", "content": message})

        for round_idx in range(MAX_TOOL_ROUNDS + 1):
            response = client.messages.create(
                model=settings.llm_model,
                max_tokens=2048,
                temperature=0.2,
                system=SYSTEM_INSTRUCTION,
                tools=ANTHROPIC_TOOLS,
                messages=messages,
            )

            if response.stop_reason != "tool_use" or round_idx == MAX_TOOL_ROUNDS:
                return _claude_text(response)

            tool_results: list[dict[str, Any]] = []
            for block in response.content:
                if getattr(block, "type", None) != "tool_use":
                    continue
                fn = tools_by_name.get(block.name)
                tool_input = dict(block.input or {})
                if fn is None:
                    result: dict[str, Any] = {
                        "error": f"Unknown tool: {block.name}",
                        "unavailable": True,
                    }
                else:
                    try:
                        result = _invoke_tool(fn, tool_input)
                    except Exception:
                        logger.exception("Agent tool %s failed", block.name)
                        result = {
                            "error": f"Tool {block.name} failed",
                            "unavailable": True,
                        }
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result, default=str),
                    }
                )

            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})

        return ""

    def _chat_with_gemini(
        self,
        message: str,
        history: list[AgentMessage],
        tools_fns: list[Any],
    ) -> str:
        client = genai.Client(api_key=settings.google_api_key)
        chat = client.chats.create(
            model=settings.agent_model,
            history=self._gemini_history(history),
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                tools=tools_fns,
                temperature=0.2,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    maximum_remote_calls=MAX_TOOL_ROUNDS,
                ),
            ),
        )
        response = chat.send_message(message)
        return getattr(response, "text", None) or ""

    def _build_response(
        self,
        reply: str,
        tool_events: list[AgentToolEvent],
    ) -> AgentChatResponse:
        events = _dedupe_tool_events(tool_events)
        unique_tools: list[str] = []
        seen: set[str] = set()
        for event in events:
            if event.name not in seen:
                seen.add(event.name)
                unique_tools.append(event.name)

        return AgentChatResponse(
            reply=normalize_agent_reply(reply),
            tool_calls_used=unique_tools,
            blocks=build_agent_blocks(events),
        )

    def _build_tools(self, tool_events: list[AgentToolEvent]) -> list[Any]:
        repo = self.repo

        def capture(name: str, result: dict[str, Any]) -> dict[str, Any]:
            tool_events.append(AgentToolEvent(name=name, result=result))
            return result

        def get_clinic_overview() -> dict:
            """Return clinic-wide counts: patients, risk breakdown, emergencies, overdue follow-ups, pending calls."""
            return capture("get_clinic_overview", repo.get_clinic_overview())

        def get_discharge_stats(days: int = 7) -> dict:
            """Return patients discharged in the last N days with diagnosis and risk."""
            return capture("get_discharge_stats", repo.get_discharge_stats(days=days))

        def get_patients_by_risk(level: str) -> dict:
            """Return patients filtered by risk level: low, medium, high, or critical."""
            return capture("get_patients_by_risk", repo.get_patients_by_risk(level))

        def get_patient_detail(name_or_id: str) -> dict:
            """Find one patient by name, phone number, or numeric id."""
            return capture("get_patient_detail", repo.get_patient_detail(name_or_id))

        def list_patients(limit: int = 25) -> dict:
            """List patients with id, name, risk, diagnosis, and protocol."""
            return capture("list_patients", repo.list_patients(limit=limit))

        def get_emergency_patients() -> dict:
            """Return recent emergency follow-up calls and related patients."""
            return capture("get_emergency_patients", repo.get_emergency_patients())

        def get_overdue_followups() -> dict:
            """Return patients whose follow-up is still pending and past the scheduled time."""
            return capture("get_overdue_followups", repo.get_overdue_followups())

        def search_patients_semantic(query: str, limit: int = 5) -> dict:
            """Semantic search over patient records for free-text clinical questions."""
            return capture(
                "search_patients_semantic",
                repo.search_patients_semantic(query, limit=limit),
            )

        def search_call_transcripts(query: str, limit: int = 5) -> dict:
            """Semantic search over call summaries/transcripts for symptoms or issues mentioned."""
            return capture(
                "search_call_transcripts",
                repo.search_call_transcripts(query, limit=limit),
            )

        return [
            get_clinic_overview,
            get_discharge_stats,
            get_patients_by_risk,
            get_patient_detail,
            list_patients,
            get_emergency_patients,
            search_patients_semantic,
            search_call_transcripts,
            get_overdue_followups,
        ]

    def _gemini_history(
        self,
        history: list[AgentMessage],
    ) -> list[types.Content]:
        contents: list[types.Content] = []
        for item in history[-10:]:
            role = "user" if item.role == "user" else "model"
            contents.append(
                types.Content(
                    role=role,
                    parts=[types.Part.from_text(text=item.content)],
                )
            )
        return contents

    def _anthropic_history(
        self,
        history: list[AgentMessage],
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        for item in history[-10:]:
            role = "user" if item.role == "user" else "assistant"
            messages.append({"role": role, "content": item.content})
        return messages
