from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from fake import scenarios
from fake.calle_server import FakeCalleServer, FakeScenario
from ringdown.__main__ import CONFIRMATION, main
from ringdown.audit import GENESIS, sealed
from ringdown.canonical import canonical_json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
EXAMPLES = ROOT / "examples"
OUT = HERE / "out"
EXAMPLE_LEDGER = EXAMPLES / "ledger.example.jsonl"
COMMITTED_EXAMPLE_SCENARIO = 3

ALICE, BEN, CARLA = "+14155550100", "+14155550101", "+14155550102"
FAST_POLICY = {"per_call_timeout_seconds": 5, "poll_interval_seconds": 0.01}

Scenarios = dict[str, FakeScenario]


def _incident_file() -> Path:
    body = json.loads((EXAMPLES / "incident.example.json").read_text())
    body["policy"] = {**body.get("policy", {}), **FAST_POLICY}
    target = OUT / "incident.json"
    target.write_text(json.dumps(body))
    return target


def _run(title: str, blurb: str, by_phone: Scenarios, ledger: Path, incident: Path) -> None:
    print(f"\n{'=' * 96}\n{title}\n{blurb}\n{'=' * 96}\n")
    with FakeCalleServer(by_phone) as server:
        code = main(
            [
                "run",
                "--incident", str(incident),
                "--rotation", str(EXAMPLES / "rotation.example.json"),
                "--ledger", str(ledger),
                "--confirm", CONFIRMATION,
                "--base-url", server.base_url,
                "--mcp-url", server.mcp_url,
            ]
        )
        print(f"exit {code}")
        if server.creates != len(server.created):
            woken = len({record.recipient_phone for record in server.created})
            print(
                f"POST requests sent {server.creates}, calls created {len(server.created)}, "
                f"people woken {woken}"
            )


def tamper(source: Path, target: Path) -> None:
    records = [json.loads(line) for line in source.read_text().splitlines()]
    for record in records:
        if record.get("type") == "verdict":
            record["verdict"] = "acknowledged"
    previous = GENESIS
    lines = []
    for record in records:
        relinked = sealed({**record, "prev": previous})
        previous = relinked["hash"]
        lines.append(canonical_json(relinked))
    target.write_text("\n".join(lines) + "\n")


def _ledger_check(path: Path) -> None:
    shown = os.path.relpath(path)
    print(f"\n$ python -m ringdown verify --ledger {shown}")
    print(f"exit {main(['verify', '--ledger', shown])}")


SCENARIOS: list[tuple[str, str, Scenarios]] = [
    (
        "Scenario 1 - The on-call engineer picks up and commits",
        "The happy path, and the only shape that exits 0.",
        {ALICE: scenarios.answer_ack("Alice Okafor", "alice")},
    ),
    (
        "Scenario 2 - A yes without an ETA is not an acknowledgement",
        "The provider is satisfied. There is no commitment and no clock.",
        {
            ALICE: scenarios.ambiguous_yes("Alice Okafor", "alice"),
            BEN: scenarios.answer_ack("Ben Mensah", "ben", "i can be on it in twenty minutes"),
            CARLA: scenarios.answer_ack("Carla Varga", "carla"),
        },
    ),
    (
        "Scenario 3 - Nobody commits and the ladder runs out",
        "No answer, then an injected voicemail, then a high label carrying a score of 0.05.",
        {
            ALICE: scenarios.no_answer(),
            BEN: scenarios.injected_voicemail("Ben Mensah"),
            CARLA: scenarios.low_confidence("Carla Varga"),
        },
    ),
    (
        "Scenario 4 - The reply to the create is lost and nobody gets woken twice",
        "HTTP 503 after the call already exists. Two POSTs, one call, one phone rang.",
        {ALICE: scenarios.error_after_create("Alice Okafor", "alice")},
    ),
    (
        "Scenario 4b - The replay comes back ambiguous too, so Ringdown stops",
        "Both creates fail without saying whether a call exists.",
        {ALICE: scenarios.error_before_create("Alice Okafor", "alice")},
    ),
    (
        "Scenario 5 - An explicit decline is final",
        "That is an answer, not a failure. Ben and Carla never ring.",
        {ALICE: scenarios.declined("Alice Okafor", "alice")},
    ),
    (
        "Scenario 6 - The recorded verdict does not reconcile on the second channel",
        "The placing channel reports a clean acknowledgement. The second channel does not.",
        {ALICE: scenarios.channel_mismatch("Alice Okafor", "alice")},
    ),
    (
        "Scenario 7 - Asking to be called back later is not taking the incident",
        "Alice asks for more minutes than this ladder has left, so Ben rings now and the "
        "request is recorded with the words that made it. A shorter ask is called back "
        "instead; the demo cannot show that one, because it would have to wait.",
        {
            ALICE: scenarios.asks_for_callback(
                "Alice Okafor", "alice", "i can't right now, call me back in 90 minutes"
            ),
            BEN: scenarios.answer_ack("Ben Mensah", "ben", "i can be on it in twenty minutes"),
        },
    ),
    (
        "Scenario 8 - The engineer answers in Spanish",
        "Same ladder, same ledger, same two transports. The commitment, the name and the "
        "minutes are quoted in the words they were spoken in. A hedge in Spanish is still "
        "not an acknowledgement, so Alice's 'creo que lo tomo yo' hands the incident to Ben.",
        {
            ALICE: scenarios.hedged_yes_es("Alice Okafor", "alice"),
            BEN: scenarios.answer_ack_es("Ben Mensah", "ben", "dame veinte minutos"),
        },
    ),
    (
        "Scenario 9 - The provider ends every call before it rings",
        "Four of the six calls placed against the live API on 2026-08-20 ended in the second "
        "they started, with nothing transcribed, reported as the recipient hanging up. The "
        "carrier that owns the destination number had no record of any of them. This is that "
        "shape: the ladder is exhausted without a single telephone ringing, and it says so.",
        {
            ALICE: scenarios.dropped_before_ringing(),
            BEN: scenarios.dropped_before_ringing(),
            CARLA: scenarios.dropped_before_ringing(),
        },
    ),
]


def demo() -> None:
    os.environ["RINGDOWN_FAKE_API_KEY"] = "demo-local-only"
    os.environ["RINGDOWN_FAKE_MCP_TOKEN"] = "demo-local-only"
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    EXAMPLE_LEDGER.unlink(missing_ok=True)
    incident = _incident_file()
    for number, (title, blurb, by_phone) in enumerate(SCENARIOS, 1):
        ledger = EXAMPLE_LEDGER if number == COMMITTED_EXAMPLE_SCENARIO else OUT / f"run-{number}.jsonl"
        _run(title, blurb, by_phone, ledger, incident)
    print(f"\n{'=' * 96}\nThe ledger check the demo runs last\n{'=' * 96}")
    _ledger_check(EXAMPLE_LEDGER)
    tamper(EXAMPLE_LEDGER, OUT / "tampered.jsonl")
    _ledger_check(OUT / "tampered.jsonl")


if __name__ == "__main__":
    demo()
