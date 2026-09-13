import asyncio
import glob as globmod
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv()


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL is not set")
    conn = await asyncpg.connect(dsn=dsn)
    try:
        for path in sorted(globmod.glob("migrations/*.sql")):
            print(f"applying {path}")
            with open(path, "r", encoding="utf-8") as fh:
                await conn.execute(fh.read())
        print("migrations complete")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
