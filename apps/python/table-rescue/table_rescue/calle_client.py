"""CALL-E clients: fixture dry-run client and live MCP Streamable HTTP client."""
import asyncio
import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Protocol

from .models import CallOutcome, CallStatus
from .stores import read_jsonl

DEFAULT_BASE_URL = "https://seleven-mcp-sg.airudder.com"
DEFAULT_CHANNEL = "openagent_oauth"
DEFAULT_CACHE_ROOT = "~/.calle-mcp/cli"
INTEGRATION_HEADER = "apps/python/table-rescue/0.0.0"
TERMINAL_STATUSES = {
    "BUSY",
    "CANCELED",
    "CANCELLED",
    "COMPLETED",
    "DECLINED",
    "EXPIRED",
    "FAILED",
    "NO_ANSWER",
    "VOICEMAIL",
}
OUTCOME_RE = re.compile(r"\bOUTCOME:\s*([A-Z_]+)\b", re.IGNORECASE)

# Last-resort keyword hints when the agent omits the OUTCOME token. Order matters:
# negative/definitive verbs are checked before the affirmative "confirm".
KEYWORD_FALLBACKS: tuple[tuple[str, CallStatus], ...] = (
    ("cancel", CallStatus.CANCELLED),
    ("reschedul", CallStatus.RESCHEDULED),
    ("accept", CallStatus.ACCEPTED),
    ("declin", CallStatus.DECLINED),
    ("confirm", CallStatus.CONFIRMED),
)

CONFIRM_GOAL = (
    "You are calling {name} about their restaurant reservation for a party of "
    "{party_size} at {slot}. Ask whether they will keep the booking, cancel it, or move "
    "it to another time; if they want another time, agree on a new slot. End the call by "
    "stating exactly one of: OUTCOME: CONFIRMED, OUTCOME: CANCELLED, OUTCOME: RESCHEDULED, "
    "or OUTCOME: NO_ANSWER."
)

OFFER_GOAL = (
    "You are calling {name} from a restaurant waitlist. A table for a party of "
    "{party_size} just became available at {slot}. Ask whether they accept the table. "
    "End the call by stating exactly one of: OUTCOME: ACCEPTED, OUTCOME: DECLINED, or "
    "OUTCOME: NO_ANSWER."
)


@dataclass(frozen=True)
class CallRequest:
    run_id: str
    target_id: str
    phone: str
    goal: str


class CallClient(Protocol):
    def place_call(self, request: CallRequest) -> CallOutcome: ...


def build_confirm_goal(name: str, party_size: int, slot: str) -> str:
    return CONFIRM_GOAL.format(name=name, party_size=party_size, slot=slot)


def build_offer_goal(name: str, party_size: int, slot: str) -> str:
    return OFFER_GOAL.format(name=name, party_size=party_size, slot=slot)


def parse_outcome(summary: str | None) -> CallStatus | None:
    """Parse the OUTCOME token; fall back to keyword hints before giving up."""
    if not summary:
        return None
    match = OUTCOME_RE.search(summary)
    if match:
        try:
            return CallStatus(match.group(1).upper())
        except ValueError:
            pass
    lowered = summary.lower()
    for keyword, status in KEYWORD_FALLBACKS:
        if keyword in lowered:
            return status
    return None


def map_terminal_status(status: str, summary: str | None) -> CallStatus:
    if status == "COMPLETED":
        return parse_outcome(summary) or CallStatus.ERROR
    if status in {"NO_ANSWER", "BUSY", "VOICEMAIL"}:
        return CallStatus.NO_ANSWER
    if status == "DECLINED":
        return CallStatus.DECLINED
    return CallStatus.ERROR


def compact_summary(summary: Any) -> str | None:
    if not summary:
        return None
    return " ".join(str(summary).split())[:200]


class DryRunClient:
    """Returns fixture outcomes keyed by target_id; never touches the network."""

    def __init__(self, fixture_path: str | Path):
        self._outcomes = {row["target_id"]: row for row in read_jsonl(fixture_path)}
        self._default = self._outcomes.get("DEFAULT")

    def place_call(self, request: CallRequest) -> CallOutcome:
        payload = self._outcomes.get(request.target_id, self._default)
        if payload is None:
            raise KeyError(
                f"no dry-run fixture for target {request.target_id} and no DEFAULT row"
            )
        return CallOutcome.from_payload(request.run_id, request.target_id, payload)


