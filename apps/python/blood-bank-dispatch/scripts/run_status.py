"""Show the latest (or a given) run and its call results."""

import asyncio
import os
import sys

import asyncpg
from dotenv import load_dotenv

load_dotenv()


async def main() -> None:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        if len(sys.argv) > 1:
            run = await conn.fetchrow(
                "select * from call_runs where id = $1", sys.argv[1]
            )
        else:
            run = await conn.fetchrow(
                "select * from call_runs order by created_at desc limit 1"
            )
        if run is None:
            print("no runs found")
            return
        print(f"run: {run['id']}  status: {run['status']}  completed: {run['completed_at']}")
        rows = await conn.fetch(
            "select bank_name, status, units_available, release_policy,"
            " callback_requested, confidence, calle_call_id, error"
            " from call_results where run_id = $1 order by created_at",
            run["id"],
        )
        for r in rows:
            print(
                f"  {r['bank_name']:<12} {r['status']:<18} units={r['units_available']}"
                f" release={r['release_policy']} cb={r['callback_requested']}"
                f" conf={r['confidence']} call={r['calle_call_id']} err={r['error']}"
            )
    finally:
        await conn.close()


asyncio.run(main())
