from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .models import CallRequest, CallResult, CallState, Turn

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "transcripts"


class FakeProvider:
    def __init__(
        self,
        fixtures_dir: Path | None = None,
        route: dict[str, str] | None = None,
    ) -> None:
        self.fixtures_dir = fixtures_dir or FIXTURES
        self.route = route or {}
        self._runs: dict[str, str] = {}

    def place(self, req: CallRequest) -> str:
        run_id = "fake-" + hashlib.sha1(req.idempotency_key.encode()).hexdigest()[:12]
        self._runs[run_id] = self._fixture_for(req.idempotency_key)
        return run_id

    def poll(self, run_id: str) -> CallResult:
        name = self._runs.get(run_id)
        if name is None:
            return CallResult(
                state=CallState.SUBMISSION_UNKNOWN, transcript=[], structured=None
            )
        payload = json.loads((self.fixtures_dir / name).read_text(encoding="utf-8"))
        return CallResult(
            state=CallState(payload["state"]),
            transcript=[Turn(**turn) for turn in payload["turns"]],
            structured=payload.get("structured"),
        )

    def transcript_path(self, run_id: str) -> str:
        return f"fixtures/transcripts/{self._runs[run_id]}"

    def _fixture_for(self, idempotency_key: str) -> str:
        if idempotency_key in self.route:
            return self.route[idempotency_key]
        names = self._names()
        suffix = idempotency_key.rsplit(":", 1)[-1]
        seed = (
            int(suffix)
            if suffix.isdigit()
            else int(hashlib.sha1(suffix.encode()).hexdigest(), 16)
        )
        return names[seed % len(names)]

    def _names(self) -> list[str]:
        names = sorted(p.name for p in self.fixtures_dir.glob("*.json"))
        if not names:
            raise FileNotFoundError(f"No transcript fixtures in {self.fixtures_dir}")
        return names
