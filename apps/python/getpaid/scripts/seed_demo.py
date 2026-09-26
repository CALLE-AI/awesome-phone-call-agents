"""Seeds a few realistic sample invoices so the app has something to show
immediately, instead of a judge staring at an empty list. Safe to run
repeatedly — it always creates new invoices, never places any calls itself.

Usage:
    python scripts/seed_demo.py
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import storage
from models import CallAttempt, CallStatus, Invoice

SAMPLES = [
    dict(
        freelancer_name="Priya Shah",
        client_name="Bram at Fenwick Studio",
        client_phone="+14155550123",
        invoice_number="INV-0042",
        amount="2,400",
        currency="USD",
        due_date="2026-08-20",
        region="US",
        locale="en-US",
    ),
    dict(
        freelancer_name="Priya Shah",
        client_name="Nadia at Hartline Consulting",
        client_phone="+14155550199",
        invoice_number="INV-0043",
        amount="875",
        currency="USD",
        due_date="2026-08-28",
        region="US",
        locale="en-US",
    ),
    dict(
        freelancer_name="Priya Shah",
        client_name="Tom at Oakridge Interiors",
        client_phone="+442071838750",
        invoice_number="INV-0044",
        amount="1,150",
        currency="GBP",
        due_date="2026-09-01",
        region="GB",
        locale="en-US",
    ),
]

# Seeded pre-disputed so the demo has a guaranteed "disputed" outcome to show
# on camera, instead of hoping fixture mode randomly samples one. No call is
# placed for this invoice — status and the call note are set directly.
DISPUTED_SAMPLE = dict(
    freelancer_name="Priya Shah",
    client_name="Voss at Marigold Design",
    client_phone="+13105550142",
    invoice_number="INV-0045",
    amount="3,200",
    currency="USD",
    due_date="2026-08-25",
    region="US",
    locale="en-US",
)
DISPUTED_NOTE = (
    "Client says the invoiced hours don't match what was agreed, wants to "
    "review scope before paying."
)

# Seeded pre-promised with a promised_date already in the past, so clicking
# "Check for overdue promises" is guaranteed to find and follow up on it,
# instead of relying on a random fixture-mode call happening to land on
# "promised". No call is placed for this invoice — status, promised_date,
# and the call note are set directly, same as the disputed sample above.
OVERDUE_PROMISE_SAMPLE = dict(
    freelancer_name="Priya Shah",
    client_name="Chen at Northside Studio",
    client_phone="+16175550188",
    invoice_number="INV-0046",
    amount="1,800",
    currency="USD",
    due_date="2026-08-22",
    region="US",
    locale="en-US",
)
OVERDUE_PROMISE_DATE = "2026-09-05"
OVERDUE_PROMISE_NOTE = (
    "Client's bookkeeper confirmed the invoice was approved and said "
    "payment would go out by Friday."
)


def seed(verbose: bool = False) -> int:
    """Seeds the sample invoices plus one pre-disputed and one
    pre-promised-and-overdue invoice, and returns how many were created."""
    for sample in SAMPLES:
        inv = Invoice.new(**sample)
        storage.save_invoice(inv)
        if verbose:
            print(f"seeded {inv.client_name} — invoice #{inv.invoice_number}")

    disputed = Invoice.new(**DISPUTED_SAMPLE)
    disputed.status = CallStatus.DISPUTED
    attempt = CallAttempt(
        id=f"{disputed.id}_0",
        invoice_id=disputed.id,
        created_at=datetime.now(timezone.utc).isoformat(),
        mode="fixture",
        status=CallStatus.DISPUTED,
        note=DISPUTED_NOTE,
        calle_call_id=f"fixture_{disputed.id[:8]}",
    )
    disputed.attempts.append(attempt.to_dict())
    disputed.last_attempt_at = attempt.created_at
    storage.save_invoice(disputed)
    if verbose:
        print(f"seeded {disputed.client_name} — invoice #{disputed.invoice_number} (pre-disputed)")

    overdue = Invoice.new(**OVERDUE_PROMISE_SAMPLE)
    overdue.status = CallStatus.PROMISED
    overdue.promised_date = OVERDUE_PROMISE_DATE
    overdue_attempt = CallAttempt(
        id=f"{overdue.id}_0",
        invoice_id=overdue.id,
        created_at=datetime.now(timezone.utc).isoformat(),
        mode="fixture",
        status=CallStatus.PROMISED,
        promised_date=OVERDUE_PROMISE_DATE,
        note=OVERDUE_PROMISE_NOTE,
        calle_call_id=f"fixture_{overdue.id[:8]}",
    )
    overdue.attempts.append(overdue_attempt.to_dict())
    overdue.last_attempt_at = overdue_attempt.created_at
    storage.save_invoice(overdue)
    if verbose:
        print(f"seeded {overdue.client_name} — invoice #{overdue.invoice_number} (pre-promised, overdue)")

    return len(SAMPLES) + 2


if __name__ == "__main__":
    count = seed(verbose=True)
    print(f"\nDone. {count} invoices seeded. Start the app and refresh to see them.")
