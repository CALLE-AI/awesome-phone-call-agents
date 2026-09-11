"""Engine settings. The engine is stateless and only ever needs a Gemini key — it
never sees CALLE_API_KEY or Supabase credentials, since it never dispatches calls or
persists anything (see engine/README.md)."""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    gemini_api_key: str | None = os.getenv("GEMINI_API_KEY")
    gemini_model: str = os.getenv("GEMINI_MODEL") or "gemini-3.6-flash"
    shared_secret: str | None = os.getenv("ENGINE_SHARED_SECRET")


settings = Settings()
