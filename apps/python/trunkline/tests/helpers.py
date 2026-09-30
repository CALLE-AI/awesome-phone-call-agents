"""Shared setup: a seeded data directory and a running fake CALL-E."""
from __future__ import annotations

import os
from typing import List, Optional

from trunkline import client as calle_client, demo, engine, vault, workqueue
from trunkline.models import Claim, load_ledger, save_ledger

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES_DIR = os.path.join(APP_DIR, "fixtures")


def seed(data_dir: str) -> None:
    ledger, records = demo.build()
    workqueue.rescore(ledger)
    os.makedirs(data_dir, exist_ok=True)
    save_ledger(data_dir, ledger)
    for patient_ref, values in records.items():
        vault.put(data_dir, patient_ref, values)


def context(data_dir: str, **config) -> engine.Context:
    settings = engine.Config(ignore_window=True)
    for key, value in config.items():
        setattr(settings, key, value)
    return engine.Context(data_dir=data_dir, ledger=load_ledger(data_dir), config=settings,
                          fixtures_dir=FIXTURES_DIR)


def bundle_for(ctx: engine.Context, workflow: str, payer_id: str = "pay_meridian"):
    bundles = workqueue.build_bundles(ctx.ledger, workflow=workflow, payer_id=payer_id)
    assert bundles, "no bundle for %s" % workflow
    return bundles[0]


def run(ctx: engine.Context, bundle, scenario: str, mode: str = engine.MODE_FIXTURE):
    server = calle_client.FakeCalleServer(FIXTURES_DIR).start()
    try:
        return engine.run_bundle(
            ctx, bundle, mode=mode, api_key="test-key", base_url=server.base_url,
            fixture_scenario=scenario, first_poll_delay=0.0, sleep=lambda _s: None,
        )
    finally:
        server.stop()


def every_file_under(root: str, skip_dirs: Optional[List[str]] = None) -> List[str]:
    skip = [os.path.abspath(d) for d in (skip_dirs or [])]
    found: List[str] = []
    for base, _dirs, files in os.walk(root):
        if any(os.path.abspath(base).startswith(item) for item in skip):
            continue
        found.extend(os.path.join(base, name) for name in files)
    return found
