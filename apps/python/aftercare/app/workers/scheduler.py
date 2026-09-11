from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.config import settings
from app.db import SessionLocal
from app.repositories.call_repository import CallRepository
from app.repositories.followup_repository import FollowUpRepository
from app.repositories.patient_repository import PatientRepository
from app.repositories.protocol_repository import ProtocolRepository
from app.services.call_service import CallService
from app.services.protocol_service import ProtocolService
from apscheduler.schedulers.background import BackgroundScheduler

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


def process_due_followups() -> None:
    logger.info("Scheduler tick: processing due follow-ups")
    db = SessionLocal()
    try:
        service = CallService(
            PatientRepository(db),
            FollowUpRepository(db),
            CallRepository(db),
            ProtocolService(ProtocolRepository(db)),
        )
        logger.info(
            "Scheduler places dry-run follow-ups only; live calls require "
            "POST /calls/trigger with authorized_destination"
        )
        service.process_due_followups(dry_run=True)
    except Exception:
        logger.exception("Scheduler failed while processing due follow-ups")
    finally:
        db.close()


def start_scheduler() -> None:
    if scheduler.running:
        return
    interval = max(1, settings.scheduler_interval_minutes)
    scheduler.add_job(
        process_due_followups,
        trigger="interval",
        minutes=interval,
        id="due_followups",
        replace_existing=True,
        next_run_time=datetime.now(timezone.utc),
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info(
        "APScheduler started (due follow-ups every %s minute(s))",
        interval,
    )


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped")