class McpCallClient:
    """Places real calls through CALL-E MCP Streamable HTTP.

    The calle CLI owns login and the token cache (same pattern as
    apps/python/batch-runner): plan_call -> run_call -> get_call_run polling.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        channel: str = DEFAULT_CHANNEL,
        cache_root: str = DEFAULT_CACHE_ROOT,
        calle_command: str = "calle",
        region: str | None = None,
        language: str | None = None,
        poll_interval_seconds: float = 10.0,
        poll_timeout_seconds: float = 900.0,
        client_factory: Callable[[], Any] | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.channel = channel
        self.server_url = f"{self.base_url}/mcp/{channel.strip().lower() or DEFAULT_CHANNEL}"
        self.cache_root = cache_root
        self.calle_command = calle_command
        self.region = region
        self.language = language
        self.poll_interval_seconds = poll_interval_seconds
        self.poll_timeout_seconds = poll_timeout_seconds
        self._client_factory = client_factory

    def _run_calle_json(self, args: list[str]) -> dict[str, Any]:
        command = [
            *self.calle_command.split(),
            *args,
            "--base-url",
            self.base_url,
            "--channel",
            self.channel,
            "--server-url",
            self.server_url,
            "--cache-root",
            str(Path(self.cache_root).expanduser()),
            "--json",
        ]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise RuntimeError(f"calle command failed: {' '.join(command)}\n{detail}")
        parsed = json.loads(completed.stdout)
        if not isinstance(parsed, dict):
            raise RuntimeError("calle command did not return a JSON object")
        return parsed

    def ensure_access_token(self) -> str:
        status = self._run_calle_json(["auth", "status"])
        if not status.get("usable"):
            raise RuntimeError(
                "CALL-E CLI is not logged in. Run: "
                f"{self.calle_command} auth login --base-url {self.base_url} "
                f"--channel {self.channel} --server-url {self.server_url} "
                f"--cache-root {self.cache_root}"
            )
        cache_path = status.get("cache_path") or self._fallback_cache_path()
        document = json.loads(Path(cache_path).expanduser().read_text(encoding="utf-8"))
        access_token = (document.get("token") or {}).get("access_token")
        if not access_token:
            raise RuntimeError(f"token cache at {cache_path} has no access token")
        return access_token

    def _fallback_cache_path(self) -> str:
        digest = hashlib.md5(self.server_url.encode("utf-8")).hexdigest()
        return str(Path(self.cache_root).expanduser() / digest / "token.json")

    def place_call(self, request: CallRequest) -> CallOutcome:
        return asyncio.run(self._execute(request))

    async def _execute(self, request: CallRequest) -> CallOutcome:
        token = self.ensure_access_token()
        factory = self._client_factory or self._default_factory(token)
        arguments: dict[str, Any] = {"to_phones": [request.phone], "goal": request.goal}
        if self.region:
            arguments["region"] = self.region
        if self.language:
            arguments["language"] = self.language
        async with factory() as client:
            plan = await self._call_tool(client, "plan_call", arguments)
            plan_id = plan.get("plan_id")
            confirm_token = plan.get("confirm_token")
            if not plan.get("ready_to_run") or not plan_id or not confirm_token:
                raise RuntimeError(f"plan_call not ready for target {request.target_id}")
            run = await self._call_tool(
                client, "run_call", {"plan_id": plan_id, "confirm_token": confirm_token}
            )
            call_run_id = run.get("run_id")
            if not call_run_id:
                raise RuntimeError(
                    f"run_call returned no run_id for target {request.target_id}"
                )
            return await self._poll(client, request, call_run_id)

    def _default_factory(self, token: str) -> Callable[[], Any]:
        def build():
            from fastmcp import Client
            from fastmcp.client.transports import StreamableHttpTransport

            headers = {
                "Authorization": f"Bearer {token}",
                "X-Call-E-Integration": INTEGRATION_HEADER,
            }
            return Client(StreamableHttpTransport(self.server_url, headers=headers))

        return build

    async def _call_tool(
        self, client: Any, name: str, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        result = await client.call_tool(name=name, arguments=arguments)
        structured = getattr(result, "structured_content", None)
        if isinstance(structured, dict):
            return structured
        structured = getattr(result, "structuredContent", None)
        if isinstance(structured, dict):
            return structured
        raise RuntimeError(f"{name} returned no structured content")

    async def _poll(
        self, client: Any, request: CallRequest, call_run_id: str
    ) -> CallOutcome:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.poll_timeout_seconds
        while True:
            payload = await self._call_tool(client, "get_call_run", {"run_id": call_run_id})
            status = str(payload.get("status") or "").upper()
            if status in TERMINAL_STATUSES:
                summary = payload.get("post_summary")
                return CallOutcome(
                    run_id=request.run_id,
                    target_id=request.target_id,
                    status=map_terminal_status(status, summary),
                    new_slot=None,
                    notes=compact_summary(summary),
                    transcript_ref=call_run_id,
                    call_cost_id=call_run_id,
                )
            if loop.time() >= deadline:
                raise TimeoutError(
                    f"call {call_run_id} for target {request.target_id} did not finish in time"
                )
            await asyncio.sleep(self.poll_interval_seconds)
