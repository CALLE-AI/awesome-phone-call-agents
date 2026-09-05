"""The order model and a JSON-backed store.

The shape mirrors what a WooCommerce REST payload gives you, so swapping the
JSON file for a live store is a matter of replacing `load` and `save`.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Iterable

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SEED_FILE = DATA_DIR / "orders.seed.json"
DATA_FILE = DATA_DIR / "orders.json"

# Statuses this agent writes back to the store.
PENDING = "pending-confirmation"
CONFIRMED = "confirmed"
CANCELLED = "cancelled-by-customer"
NEEDS_HUMAN = "needs-human"


@dataclass
class Order:
    id: str
    customer_name: str
    phone: str
    address: str
    items: list[str]
    total: float
    shipping_cost: float = 70.0
    """Courier fee one way. Bulky goods cost more to send and more to return."""

    previous_orders: int = 0
    """Orders this phone number has taken delivery of before."""

    previous_refusals: int = 0
    """Deliveries this phone number has refused at the door before."""

    outside_home_city: bool = False
    """Outside the shop's own city, where routes are longer and refusals rise."""

    status: str = PENDING
    attempts: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def item_summary(self) -> str:
        return ", ".join(self.items)

    def log(self, note: str) -> None:
        self.notes.append(note)


def load(path: Path = DATA_FILE) -> list[Order]:
    """Load the working order book, seeding it on first run."""
    if not path.exists():
        reset(path)
    raw: list[dict[str, Any]] = json.loads(path.read_text(encoding="utf-8"))
    return [Order(**row) for row in raw]


def reset(path: Path = DATA_FILE) -> None:
    """Restore the demo order book, so the run can be shown again."""
    path.write_text(SEED_FILE.read_text(encoding="utf-8"), encoding="utf-8")


def save(orders: Iterable[Order], path: Path = DATA_FILE) -> None:
    rows = [asdict(order) for order in orders]
    path.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")


def pending(orders: Iterable[Order]) -> list[Order]:
    """Orders still awaiting a decision. See `economics.rank` for call order."""
    return [o for o in orders if o.status == PENDING]
