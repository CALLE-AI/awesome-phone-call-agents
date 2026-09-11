"""Seed the four demo banks from CALLE_BUILD.md §8.

Placeholder numbers until the VAPI mock lines exist — update them with the
real VAPI numbers, then re-run (idempotent, keyed on phone).
"""

import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv()

DEMO_BANKS = [
    ("Bank A", "+15550100001", "Has 3 units O neg, confirms cross match, quotes price, collection only"),
    ("Bank B", "+15550100002", "No O neg, offers O pos, offers to check a sister branch"),
    ("Bank C", "+15550100003", "Puts caller on hold, returns with a partial answer"),
    ("Bank D", "+15550100004", "Person who knows is unavailable, asks for a callback in 20 minutes"),
]


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL is not set")
    conn = await asyncpg.connect(dsn=dsn)
    try:
        for name, phone, notes in DEMO_BANKS:
            await conn.execute(
                "insert into banks (name, phone, notes) values ($1, $2, $3)"
                " on conflict (phone) do update set name = excluded.name,"
                " notes = excluded.notes",
                name, phone, notes,
            )
        count = await conn.fetchval("select count(*) from banks")
        print(f"seeded, banks in registry: {count}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
