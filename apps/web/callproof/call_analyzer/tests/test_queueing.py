from __future__ import annotations

import fakeredis

from call_analyzer.queueing import RQDispatcher
from call_analyzer.settings import Settings


def test_rq_dispatcher_enqueues_stable_retryable_job(tmp_path):
    settings = Settings(
        database_path=str(tmp_path / "test.db"),
        webhook_secret="test-secret",
        deliver_webhooks=False,
        queue_mode="rq",
        redis_url="redis://unused",
        queue_name="callproof-test",
    )
    dispatcher = RQDispatcher(settings, connection=fakeredis.FakeRedis())

    dispatcher.dispatch("9a88073e-d5b8-4204-bf75-ddaf5850fcdc")

    assert dispatcher.queue.count == 1
    job = dispatcher.queue.jobs[0]
    assert job.id == "analysis-9a88073e-d5b8-4204-bf75-ddaf5850fcdc"
    assert job.retries_left == 3
