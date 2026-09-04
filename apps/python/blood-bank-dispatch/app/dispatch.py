import asyncio
import logging
import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()

from calle import CalleClient  # noqa: E402
from calle.errors import CalleConnectionError  # noqa: E402

from . import db  # noqa: E402
from .prompt import EXTRACTION_SCHEMA, build_task  # noqa: E402
from .util import mask_phone  # noqa: E402

log = logging.getLogger("bbd.dispatch")

_background_tasks: set[asyncio.Task] = set()
_client: CalleClient | None = None
# Safe by default (contribution repo principle 7): no calls unless you
# explicitly set DRY_RUN=0.
DRY_RUN = os.environ.get("DRY_RUN", "1") == "1"


@dataclass
class CallTarget:
    result_id: object          # call_results row id (uuid)
    name: str
    phone: str                 # E.164
    source: str                # 'registry' | 'adhoc'
    idempotency_key: str
    bank_id: object | None = None
    notes: str | None = None
    save_to_registry: bool = False


def get_client() -> CalleClient:
    global _client
    if _client is None:
        _client = CalleClient(api_key=os.environ["CALLE_API_KEY"])
    return _client


def spawn(run: dict, targets: list[CallTarget]) -> None:
    task = asyncio.create_task(dispatch_run(run, targets))
    _background_tasks.add(task)
    task.add_done_callback(_task_done)


def _task_done(task: asyncio.Task) -> None:
    _background_tasks.discard(task)
    if not task.cancelled() and task.exception():
        log.error("dispatch task crashed: %s", task.exception())


async def dispatch_run(run: dict, targets: list[CallTarget]) -> None:
    concurrency = max(1, int(os.environ.get("CALLE_CONCURRENCY", "2")))
    semaphore = asyncio.Semaphore(concurrency)

    async def one(target: CallTarget, variant: int) -> None:
        async with semaphore:
            await _call_one(run, target, variant)

    await asyncio.gather(*(one(t, i) for i, t in enumerate(targets)))
    try:
        await db.execute(
            "update call_runs set status = 'completed', completed_at = now()"
            " where id = $1",
            run["id"],
        )
    except Exception as exc:
        # All target rows are terminal; only the run status line failed.
        log.error("could not mark run %s completed: %s", run["id"], exc)


async def _call_one(run: dict, target: CallTarget, variant: int = 0) -> None:
    try:
        await db.execute(
            "update call_results set status = 'dialing' where id = $1",
            target.result_id,
        )
        log.info(
            "dispatching %s target %s %s",
            target.source, target.name, mask_phone(target.phone),
        )
        if DRY_RUN:
            # No-call mode: simulate the four mock-line personas so the UI,
            # schema, and persistence can be exercised without spend. The
            # synthetic call is marked dry_run in structured_raw.
            await asyncio.sleep(2 + variant * 1.5)
            call = _dry_run_call(target, variant)
        else:
            client = get_client()
            call = None
            for attempt in range(3):
                try:
                    call = await asyncio.to_thread(
                        client.calls.create,
                        task=build_task(run, target.name, target.notes),
                        recipients=[{"phones": [target.phone]}],
                        result_schema=EXTRACTION_SCHEMA,
                        idempotency_key=target.idempotency_key,
                    )
                    break
                except CalleConnectionError:
                    if attempt == 2:
                        raise
                    await asyncio.sleep(2)
            # Persist the id as soon as it exists so a later crash cannot leave a
            # call we cannot account for.
            await db.execute(
                "update call_results set calle_call_id = $2 where id = $1",
                target.result_id,
                call.get("id"),
            )
            call = await asyncio.to_thread(
                client.calls.wait_for_result,
                str(call["id"]),
                interval_seconds=2.0,
                timeout_seconds=float(os.environ.get("CALLE_CALL_TIMEOUT", "600")),
            )
        await _store_result(target, call)
    except Exception as exc:  # keep the run alive; the row shows the failure
        log.warning("target %s failed: %s", target.name, exc)
        try:
            await db.execute(
                "update call_results set status = 'failed', error = $2 where id = $1",
                target.result_id,
                str(exc)[:2000],
            )
        except Exception:
            # The DB write itself failed; the row stays dialing and shows as
            # stale rather than crashing the rest of the fan-out.
            pass


