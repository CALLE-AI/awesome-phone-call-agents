"""Persist one authorized call and apply its verified outcome to a local record."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from create_call import (
    CALL_STATUSES,
    E164,
    SAFE_PROVIDER_TOKEN,
    WORKFLOW_ID,
    build_call_request,
    default_client_factory,
    default_resolver,
    idempotency_key,
    is_public_https_webhook_url,
    mask_phone,
)
from outcomes import ACTIONS, application_outcome
from receiver import CalleAPIError, CalleConnectionError, CalleTimeoutError

SCHEMA = """
CREATE TABLE IF NOT EXISTS workflows (
  workflow_id TEXT PRIMARY KEY,
  request_json TEXT NOT NULL,
  not_before TEXT NOT NULL,
  not_after TEXT NOT NULL,
  state TEXT NOT NULL,
  call_id TEXT UNIQUE,
  outcome TEXT,
  business_state TEXT NOT NULL DEFAULT 'pending',
  applied_at TEXT
)
"""
BUSINESS_STATES = {
    "booked": "reported_booked",
    "declined": "reported_declined",
    "callback": "needs_follow_up",
    "unanswered": "needs_review",
    "unknown": "needs_review",
}


class WorkflowError(ValueError):
    """An operator-facing stop message that contains no raw API response."""


def timestamp(value):
    instant = datetime.fromisoformat(value)
    if instant.tzinfo is None:
        raise WorkflowError("Use a timestamp with an explicit UTC offset.")
    return instant.astimezone(UTC)


@contextmanager
def connect(path):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        pass
    else:
        os.close(descriptor)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            connection.execute(SCHEMA)
            yield connection
    finally:
        connection.close()


def load(connection, workflow_id):
    row = connection.execute(
        "SELECT * FROM workflows WHERE workflow_id = ?", (workflow_id,)
    ).fetchone()
    if row is None:
        raise WorkflowError("No saved workflow. Reserve the authorized intent first.")
    return dict(row)


def reserve(
    database, workflow_id, phone, task, not_before, not_after, webhook_url=None
):
    if not WORKFLOW_ID.fullmatch(workflow_id) or not E164.fullmatch(phone):
        raise WorkflowError(
            "Use a safe workflow ID and an authorized E.164 phone number."
        )
    if not task.strip() or timestamp(not_before) >= timestamp(not_after):
        raise WorkflowError(
            "Provide a task and a calling window whose end follows its start."
        )
    if webhook_url and not is_public_https_webhook_url(webhook_url):
        raise WorkflowError("Use a public HTTPS /calle/webhook URL.")
    schema = json.loads(Path(__file__).with_name("outcome-schema.json").read_text())
    request = build_call_request(phone, webhook_url or "", workflow_id)
    if not webhook_url:
        del request["webhook_url"]
    request.update(
        task=task,
        result_schema=schema,
        idempotency_key=idempotency_key(
            workflow_id, phone, task=task, result_schema=schema
        ),
    )
    with connect(database) as connection:
        connection.execute(
            "INSERT INTO workflows (workflow_id, request_json, not_before, not_after, state) "
            "VALUES (?, ?, ?, ?, 'reserved')",
            (workflow_id, json.dumps(request), not_before, not_after),
        )
    return {"workflow_id": workflow_id, "state": "reserved", "phone": mask_phone(phone)}


def submit(database, workflow_id, client, *, recover_unknown=False):
    with connect(database) as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = load(connection, workflow_id)
        if row["call_id"]:
            return row
        if row["state"] not in {"reserved", "submission_unknown"}:
            raise WorkflowError("This workflow cannot be submitted.")
        if row["state"] == "submission_unknown" and not recover_unknown:
            raise WorkflowError(
                "Acceptance is unknown. Review it before using --recover-unknown."
            )
        now = datetime.now(UTC)
        if not timestamp(row["not_before"]) <= now < timestamp(row["not_after"]):
            raise WorkflowError(
                "Outside the saved calling window. Do not replace an uncertain call."
            )
        request = json.loads(row["request_json"])
        webhook = request.get("webhook_url")
        if webhook and not is_public_https_webhook_url(
            webhook, resolver=default_resolver
        ):
            raise WorkflowError(
                "The webhook URL must resolve only to public addresses."
            )
        # Commit before the network request, including when its response is lost.
        connection.execute(
            "UPDATE workflows SET state = 'submission_unknown' WHERE workflow_id = ?",
            (workflow_id,),
        )
    created = client.calls.create(**request)
    call_id = created.get("id") if isinstance(created, dict) else None
    status = created.get("status") if isinstance(created, dict) else None
    if (
        not isinstance(call_id, str)
        or not SAFE_PROVIDER_TOKEN.fullmatch(call_id)
        or status not in CALL_STATUSES
    ):
        raise WorkflowError(
            "Create response unavailable. Keep the saved request and key."
        )
    with connect(database) as connection:
        connection.execute("BEGIN IMMEDIATE")
        current = load(connection, workflow_id)
        if current["call_id"] and current["call_id"] != call_id:
            raise WorkflowError(
                "Conflicting Call ID. Stop and reconcile this workflow."
            )
        if not current["call_id"]:
            connection.execute(
                "UPDATE workflows SET call_id = ?, state = 'accepted' WHERE workflow_id = ?",
                (call_id, workflow_id),
            )
        return load(connection, workflow_id)


def resume(database, workflow_id, client):
    with connect(database) as connection:
        row = load(connection, workflow_id)
    if row["state"] == "applied":
        return row
    if not row["call_id"]:
        raise WorkflowError(
            "No saved Call ID. Inspect the submission state; resume never creates calls."
        )
    snapshot = client.calls.get(row["call_id"])
    request = json.loads(row["request_json"])
    if not isinstance(snapshot, dict):
        raise TypeError("Invalid call response.")
    metadata = snapshot.get("metadata")
    recipients = snapshot.get("recipients")
    if (
        snapshot.get("id") != row["call_id"]
        or not isinstance(metadata, dict)
        or metadata.get("workflow") != request["metadata"]["workflow"]
        or metadata.get("workflow_id") != workflow_id
        or not isinstance(recipients, list)
        or len(recipients) != 1
        or not isinstance(recipients[0], dict)
        or recipients[0].get("phones") != [request["recipient"]["phone"]]
    ):
        raise WorkflowError(
            "Call ID, workflow or destination does not match the saved intent."
        )
    status = snapshot.get("status")
    if status not in CALL_STATUSES:
        raise WorkflowError("Unknown call status; no business update made.")
    if status in {"queued", "in_progress"}:
        return row
    outcome = application_outcome(snapshot)
    with connect(database) as connection:
        # This single transaction is the entire application-side effect.
        connection.execute(
            "UPDATE workflows SET state = 'applied', outcome = ?, business_state = ?, "
            "applied_at = ? WHERE workflow_id = ? AND call_id = ? AND state = 'accepted'",
            (
                outcome,
                BUSINESS_STATES[outcome],
                datetime.now(UTC).isoformat(),
                workflow_id,
                row["call_id"],
            ),
        )
        return load(connection, workflow_id)


def cancel(database, workflow_id):
    with connect(database) as connection:
        cursor = connection.execute(
            "UPDATE workflows SET state = 'canceled' WHERE workflow_id = ? AND state = 'reserved'",
            (workflow_id,),
        )
        if cursor.rowcount != 1:
            raise WorkflowError(
                "Only an unsubmitted reservation can be canceled locally."
            )
        return load(connection, workflow_id)


def summary(row):
    result = {
        key: row.get(key)
        for key in (
            "workflow_id",
            "state",
            "call_id",
            "outcome",
            "business_state",
            "applied_at",
        )
    }
    if row.get("outcome"):
        result["next_action"] = ACTIONS[row["outcome"]]
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action", choices=["reserve", "submit", "resume", "cancel", "show"]
    )
    parser.add_argument("--database", type=Path, default=Path("data/workflows.sqlite3"))
    parser.add_argument("--workflow-id", required=True)
    parser.add_argument("--phone")
    parser.add_argument("--task-file", type=Path)
    parser.add_argument("--not-before")
    parser.add_argument("--not-after")
    parser.add_argument("--webhook-url")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-authorized-recipient", action="store_true")
    parser.add_argument("--recover-unknown", action="store_true")
    args = parser.parse_args(argv)
    if args.action == "reserve":
        if not all((args.phone, args.task_file, args.not_before, args.not_after)):
            parser.error(
                "reserve requires --phone, --task-file, --not-before and --not-after."
            )
    elif any(
        (args.phone, args.task_file, args.not_before, args.not_after, args.webhook_url)
    ):
        parser.error(
            "Use saved inputs; reservation options are only accepted by reserve."
        )
    if args.action != "submit" and any(
        (args.execute, args.confirm_authorized_recipient, args.recover_unknown)
    ):
        parser.error("Submission flags are only accepted by submit.")
    try:
        if args.action == "reserve":
            result = reserve(
                args.database,
                args.workflow_id,
                args.phone,
                args.task_file.read_text(encoding="utf-8"),
                args.not_before,
                args.not_after,
                args.webhook_url,
            )
        elif args.action == "cancel":
            result = summary(cancel(args.database, args.workflow_id))
        elif args.action == "show" or (args.action == "submit" and not args.execute):
            with connect(args.database) as connection:
                row = load(connection, args.workflow_id)
            result = summary(row)
            if args.action == "submit":
                result["preview"] = True
                result["phone"] = mask_phone(
                    json.loads(row["request_json"])["recipient"]["phone"]
                )
        else:
            if args.action == "submit" and not args.confirm_authorized_recipient:
                parser.error("--execute requires --confirm-authorized-recipient.")
            if not os.environ.get("CALLE_API_KEY"):
                parser.error("Set CALLE_API_KEY for live submit or resume.")
            with default_client_factory(api_key=os.environ["CALLE_API_KEY"]) as client:
                result = summary(
                    submit(
                        args.database,
                        args.workflow_id,
                        client,
                        recover_unknown=args.recover_unknown,
                    )
                    if args.action == "submit"
                    else resume(args.database, args.workflow_id, client)
                )
        print(json.dumps(result))
        return 0
    except WorkflowError as error:
        print(json.dumps({"error": "workflow_stopped", "message": str(error)}))
    except CalleAPIError as error:
        print(
            json.dumps(
                {"error": "api_request_failed", "http_status": error.status_code}
            )
        )
    except (CalleConnectionError, CalleTimeoutError):
        print(json.dumps({"error": "api_response_unavailable"}))
    except (OSError, ValueError, TypeError, sqlite3.Error):
        print(json.dumps({"error": "workflow_stopped", "action": args.action}))
    print(
        "Stopped. Inspect the saved state; no automatic retry or follow-up call was made."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
