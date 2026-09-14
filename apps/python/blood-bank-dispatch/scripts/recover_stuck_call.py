"""Recover a call_results row stuck in 'dialing'.

Re-creates the call with the row's original idempotency key: if the original
request reached CALL-E this replays the existing call task; if it never
arrived, it places the one intended call. Either way exactly one call task
exists, then the result is stored through the normal path.
"""

import asyncio
import os
import time

from dotenv import load_dotenv

load_dotenv()

from calle.errors import CalleConnectionError  # noqa: E402

from app import db  # noqa: E402
from app.dispatch import CallTarget, _store_result, get_client  # noqa: E402
from app.prompt import EXTRACTION_SCHEMA, build_task  # noqa: E402


async def main() -> None:
    await db.init()
    try:
        row = await db.fetchrow(
            "select * from call_results where status = 'dialing'"
            " order by created_at desc limit 1"
        )
        if row is None:
            print("nothing stuck in dialing")
            return
        run = await db.fetchrow("select * from call_runs where id = $1", row["run_id"])
        target = CallTarget(
            result_id=row["id"],
            name=row["bank_name"],
            phone=row["phone"],
            source=row["source"],
            idempotency_key=row["idempotency_key"],
            bank_id=row["bank_id"],
            notes=None,
        )
        client = get_client()

        call = None
        for attempt in range(3):
            try:
                call = client.calls.create(
                    task=build_task(dict(run), target.name, target.notes),
                    recipients=[{"phones": [target.phone]}],
                    result_schema=EXTRACTION_SCHEMA,
                    idempotency_key=target.idempotency_key,
                )
                break
            except CalleConnectionError:
                print(f"create attempt {attempt + 1} hit a connection error, retrying")
                time.sleep(3)
        if call is None:
            raise SystemExit("could not create or recover the call")

        print("call id:", call["id"], "status:", call.get("status"))
        await db.execute(
            "update call_results set calle_call_id = $2 where id = $1",
            row["id"],
            call["id"],
        )

        deadline = time.monotonic() + 600
        while True:
            try:
                call = client.calls.get(str(call["id"]))
            except CalleConnectionError:
                print("poll connection error, retrying")
                time.sleep(3)
                continue
            if call.get("status") in {"completed", "failed", "canceled"}:
                break
            if time.monotonic() > deadline:
                raise SystemExit("timed out waiting for the call")
            time.sleep(2)

        await _store_result(target, call)
        await db.execute(
            "update call_runs set status = 'completed', completed_at = now()"
            " where id = $1",
            run["id"],
        )
        print("final status:", call.get("status"))
        print("structured_result:", call.get("structured_result"))
    finally:
        await db.close()


asyncio.run(main())
