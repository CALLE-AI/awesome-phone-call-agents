from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Callable
from uuid import UUID

import httpx

from .evaluator import DeterministicEvaluator
from .repository import Repository
from .schemas import AnalysisRequest, AnalysisResult
from .settings import Settings
from .webhooks import deliver


WebhookDelivery = Callable[[str, dict, str], httpx.Response]


class Processor:
    def __init__(
        self,
        settings: Settings,
        repository: Repository | None = None,
        evaluator: DeterministicEvaluator | None = None,
        webhook_delivery: WebhookDelivery = deliver,
    ):
        self.settings = settings
        self.repository = repository or Repository(settings.database_path)
        self.evaluator = evaluator or DeterministicEvaluator()
        self.webhook_delivery = webhook_delivery

    def process(self, analysis_id: str) -> None:
        if not self.repository.transition(analysis_id, "received", "analyzing") and not self.repository.transition(
            analysis_id, "failed", "analyzing"
        ):
            return

        record = self.repository.get(analysis_id)
        try:
            request = AnalysisRequest.model_validate_json(record["request_json"])
            verdict = self.evaluator.evaluate(request)
            result = AnalysisResult(
                analysis_id=UUID(analysis_id),
                request_id=request.request_id,
                call_id=request.call_id,
                agentkit_run_id=request.agentkit_run_id,
                completed_at=datetime.now(timezone.utc),
                verdict=verdict,
                metrics={"evaluator": "exact-protocol-v2"},
            )
            document = json.loads(result.model_dump_json())
            self.repository.complete(analysis_id, document)
            self._deliver_webhook(analysis_id, str(request.callback.url), document)
        except Exception as error:
            self.repository.fail(analysis_id, str(error))
            raise

    def _deliver_webhook(self, analysis_id: str, url: str, document: dict) -> None:
        if not self.settings.deliver_webhooks:
            return

        try:
            response = self.webhook_delivery(url, document, self.settings.webhook_secret)
            response.raise_for_status()
            self.repository.record_webhook(analysis_id, True, f"HTTP {response.status_code}")
        except Exception as error:
            # A completed result remains recoverable by GET; delivery can be retried separately.
            self.repository.record_webhook(analysis_id, False, str(error))
