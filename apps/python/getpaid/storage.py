"""Tiny JSON-file storage layer.

A real deployment would use a database, but a judge cloning this repo should
be able to run the app with zero setup. Data lives in data/invoices.json and
is safe to delete to reset the demo.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Optional

from models import Invoice, CallAttempt, CallStatus

DATA_DIR = Path(__file__).parent / "data"
DATA_FILE = DATA_DIR / "invoices.json"
_lock = threading.Lock()


def _ensure_store() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    if not DATA_FILE.exists():
        DATA_FILE.write_text("{}")


def _read() -> dict:
    _ensure_store()
    with _lock:
        return json.loads(DATA_FILE.read_text() or "{}")


def _write(data: dict) -> None:
    with _lock:
        DATA_FILE.write_text(json.dumps(data, indent=2, default=str))


def save_invoice(invoice: Invoice) -> None:
    data = _read()
    data[invoice.id] = invoice.to_dict()
    _write(data)


def list_invoices() -> list[dict]:
    data = _read()
    return sorted(data.values(), key=lambda i: i.get("created_at", ""), reverse=True)


def get_invoice(invoice_id: str) -> Optional[dict]:
    return _read().get(invoice_id)


def append_attempt(invoice_id: str, attempt: CallAttempt) -> None:
    data = _read()
    if invoice_id not in data:
        return
    data[invoice_id].setdefault("attempts", []).append(attempt.to_dict())
    _write(data)


def update_invoice_fields(invoice_id: str, **fields) -> None:
    data = _read()
    if invoice_id not in data:
        return
    data[invoice_id].update(fields)
    _write(data)


def reset() -> None:
    _write({})
