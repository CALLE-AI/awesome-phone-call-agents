"""Command line entry point. Dry run is the default and live needs three keys turned.

    python3 -m warrantyops --list
    python3 -m warrantyops --scenario case_a_useful_resolution
    python3 -m warrantyops --scenario case_a_useful_resolution --approve

Nothing in this module can place a call: it only ever constructs the fake
provider. Synthetic source state is created in memory from the scenario
fixture on every run — there is no pre-seeded database anywhere. ``--approve``
stands in for the human review decision in a local demo; it performs the
write-back that the review gate otherwise withholds.

Live calling is deliberately not wired to a flag, because a flag is the wrong
place for a decision that dials a stranger. The README documents the gates a
live run has to pass and the opt-in Runtime Proof path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .adversarial import (
    ADVERSARIAL_TITLE,
    render_adversarial_page,
    write_adversarial_page,
)
from .adversarial import (
    DEFAULT_OUTPUT as ADVERSARIAL_OUTPUT,
)
from .authorization import AuthorizationBasis, CallAuthorization
from .envelope import source_claim_from_dict
from .ledger import (
    AttemptLedger,
    AttemptLedgerUnavailable,
    InMemoryAttemptLedger,
    SqliteAttemptLedger,
)
from .observability import EventLog
from .proof_screen import (
    DEFAULT_FIXTURE,
    DEFAULT_OUTPUT,
    render_proof_screen,
    write_proof_screen,
)
from .providers.fake import FIXTURE_DIR, FakeCallProvider
from .review import ReviewDecision, ReviewRecord, prepare_review
from .runtime_proof import (
    CONFIRMATION_PHRASE,
    execute_live_call,
    preflight_report,
    probe_auth,
    recover_runtime_result,
)
from .source import InMemorySourceStore
from .workflow import masked_report, run_exception
from .writeback import InMemoryNoteLedger, WriteBackRefusal, write_back

PURPOSE = "warranty claim exception follow-up"

#: Generated documentation lives beside the package, under version control.
DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"


def _synthetic_authorization(recipient_e164: str, now: datetime) -> CallAuthorization:
    return CallAuthorization(
        recipient_e164=recipient_e164,
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose=PURPOSE,
        granted_by="synthetic-fixture-owner",
        granted_at=now - timedelta(days=1),
        expires_at=now + timedelta(days=1),
        record_reference="synthetic://fixture-authorization",
    )


def _scenarios(fixture_dir: Path) -> list[str]:
    return sorted(path.stem for path in fixture_dir.glob("*.json"))


def run_scenario(
    scenario: str,
    fixture_dir: Path,
    approve: bool,
    ledger_db: Path | None = None,
    metrics: bool = False,
) -> dict[str, Any]:
    """Run one synthetic scenario end to end and return the masked report.

    ``metrics`` attaches the structured event log to the run and includes the
    counters and the audit pane in the report. The log is diagnostic only —
    the receipt and proof artifacts never read it, so their byte-determinism
    is identical with or without it.
    """

    provider = FakeCallProvider(scenario=scenario, fixture_dir=fixture_dir)
    fixture = provider.load()
    claim = source_claim_from_dict(fixture["envelope"])
    recipient = fixture["recipient_e164"]

    # Synthetic source state, created from the fixture on this run only.
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)

    # The attempt ledger is required at every provider-capable path. The CLI
    # only ever constructs the fake provider, which cannot dial anything, so
    # the default is the in-memory ledger; --ledger-db points at an explicit
    # user-state SQLite file when a demo wants suppression to survive the
    # process. A live-provider path must construct a durable ledger itself or
    # be refused by the workflow.
    ledger: AttemptLedger
    if ledger_db is not None:
        ledger = SqliteAttemptLedger(ledger_db)
        ledger_description = str(ledger_db)
    else:
        ledger = InMemoryAttemptLedger()
        ledger_description = "in-memory (fake provider only)"

    events = EventLog(sink=lambda _line: None) if metrics else None
    now = datetime.now(timezone.utc)
    authorization = _synthetic_authorization(recipient, now)
    run = run_exception(
        claim,
        authorization,
        provider,
        version_reader=store,
        attempt_ledger=ledger,
        now=now,
        allowlist=frozenset({recipient}),
        events=events,
    )

    report = masked_report(run, recipient)
    report["provider"] = provider.name
    report["real_calls_placed"] = provider.calls_placed
    report["provider_replays"] = provider.replays
    report["attempt_ledger"] = ledger_description
    if events is not None:
        report["metrics"] = events.metrics()
        report["audit_pane"] = events.pane()

    if run.refusal is not None:
        report["write_back"] = "NONE"
        return report

    outcome = run.outcome
    if outcome is None:
        # CaseRun is exclusive: no refusal means an outcome exists.
        raise ValueError("run carries neither a refusal nor an outcome")
    packet = prepare_review(outcome, recipient)
    report["review"] = packet.to_dict()

    if not approve:
        report["write_back"] = "WITHHELD_PENDING_REVIEW"
        return report

    # The scenario fixture may move the source record between the call and
    # the write-back, which is exactly the change the write-back must refuse.
    source_change = fixture.get("source_change") or {}
    if source_change.get("before_writeback_version"):
        store.set_version(
            claim.source_platform,
            claim.source_claim_id,
            source_change["before_writeback_version"],
        )

    decision = ReviewRecord(
        decision=ReviewDecision.APPROVE,
        reviewer="cli-operator",
        decided_at=now,
        review_id=packet.review_id,
        packet_sha256=packet.packet_sha256,
        operator_id="cli-operator",
    )
    result = write_back(
        claim,
        store,
        InMemoryNoteLedger(),
        packet,
        decision,
        outcome,
        idempotency_key=run.idempotency_key or "",
        evidence_pointer=outcome.transport.call_id,
        written_at=now,
    )
    report["write_back"] = (
        result.value if isinstance(result, WriteBackRefusal) else result.to_dict()
    )
    return report


def _serve_review(
    scenario: str,
    fixture_dir: Path,
    *,
    host: str = "127.0.0.1",
    port: int = 0,
) -> int:
    """Run one synthetic scenario, then serve its review on loopback.

    The operator opens the printed URL, reads the same page the renderer
    produces for the static proof, and decides. Approve goes through the
    kernel's own write-back (source re-read, idempotent note); Refuse and
    Return record a safe non-write. The transcript is jailed in a private
    temp file that disappears when the server stops. Zero real calls: the
    provider is the fixture-replaying fake.
    """

    from tempfile import TemporaryDirectory

    from .review_screen import build_live_model
    from .review_service import (
        DecisionResult,
        ReviewService,
        host_derived_operator,
        make_server,
    )

    provider = FakeCallProvider(scenario=scenario, fixture_dir=fixture_dir)
    fixture = provider.load()
    envelope = fixture["envelope"]
    claim = source_claim_from_dict(envelope)
    recipient = fixture["recipient_e164"]
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    now = datetime.now(timezone.utc)
    run = run_exception(
        claim,
        _synthetic_authorization(recipient, now),
        provider,
        version_reader=store,
        attempt_ledger=InMemoryAttemptLedger(),
        now=now,
        allowlist=frozenset({recipient}),
    )
    if run.refusal is not None or run.outcome is None:
        print(json.dumps(masked_report(run, recipient), indent=2, sort_keys=True))
        return 1
    outcome = run.outcome
    packet = prepare_review(outcome, recipient)
    operator = host_derived_operator()

    manifest = envelope.get("exhaustion_manifest") or {}
    routes = tuple(
        f"{route['channel']} — {route['outcome']}" for route in manifest.get("routes", ())
    )
    model = build_live_model(
        packet,
        claim_id=claim.source_claim_id,
        organization=envelope["caller_organization"],
        counterparty="claims desk (synthetic)",
        amount_display=f"{envelope['claim_currency']} {envelope['claim_face_value']}",
        situation=envelope.get("documented_reason") or envelope["exception_status"],
        routes_exhausted=routes,
        controls=(
            {
                "label": "Authority confirmed",
                "detail": "time-bounded TEST_RECIPIENT_CONSENT record (synthetic)",
            },
            {
                "label": "Duplicate prevention active",
                "detail": "local attempt ledger reserved the key before dialing",
            },
            {
                "label": "Source version checked",
                "detail": "live record re-read before the call and before any write",
            },
        ),
        runtime_lines=(
            f"Provider {provider.name}: synthetic replay, zero real calls placed",
            f"Transport {packet.transport_state}",
        ),
        runtime_limitation=(
            "Synthetic scenario — no live call was placed, and none can be "
            "placed from this surface."
        ),
    )

    def decide(decision: ReviewDecision) -> DecisionResult:
        record = ReviewRecord(
            decision=decision,
            reviewer=operator,
            decided_at=datetime.now(timezone.utc),
            review_id=packet.review_id,
            packet_sha256=packet.packet_sha256,
            operator_id=operator,
        )
        result = write_back(
            claim,
            store,
            InMemoryNoteLedger(),
            packet,
            record,
            outcome,
            idempotency_key=run.idempotency_key or "",
            evidence_pointer=outcome.transport.call_id,
            written_at=datetime.now(timezone.utc),
        )
        if isinstance(result, WriteBackRefusal):
            return DecisionResult(write_back=result.value, refusal=result.value)
        return DecisionResult(
            write_back=(
                "NOTE_REPLAYED_IDEMPOTENT" if result.replayed else "NOTE_WRITTEN"
            ),
            note_id=result.note_id,
            replayed=result.replayed,
        )

    with TemporaryDirectory(prefix="warrantyops-review-") as tmp:
        private = Path(tmp)
        private.chmod(0o700)
        transcript_text = "\n".join(
            f"{turn['speaker']}: {turn['text']}"
            for turn in fixture.get("transcript_turns", ())
        )
        transcript_path = private / f"{packet.review_id}.txt"
        transcript_path.write_text(transcript_text + "\n", encoding="utf-8")
        transcript_path.chmod(0o600)

        service = ReviewService(operator_id=operator, private_root=private)
        service.register(packet, model=model, transcript_path=transcript_path, decide=decide)
        server = make_server(service, host=host, port=port)
        print(
            f"serving synthetic review {packet.review_id} at "
            f"http://{host}:{server.server_port}/review/{packet.review_id}"
        )
        print("loopback only; transcript link is local-only; Ctrl-C to stop")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        entries = service.journal.entries()
        print(
            json.dumps(
                {"decisions_recorded": len(entries), "journal_head": service.journal.head()},
                indent=2,
                sort_keys=True,
            )
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="warrantyops", description=__doc__)
    parser.add_argument("--scenario", help="synthetic scenario to replay")
    parser.add_argument(
        "--fixture-dir", type=Path, default=FIXTURE_DIR, help="where fixtures live"
    )
    parser.add_argument(
        "--approve",
        action="store_true",
        help="approve the review and perform the synthetic write-back",
    )
    parser.add_argument(
        "--ledger-db",
        type=Path,
        default=None,
        help=(
            "explicit path for the durable attempt ledger (SQLite). Must be "
            "outside this repository. Required for --preflight and "
            "--execute-live-call."
        ),
    )
    parser.add_argument(
        "--preflight",
        action="store_true",
        help="local runtime-proof checks only: no network, no provider, no reservation",
    )
    parser.add_argument(
        "--probe-auth",
        action="store_true",
        help=(
            "zero-dial authentication probe: one calls.get on a known-"
            "nonexistent synthetic call id; never creates a call"
        ),
    )
    parser.add_argument(
        "--execute-live-call",
        action="store_true",
        help=(
            "the live runtime proof. Refuses unless every explicit "
            "confirmation is also supplied"
        ),
    )
    parser.add_argument(
        "--confirm-consenting-recipient",
        action="store_true",
        help="attest that the recipient consented to the role-play",
    )
    parser.add_argument(
        "--recover-runtime-result",
        action="store_true",
        help=(
            "re-read the already-placed runtime-proof call from the ledger's "
            "stored call id (one calls.get, never a new call) and rewrite "
            "the sanitized receipt"
        ),
    )
    parser.add_argument(
        "--proof-screen",
        nargs="?",
        const="",
        default=None,
        metavar="PATH",
        help=(
            "render the judge-facing proof screen from the checked-in "
            "sanitized fixture (offline, static; default path: proof/w1042-proof.html)"
        ),
    )
    parser.add_argument(
        "--verify-proof-screen",
        action="store_true",
        help=(
            "re-render the proof screen in memory and exit 0 only if it is "
            "byte-identical to the checked-in page; prints the sha256"
        ),
    )
    parser.add_argument(
        "--adversarial-page",
        nargs="?",
        const="",
        default=None,
        metavar="PATH",
        help=(
            "execute the eighteen adversarial families against the real "
            "kernel and render the rejection page "
            f"“{ADVERSARIAL_TITLE}” "
            "(offline, static; default path: proof/adversarial.html)"
        ),
    )
    parser.add_argument(
        "--verify-adversarial",
        action="store_true",
        help=(
            "re-execute the eighteen families in memory and exit 0 only if "
            "the page renders byte-identically to the checked-in one; "
            "prints the sha256"
        ),
    )
    parser.add_argument(
        "--serve-review",
        nargs="?",
        const="case_a_useful_resolution",
        default=None,
        metavar="SCENARIO",
        help=(
            "run one synthetic scenario, then serve its review screen on "
            "127.0.0.1 with the CSRF-protected Approve/Refuse/Return form "
            "and the jailed transcript link; Ctrl-C to stop"
        ),
    )
    parser.add_argument(
        "--confirm-phrase",
        default=None,
        help=f"must be exactly {CONFIRMATION_PHRASE}",
    )
    parser.add_argument(
        "--metrics",
        action="store_true",
        help=(
            "attach the structured event log to the scenario run and include "
            "the run's counters and audit pane in the report"
        ),
    )
    parser.add_argument(
        "--generate-docs",
        action="store_true",
        help=(
            "regenerate docs/refusals.md and docs/state-machine.md from the "
            "live enums (offline, static)"
        ),
    )
    parser.add_argument(
        "--purge-artifacts",
        action="store_true",
        help=(
            "delete expired runtime receipts from the private artifact "
            "directory (TTL via --retention-days, default 90); the attempt "
            "ledger is never touched"
        ),
    )
    parser.add_argument(
        "--retention-days",
        type=int,
        default=None,
        metavar="DAYS",
        help="retention window for --purge-artifacts (default: 90)",
    )
    parser.add_argument(
        "--contract-live",
        action="store_true",
        help=(
            "env-gated, GET-only contract check: one calls.get (default: "
            "the known-nonexistent probe id; override with "
            "WARRANTYOPS_CONTRACT_CALL_ID) validated against the adapter's "
            "structural contract; no create path exists"
        ),
    )
    parser.add_argument(
        "--verify-docs",
        action="store_true",
        help=(
            "re-render docs/refusals.md and docs/state-machine.md in memory "
            "and exit 0 only if both are byte-identical to the checked-in "
            "files; prints their combined sha256"
        ),
    )
    parser.add_argument("--list", action="store_true", help="list scenarios and exit")
    args = parser.parse_args(argv)

    modes = [
        flag
        for flag in (
            args.list,
            args.preflight,
            args.probe_auth,
            args.execute_live_call,
            args.recover_runtime_result,
            args.proof_screen is not None,
            args.verify_proof_screen,
            args.adversarial_page is not None,
            args.verify_adversarial,
            args.serve_review is not None,
            args.generate_docs,
            args.verify_docs,
            args.purge_artifacts,
            args.contract_live,
        )
        if flag
    ]
    if len(modes) > 1:
        print(
            "refused: choose one of --list/--preflight/--probe-auth/"
            "--execute-live-call/--recover-runtime-result/--proof-screen/"
            "--verify-proof-screen/--adversarial-page/--verify-adversarial/"
            "--serve-review/--generate-docs/--verify-docs/--purge-artifacts/"
            "--contract-live",
            file=sys.stderr,
        )
        return 2

    if args.contract_live:
        from .runtime_proof import contract_live_check

        report = contract_live_check()
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0 if not report["refused"] else 1

    if args.retention_days is not None and not args.purge_artifacts:
        print(
            "refused: --retention-days applies only to --purge-artifacts",
            file=sys.stderr,
        )
        return 2

    if args.purge_artifacts:
        from .runtime_proof import DEFAULT_RETENTION_DAYS, purge_artifacts

        report = purge_artifacts(
            retention_days=(
                DEFAULT_RETENTION_DAYS
                if args.retention_days is None
                else args.retention_days
            )
        )
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0 if not report["refused"] else 1

    if args.verify_proof_screen:
        fixture = json.loads(DEFAULT_FIXTURE.read_text(encoding="utf-8"))
        rendered = render_proof_screen(fixture)
        on_disk = DEFAULT_OUTPUT.read_text(encoding="utf-8")
        digest = hashlib.sha256(rendered.encode("utf-8")).hexdigest()
        if rendered == on_disk:
            print(f"proof screen byte-identical: {DEFAULT_OUTPUT.name} sha256={digest}")
            return 0
        print(
            "proof screen drifted from its fixture; regenerate with "
            f"--proof-screen (rendered sha256={digest}, on-disk sha256="
            f"{hashlib.sha256(on_disk.encode('utf-8')).hexdigest()})",
            file=sys.stderr,
        )
        return 1

    if args.verify_adversarial:
        rendered = render_adversarial_page()
        on_disk = ADVERSARIAL_OUTPUT.read_text(encoding="utf-8")
        digest = hashlib.sha256(rendered.encode("utf-8")).hexdigest()
        if rendered == on_disk:
            print(f"adversarial page byte-identical: {ADVERSARIAL_OUTPUT.name} sha256={digest}")
            return 0
        print(
            "adversarial page drifted from the kernel; regenerate with "
            f"--adversarial-page (rendered sha256={digest}, on-disk sha256="
            f"{hashlib.sha256(on_disk.encode('utf-8')).hexdigest()})",
            file=sys.stderr,
        )
        return 1

    if args.serve_review is not None:
        return _serve_review(args.serve_review or "case_a_useful_resolution", args.fixture_dir)

    if args.adversarial_page is not None:
        target = (
            write_adversarial_page(output_path=Path(args.adversarial_page))
            if args.adversarial_page
            else write_adversarial_page()
        )
        print(str(target.resolve()))
        return 0

    if args.verify_docs:
        from .refusals_catalog import render_refusals_markdown
        from .statemachine import render_markdown as render_state_machine

        expected_docs = {
            "refusals.md": render_refusals_markdown(),
            "state-machine.md": render_state_machine(),
        }
        drifted = [
            name
            for name, body in expected_docs.items()
            if not (DOCS_DIR / name).is_file()
            or (DOCS_DIR / name).read_text(encoding="utf-8") != body
        ]
        if drifted:
            print(
                "generated docs drifted from the live enums: "
                + ", ".join(drifted)
                + "; regenerate with --generate-docs",
                file=sys.stderr,
            )
            return 1
        digest = hashlib.sha256(
            "".join(expected_docs.values()).encode("utf-8")
        ).hexdigest()
        print(
            "generated docs byte-identical: "
            + ", ".join(expected_docs)
            + f" sha256={digest}"
        )
        return 0

    if args.proof_screen is not None:
        target = (
            write_proof_screen(output_path=Path(args.proof_screen))
            if args.proof_screen
            else write_proof_screen()
        )
        print(str(target.resolve()))
        return 0

    if args.generate_docs:
        from .refusals_catalog import render_refusals_markdown
        from .statemachine import render_markdown as render_state_machine

        DOCS_DIR.mkdir(parents=True, exist_ok=True)
        for name, body in (
            ("refusals.md", render_refusals_markdown()),
            ("state-machine.md", render_state_machine()),
        ):
            with (DOCS_DIR / name).open(
                "w", encoding="utf-8", newline="\n"
            ) as handle:
                handle.write(body)
        print(str(DOCS_DIR))
        return 0

    if args.list or (not args.scenario and not modes):
        for name in _scenarios(args.fixture_dir):
            print(name)
        return 0

    def emit(report: dict[str, Any]) -> int:
        print(json.dumps(report, indent=2, sort_keys=True))
        refused = (
            bool(report.get("refused"))
            or not report.get("ok", True)
            or report.get("evidence_persistence") == "FAILED"
        )
        return 1 if refused else 0

    if args.preflight:
        return emit(
            preflight_report(
                ledger_db=args.ledger_db,
                confirm_consenting_recipient=args.confirm_consenting_recipient,
                confirm_phrase=args.confirm_phrase,
            )
        )
    if args.probe_auth:
        return emit(probe_auth())
    if args.recover_runtime_result:
        return emit(recover_runtime_result(ledger_db=args.ledger_db))
    if args.execute_live_call:
        return emit(
            execute_live_call(
                ledger_db=args.ledger_db,
                confirm_consenting_recipient=args.confirm_consenting_recipient,
                confirm_phrase=args.confirm_phrase,
            )
        )

    try:
        report = run_scenario(
            args.scenario,
            args.fixture_dir,
            args.approve,
            ledger_db=args.ledger_db,
            metrics=args.metrics,
        )
    except AttemptLedgerUnavailable as error:
        print(f"refused: {error}", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
