from __future__ import annotations

from typing import Protocol

from redis import Redis
from rq import Queue, Retry

from .processing import Processor
from .settings import Settings


class Dispatcher(Protocol):
    def dispatch(self, analysis_id: str) -> None: ...


class InlineDispatcher:
    def __init__(self, processor: Processor):
        self.processor = processor

    def dispatch(self, analysis_id: str) -> None:
        self.processor.process(analysis_id)


class RQDispatcher:
    def __init__(
        self,
        settings: Settings,
        connection: Redis | None = None,
    ):
        if not settings.redis_url and connection is None:
            raise ValueError("REDIS_URL is required when CALL_ANALYZER_QUEUE_MODE=rq")
        self.queue = Queue(
            settings.queue_name,
            connection=connection or Redis.from_url(settings.redis_url),
        )

    def dispatch(self, analysis_id: str) -> None:
        self.queue.enqueue(
            "call_analyzer.tasks.process_analysis",
            analysis_id,
            job_id=f"analysis-{analysis_id}",
            job_timeout=120,
            retry=Retry(max=3, interval=[10, 30, 60]),
        )


def build_dispatcher(settings: Settings, processor: Processor) -> Dispatcher:
    if settings.queue_mode == "inline":
        return InlineDispatcher(processor)
    if settings.queue_mode == "rq":
        return RQDispatcher(settings)
    raise ValueError(f"unsupported queue mode: {settings.queue_mode}")

