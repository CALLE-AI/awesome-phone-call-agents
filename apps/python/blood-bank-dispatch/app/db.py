import asyncio
import json
import os

import asyncpg

_pool: asyncpg.Pool | None = None


async def _init_conn(conn: asyncpg.Connection) -> None:
    # Decode json/jsonb to Python objects; otherwise asyncpg returns raw text
    # and the templates join the characters of "[]" instead of skipping it.
    for t in ("json", "jsonb"):
        await conn.set_type_codec(
            t,
            encoder=lambda v: json.dumps(v),
            decoder=json.loads,
            schema="pg_catalog",
        )


async def init() -> None:
    global _pool
    last_error: Exception | None = None
    for _ in range(3):
        try:
            # Small, warm pool: the DB may be remote, and growing the pool on
            # a flaky network is what produced 500s on the polled fragment.
            _pool = await asyncpg.create_pool(
                dsn=os.environ.get("DATABASE_URL"),
                min_size=2,
                max_size=4,
                command_timeout=30,
                init=_init_conn,
            )
            return
        except OSError as exc:
            last_error = exc
            await asyncio.sleep(2)
    raise last_error  # type: ignore[misc]


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("database pool not initialised")
    return _pool


async def fetch(query: str, *args):
    return await pool().fetch(query, *args)


async def fetchrow(query: str, *args):
    return await pool().fetchrow(query, *args)


async def execute(query: str, *args):
    return await pool().execute(query, *args)
