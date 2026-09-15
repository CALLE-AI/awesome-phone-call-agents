"""Gemini helper — JSON-mode generation for extraction/compression.

Kept tiny and defensive: if no key is configured or a call fails, callers get a
clear signal (``available`` / raised error) rather than a half-broken campaign.
"""

from __future__ import annotations

import json
import os
from typing import Optional

def _model() -> str:
    # Read at call time (not import time) so a .env loaded later still applies.
    return os.environ.get("CORTEX_GEMINI_MODEL", "gemini-flash-lite-latest")


class Gemini:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self._client = None
        if self.api_key:
            try:
                from google import genai

                self._client = genai.Client(api_key=self.api_key)
            except Exception:
                self._client = None

    @property
    def available(self) -> bool:
        return self._client is not None

    def json(self, prompt: str, *, temperature: float = 0.2) -> dict:
        """Generate and parse a JSON object. Raises if unavailable or malformed."""
        if not self.available:
            raise RuntimeError("Gemini not configured (set a valid GEMINI_API_KEY)")
        from google.genai import types

        r = self._client.models.generate_content(
            model=_model(),
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json", temperature=temperature
            ),
        )
        text = (r.text or "").strip()
        return json.loads(text)
