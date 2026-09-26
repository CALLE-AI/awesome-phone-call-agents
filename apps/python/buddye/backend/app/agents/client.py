"""One TokenRouter client for every operator agent, and the provenance row each call leaves behind.

The client discipline here is not new work: it is lifted from `app/orchestrator/reconcile_glm.py`,
which is live-tested against this exact gateway and model. The two pure helpers are *imported* from
there rather than copied, deliberately — `is_response_format_rejection` encodes a hard-won
distinction (a 4xx the retry can fix versus a timeout it cannot) and `extract_json_object` encodes
what a free-tier model actually emits when told not to use markdown fences. A second copy of either
would drift from the tested one, and the drift would show up as a dropped ambulance request rather
than as a failing test.

Three properties this module exists to guarantee:

* **An agent can never break a sweep.** `complete_json` catches everything. It returns an
  `AgentCall` whose `data` is None on any failure — a timeout, a dead gateway, prose instead of
  JSON — and the caller degrades to its deterministic answer. The operator layer is an improvement
  on the deterministic pick, never a dependency of it.
* **Nothing that leaves the process is unredacted.** The prompt is the one payload carrying a named
  person's health information and address off this machine, so it goes through `obs.redact` on the
  way out and the stored inputs/outputs go through it again on the way into the database.
* **Every call is answerable for afterwards.** `record_action` writes an `OperatorAction` on every
  path, including the ones where the model was never reached: agent, model, inputs, output,
  rationale, latency, error. Emergency management runs on being able to say who decided what, when,
  and on what basis, and "the model timed out so a human's default was used" is one of the answers
  that has to be on the record.

A note on the free tier: it runs 20-100 s per call. Nothing here may be awaited while a database
session is open — sqlite is in WAL mode with a five-second busy timeout, and a session held across
that await would block the sweep writing its own rows. Every agent completes first, then opens a
short session to record.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from app import obs

# Imported, not reimplemented — see the module docstring.
from app.orchestrator.reconcile_glm import extract_json_object, is_response_format_rejection

log = logging.getLogger("buddye.agents")

__all__ = [
    "UNATTRIBUTED",
    "AgentCall",
    "AgentClient",
    "ACTION_KINDS",
    "build_client",
    "extract_json_object",
    "is_response_format_rejection",
    "record_action",
]

#: The `kind` values `models.OperatorAction` documents. An agent picks one of these; a new kind is a
#: schema decision, not something an agent invents at runtime.
ACTION_KINDS = frozenset(
    {"dispatch_proposal", "documentation", "correspondence", "triage_note", "situation_brief"}
)

#: Used when an agent is somehow invoked without a hazard. A row filed under a placeholder is worse
#: than a row filed correctly and far better than either a missing audit trail or a raised exception
#: — hazard_id is non-null on the model, and losing the provenance is the outcome we refuse.
UNATTRIBUTED = "unattributed"


@dataclass
class AgentCall:
    """What one completion produced and what it cost. Returned on success and on failure alike."""

    agent: str
    model: str
    data: dict[str, Any] | None = None
    text: str = ""
    latency_ms: int = 0
    json_mode: bool | None = None
    usage: dict[str, Any] | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.data is not None and self.error is None


class AgentClient:
    """OpenAI-compatible chat completion for the operator agents.

    `client` is injectable so tests never reach the network; `build_client` returns None when no key
    is configured, which is what keeps the test suite offline by construction rather than by mock.
    """

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "z-ai/glm-5.3-free",
        base_url: str = "https://api.tokenrouter.com/v1",
        timeout_s: float = 90.0,
        client: Any = None,
    ) -> None:
        self.model = model
        self.base_url = base_url
        self.timeout_s = timeout_s
        if client is not None:
            self.client = client
        else:
            from openai import AsyncOpenAI

            # max_retries=0: the free tier is slow, not flaky in a way a retry fixes, and a retried
            # 90 s call would still be running when the coordinator has moved on.
            self.client = AsyncOpenAI(base_url=base_url, api_key=api_key, timeout=timeout_s, max_retries=0)

    async def _complete(self, messages: list[dict[str, str]], *, json_mode: bool, temperature: float) -> Any:
        kwargs: dict[str, Any] = {"model": self.model, "messages": messages, "temperature": temperature}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        return await self.client.chat.completions.create(**kwargs)

    async def complete_json(
        self,
        *,
        agent: str,
        system: str,
        user: str,
        temperature: float = 0.0,
    ) -> AgentCall:
        """One JSON completion. Never raises; `AgentCall.data` is None whenever anything went wrong."""
        # Defence in depth: the agents redact what they build, and this masks anything they missed.
        # It only removes phone numbers and credentials — the health content is the substance of the
        # decision and cannot be stripped — but a phone number has no bearing on which van to send.
        messages = [
            {"role": "system", "content": str(obs.redact(system))},
            {"role": "user", "content": str(obs.redact(user))},
        ]
        call = AgentCall(agent=agent, model=self.model)
        started = time.monotonic()
        try:
            try:
                resp = await self._complete(messages, json_mode=True, temperature=temperature)
                call.json_mode = True
            except Exception as exc:  # noqa: BLE001
                # A gateway that rejects `response_format` is worth exactly one retry without it. A
                # timeout is not: the retry spends the same 90 s again and returns the same nothing,
                # while a coordinator waits twice as long for a proposal that will not come.
                if not is_response_format_rejection(exc):
                    raise
                log.info("agent.json_mode_unsupported agent=%s model=%s error=%s", agent, self.model, type(exc).__name__)
                resp = await self._complete(messages, json_mode=False, temperature=temperature)
                call.json_mode = False

            call.text = (resp.choices[0].message.content or "") if getattr(resp, "choices", None) else ""
            usage = getattr(resp, "usage", None)
            if usage is not None:
                call.usage = {
                    "prompt_tokens": getattr(usage, "prompt_tokens", None),
                    "completion_tokens": getattr(usage, "completion_tokens", None),
                }
            call.latency_ms = int((time.monotonic() - started) * 1000)
            call.data = extract_json_object(call.text)
            if call.data is None:
                call.error = "unparseable response"
                log.warning("agent.unparseable agent=%s model=%s chars=%d", agent, self.model, len(call.text))
        except Exception as exc:  # noqa: BLE001
            call.latency_ms = int((time.monotonic() - started) * 1000)
            call.error = f"{type(exc).__name__}: {exc}"[:300]
            call.data = None
            log.warning("agent.failed agent=%s model=%s error=%s", agent, self.model, type(exc).__name__)
        return call


def build_client(settings: Any = None) -> AgentClient | None:
    """The shared client, or None when no key is configured.

    None is a first-class answer, not a degraded one: with no key there is no network path an agent
    could take, so every agent runs its deterministic branch. That is how the test suite stays
    offline (conftest sets TOKENROUTER_API_KEY to "") without a single mock.

    Reuses the reconciler's TokenRouter settings rather than adding its own: one key, one gateway,
    one model, and no second place to forget to configure.
    """
    if settings is None:
        from app.config import get_settings

        settings = get_settings()
    key = getattr(settings, "TOKENROUTER_API_KEY", "")
    if not key:
        return None
    return AgentClient(
        api_key=key,
        model=getattr(settings, "RECONCILE_MODEL", "z-ai/glm-5.3-free"),
        base_url=getattr(settings, "TOKENROUTER_BASE_URL", "https://api.tokenrouter.com/v1"),
        timeout_s=getattr(settings, "RECONCILE_TIMEOUT_S", 90.0),
    )


def record_action(
    *,
    hazard_id: str,
    kind: str,
    agent: str,
    model: str = "",
    inputs: dict[str, Any] | None = None,
    output: dict[str, Any] | None = None,
    rationale: str = "",
    latency_ms: int | None = None,
    error: str | None = None,
    incident_id: str | None = None,
    session: Any = None,
) -> str | None:
    """Write the provenance row for one agent decision. Returns its id, or None if even that failed.

    `accepted` and `accepted_by` are deliberately not parameters. An agent never marks its own work
    accepted: that column is how the system knows a human looked at a proposal, and an agent able to
    fill it in would make the human-approval property unverifiable after the fact.

    Pass `session` only if you are *not* holding it across a model await — see the module docstring.
    """
    if kind not in ACTION_KINDS:  # a typo here would make the audit trail unqueryable
        log.warning("agent.unknown_action_kind kind=%s agent=%s", kind, agent)
    row_hazard = hazard_id or UNATTRIBUTED
    if not hazard_id:
        log.warning("agent.action_without_hazard agent=%s kind=%s", agent, kind)

    from app.models import OperatorAction

    action = OperatorAction(
        hazard_id=row_hazard,
        incident_id=incident_id,
        kind=kind,
        agent=agent,
        model=model,
        # Health information about named people lands in these columns; redact() masks the phone
        # numbers and anything credential-shaped and leaves the clinical substance, which is the
        # point of the record.
        inputs=obs.redact(inputs or {}),
        output=obs.redact(output or {}),
        rationale=str(obs.redact(rationale or "")),
        latency_ms=latency_ms,
        error=error,
    )
    try:
        if session is not None:
            session.add(action)
            session.flush()
            return action.id
        from app.db import session_scope

        with session_scope() as s:
            s.add(action)
            s.flush()
            return action.id
    except Exception as exc:  # noqa: BLE001
        # Losing the audit row is bad. Taking a sweep down with it is worse, and unlike the lost row
        # it is unrecoverable: the neighbours after this one never get called.
        log.error("agent.action_not_recorded agent=%s kind=%s error=%s", agent, kind, type(exc).__name__)
        return None
