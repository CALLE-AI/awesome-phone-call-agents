from __future__ import annotations

from redis import Redis
from rq import Queue, Worker

from .settings import Settings


def main() -> None:
    settings = Settings.from_env()
    if settings.queue_mode != "rq" or not settings.redis_url:
        raise SystemExit("Set CALL_ANALYZER_QUEUE_MODE=rq and REDIS_URL before starting a worker")

    connection = Redis.from_url(settings.redis_url)
    worker = Worker([Queue(settings.queue_name, connection=connection)], connection=connection)
    worker.work(with_scheduler=True)


if __name__ == "__main__":
    main()

