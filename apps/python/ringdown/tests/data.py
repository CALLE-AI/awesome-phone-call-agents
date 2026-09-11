from __future__ import annotations

import json
from pathlib import Path

from ringdown.incident import Contact, Incident, Policy, Rung

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"

ALICE = Contact("a.okafor", "Alice Okafor", "+14155550100", "America/New_York")
BEN = Contact("b.mensah", "Ben Mensah", "+14155550101", "Europe/Lisbon")
CARLA = Contact("c.varga", "Carla Varga", "+14155550102", "Europe/Budapest")

LADDER = (
    Rung("primary", ALICE),
    Rung("secondary", BEN),
    Rung("incident_commander", CARLA),
)

KEY = "rd-test-key-1"

FAST = Policy(per_call_timeout_seconds=0.05, poll_interval_seconds=0.005)


def example_body(name: str) -> dict:
    return json.loads((EXAMPLES / f"{name}.example.json").read_text())


def write_json(directory: Path, name: str, body: dict) -> Path:
    path = directory / name
    path.write_text(json.dumps(body))
    return path


def an_incident(**overrides) -> Incident:
    fields = {
        "id": "inc-2026-08-09-0113",
        "title": "checkout p99 latency above 3s",
        "severity": "sev2",
        "service": "checkout-api",
        "summary": "p99 latency is 3.4s against a 1.2s objective.",
        "runbook_url": "https://runbooks.example.com/checkout-latency",
        "ladder": ("primary", "secondary", "incident_commander"),
        "timezone": "America/Argentina/Buenos_Aires",
        "policy": Policy(),
    }
    return Incident(**{**fields, **overrides})


def raw_incident(**overrides) -> dict:
    fields = {
        "id": "inc-1",
        "title": "checkout p99 latency above 3s",
        "severity": "sev2",
        "service": "checkout-api",
        "summary": "latency is up",
        "timezone": "UTC",
        "ladder": ["primary"],
    }
    return {**fields, **overrides}
