"""Read-only fixture application for the public hackathon demo.

Importing this module never reads a CALL-E credential or opens a network connection. It
seeds the normal fixture workflow, completes the demo provider handoff, then serves the
same operator pages with every mutation disabled on a public host.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .cli import DEFAULT_EVENT, DEFAULT_ROSTER, DEFAULT_SCENARIOS, execute_run, seed_ledger
from .ledger import Ledger
from .preflight import load_event, load_roster_rows, run_preflight
from .support import authorize_provider_call, poll_support_requests
from .transports.fixture import FixtureTransport
from .web.app import create_app


def build_demo_app(db_path: Path | str):
    event, policy = load_event(DEFAULT_EVENT)
    database = Path(db_path)
    database.parent.mkdir(parents=True, exist_ok=True)
    with Ledger(database) as ledger:
        if ledger.get_event(event.event_id) is None:
            now = event.field_visit_cutoff - timedelta(hours=4)
            result = run_preflight(
                event,
                policy,
                load_roster_rows(DEFAULT_ROSTER),
                now=now,
            )
            if not result.ok:
                raise RuntimeError("the bundled public-demo fixture failed preflight")
            transport = FixtureTransport(DEFAULT_SCENARIOS)
            seed_ledger(ledger, result)
            execute_run(
                ledger,
                transport,
                result,
                now=now,
                simulated_clock=True,
                stop_before_cutoff=True,
            )
            requests = ledger.list_support_requests(event.event_id)
            if requests:
                authorize_provider_call(
                    ledger,
                    transport,
                    event,
                    requests[0].request_id,
                    provider_id="demo-equipment",
                    actor="demo-operator",
                    now=datetime.now(timezone.utc),
                )
                poll_support_requests(
                    ledger, transport, event, now=datetime.now(timezone.utc)
                )
    # No transport means no call action and no background dispatcher. Public views are
    # evidence-only; judges can run the local fixture server to exercise the button.
    return create_app(database, event, policy, transport=None, live_mode=False)


app = build_demo_app(os.environ.get("PC_DEMO_DB", "/tmp/positive-contact-demo.db"))