def _dry_run_call(target: CallTarget, variant: int) -> dict:
    """Simulate the four §8 mock-line personas without placing a call."""
    def turns(*lines):
        return [
            {"offset_seconds": i * 6, "speaker": s, "text": t}
            for i, (s, t) in enumerate(lines)
        ]

    base = {
        "id": f"dryrun_{target.result_id}",
        "object": "call_task",
        "status": "completed",
        "task_completed": True,
        "completion_confidence": {"score": 0.9, "label": "high"},
        "evidence": ["Dry-run simulation; no call was placed."],
        "dry_run": True,
        "recipients": [{
            "id": f"dry_rcpt_{target.result_id}",
            "phones": [target.phone],
            "status": "completed",
            "structured_result": None,
            "attempts": [{
                "id": f"dry_att_{target.result_id}",
                "phone": target.phone,
                "status": "completed",
                "transcript_turns": turns(
                    ("bot", "[dry run] Do you have O negative in stock?"),
                    ("user", "Simulated answer."),
                ),
                "failure_code": None,
            }],
        }],
    }

    if variant % 4 == 0:      # Bank A: has stock, confirms, quotes, will release
        base["structured_result"] = {
            "units_available": 3, "release_policy": "will_release",
            "group_confirmed": "O", "screening_status": "screened_ready",
            "transport_minutes": 25, "cost_per_unit": 2000,
            "contact_person": "June", "callback_requested": "no",
            "alternatives": [],
        }
        base["recipients"][0]["attempts"][0]["transcript_turns"] = turns(
            ("bot", "[dry run] How many units of O negative do you have?"),
            ("user", "We have three units, screened and ready."),
            ("bot", "Will you release them to our facility, and what is the cost per unit?"),
            ("user", "We will release. Two thousand naira per unit. Ask for June."),
        )
    elif variant % 4 == 1:    # Bank B: no stock, offers alternatives
        base["structured_result"] = {
            "units_available": 0, "release_policy": "unknown",
            "group_confirmed": "unknown", "screening_status": "unknown",
            "callback_requested": "no",
            "alternatives": ["O positive, 2 units", "sister branch at Abuja road"],
        }
        base["recipients"][0]["attempts"][0]["transcript_turns"] = turns(
            ("bot", "[dry run] How many units of O negative do you have?"),
            ("user", "None at all. We have O positive, or try our sister branch."),
        )
    elif variant % 4 == 2:    # Bank D: callback requested
        base["structured_result"] = {
            "units_available": 0, "release_policy": "unknown",
            "group_confirmed": "unknown", "screening_status": "unknown",
            "callback_requested": "yes", "alternatives": [],
        }
        base["recipients"][0]["attempts"][0]["transcript_turns"] = turns(
            ("bot", "[dry run] How many units of O negative do you have?"),
            ("user", "The person who knows is not around. Someone will call you back."),
        )
    else:                     # no answer
        base["recipients"][0]["attempts"][0]["failure_code"] = "no_answer"
        base["recipients"][0]["attempts"][0]["transcript_turns"] = turns(
            ("bot", "[dry run] Hello, this is a stock enquiry from a clinic..."),
        )
        base["structured_result"] = {
            "units_available": 0, "release_policy": "unknown",
            "group_confirmed": "unknown", "screening_status": "unknown",
            "callback_requested": "no", "alternatives": [],
        }
    base["recipients"][0]["structured_result"] = None
    return base


def _transcript_text(call: dict) -> str | None:
    parts = []
    for recipient in call.get("recipients") or []:
        for attempt in recipient.get("attempts") or []:
            for turn in attempt.get("transcript_turns") or []:
                offset = turn.get("offset_seconds") or 0
                parts.append(
                    f"[{offset:>4}s] {turn.get('speaker', '?')}: {turn.get('text', '')}"
                )
    return "\n".join(parts) or None


def _detect_row_status(call: dict, structured: dict) -> str:
    if structured.get("callback_requested") == "yes":
        return "callback_requested"
    attempts = [
        attempt
        for recipient in call.get("recipients") or []
        for attempt in (recipient.get("attempts") or [])
    ]
    codes = " ".join(
        str(attempt.get("failure_code") or "") for attempt in attempts
    ).lower()
    if "no_answer" in codes or "no-answer" in codes or "noanswer" in codes:
        return "no_answer"
    return "completed"


async def _store_result(target: CallTarget, call: dict) -> None:
    structured = call.get("structured_result") or {}
    if call.get("status") == "completed":
        row_status = _detect_row_status(call, structured)
        error = None
    else:
        row_status = "failed"
        error = (
            call.get("failure_message")
            or call.get("failure_code")
            or f"call ended with status {call.get('status')}"
        )
    confidence = None
    completion = call.get("completion_confidence")
    if isinstance(completion, dict):
        confidence = completion.get("score")
    # Failure text is rendered on failed cards; scrub the destination from it.
    if error and target.phone:
        error = str(error).replace(target.phone, mask_phone(target.phone))
    log.info("target %s -> %s (confidence %s)", target.name, row_status, confidence)

    await db.execute(
        """
        update call_results set
          status = $2,
          error = $3,
          calle_call_id = $4,
          units_available = $5,
          group_confirmed = $6,
          screening_status = $7,
          release_policy = $8,
          transport_minutes = $9,
          cost_per_unit = $10,
          contact_person = $11,
          callback_requested = $12,
          alternatives = $13::jsonb,
          confidence = $14,
          raw_transcript = $15,
          structured_raw = $16::jsonb
        where id = $1
        """,
        target.result_id,
        row_status,
        error,
        call.get("id"),
        structured.get("units_available"),
        structured.get("group_confirmed"),
        structured.get("screening_status"),
        structured.get("release_policy"),
        structured.get("transport_minutes"),
        structured.get("cost_per_unit"),
        structured.get("contact_person"),
        structured.get("callback_requested") == "yes",
        structured.get("alternatives") or [],
        confidence,
        _transcript_text(call),
        call,
    )

    if target.save_to_registry and row_status == "completed":
        await db.execute(
            "insert into banks (name, phone) values ($1, $2) on conflict (phone) do nothing",
            target.name,
            target.phone,
        )
