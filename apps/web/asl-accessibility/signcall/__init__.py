"""signcall: an ASL accessibility layer over CALL-E.

Credentials are loaded here, at the package root, so every entry point (the API
server, the test harness, a bare import) sees the same environment. The path
is explicit because the package is run from the directory above signcall/,
not from signcall/ where .env lives.
"""

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")
