"""CLI entry point for Reality Resolver.

Loads a Case (evidence + deadline), evaluates whether its uncertainty
is decision-critical (evidence/engine.py), and only escalates to a
real, compliance-gated CALL-E call when it genuinely is - never for
evidence that already speaks for itself. See README.md for the full
architecture diagram and the honest lineage note on the compliance gate
and CALL-E client this reuses unmodified.

  Evidence sources (fixtures JSON)
    -> Evidence Matrix -> 4 generic rules -> decision-critical uncertainty?
         NO  -> NO_CALL_NEEDED
         YES -> call justified -> call permitted (compliance gate)?
                  NO  -> UNRESOLVED_CALL_BLOCKED, RETRY_WHEN_PERMITTED
                  YES -> CALL-E -> structured_result -> reconciliation
                         -> RESOLVED / RESOLVED_ALT / UNRESOLVED_AMBIGUOUS

This module is the CLI and only the CLI: argparse in, printing out. The
pipeline itself lives in pipeline.py, so that the ordering carrying this
app's safety properties exists once rather than once per interface. Every
print below is reached through a pipeline Observer hook, one hook per
place this file used to print from.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from typing import Any

from client import (
    FAKE_DEV_API_KEY,
    REAL_API_BASE_URL,
    CallEAPIError,
    load_dotenv,
    mask_secret,
    parse_utc_timestamp,
    print_compliance_decision,
    redacted_call_for_display,
    redacted_recipient_for_display,
    sanitize_for_display,
)
from compliance.models import PreCallDecision
from compliance.use_cases import UnknownUseCaseError
from evidence.engine import ReasoningResult
from evidence.model import Case
from pipeline import Observer, ResolutionRefused, ResolutionRequest, resolve
from verdict import Verdict

load_dotenv()

DEFAULT_BASE_URL = REAL_API_BASE_URL


def print_evidence_state(case: Case) -> None:
    print("=== EVIDENCE STATE ===", flush=True)
    for item in case.evidence.items:
        print(
            f"  [{item.type.value:10}] {item.source:14} (freshness: {item.freshness}, "
            f"ambiguity: {item.ambiguity.value:6}) - {item.claim!r}",
            flush=True,
        )


def print_reasoning(reasoning: ReasoningResult) -> None:
    print("=== REASONING ===", flush=True)
    for rule in reasoning.rules:
        status = "YES" if rule.triggered else "NO"
        print(f"  [{status}] {rule.rule_name}: {rule.reason}", flush=True)


def print_call_justification(decision_critical: bool) -> None:
    print("=== CALL JUSTIFICATION ===", flush=True)
    if decision_critical:
        print("  R1-R4 all triggered: uncertainty is decision-critical. A call is justified.", flush=True)
    else:
        print("  Not all of R1-R4 triggered: uncertainty is not decision-critical. No call is justified.", flush=True)


def print_verdict(verdict: Verdict) -> None:
    print("=== VERDICT ===", flush=True)
    print(f"  Status: {verdict.status}", flush=True)
    print(f"  Action: {verdict.action}", flush=True)
    print("  Evidence cited:", flush=True)
    for item in verdict.evidence_cited:
        # The CALL-E result line embeds provider values. reconcile() built
        # them with !r, so control characters are already escaped, but
        # nothing bounded their length - sanitize here, at the display
        # layer, rather than in verdict.py: the Verdict object itself must
        # keep citing what the provider actually returned.
        print(f"    - {sanitize_for_display(item)}", flush=True)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Reality Resolver: resolves a decision-critical uncertainty by escalating "
        "to a compliance-gated CALL-E call only when the case's own evidence cannot decide it."
    )
    parser.add_argument("case", help="Path to a case JSON file, e.g. cases/ghost-appointment.json.")
    parser.add_argument(
        "--phone",
        default=None,
        help="Override the case file's call_phone (E.164). The shipped example cases use a "
        "reserved, non-routable placeholder number - pass a real number here rather than "
        "editing or committing one into a case file.",
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually call POST /v1/calls if the call is justified and the compliance gate "
        "allows it. Default is dry-run: run the full reasoning trail and preview what would be "
        "sent, without calling the API.",
    )
    parser.add_argument(
        "--allow-live",
        action="store_true",
        help=f"Required in addition to --base-url {REAL_API_BASE_URL} and --execute before any "
        "real call can be placed. Means only 'a real call to CALL-E is explicitly "
        "authorized' - the compliance gate itself is always fully enforced, fail-closed, "
        "regardless of this flag. Refused together with --now-utc - a real call always sees "
        "the real current time.",
    )
    parser.add_argument(
        "--authorize-destination",
        default=None,
        metavar="E164",
        help="Required together with --allow-live: the exact E.164 number this call is "
        "authorized to reach. Compared byte-for-byte against the number that will actually be "
        "sent to CALL-E (the case file's call_phone, or --phone when it overrides it), with no "
        "normalization of any kind - a number that merely looks equivalent will be refused. "
        "--allow-live on its own only says 'a real call is authorized'; this says which number "
        "it may reach.",
    )
    parser.add_argument(
        "--now-utc",
        type=parse_utc_timestamp,
        default=None,
        help="Override 'now' for both rule evaluation (R4's deadline check, calling-window "
        "checks) and the next-legal-window projection, ISO 8601 UTC. Development/testing "
        "determinism only - refused together with --allow-live; production usage omits this.",
    )
    parser.add_argument("--poll-interval-seconds", type=float, default=2.0)
    parser.add_argument("--poll-timeout-seconds", type=float, default=None)
    parser.add_argument("--poll-warn-after-seconds", type=float, default=300.0)

    # Compliance context flags - operator-attested at call time, same
    # mechanism client.py's own compliance gate has always used. Never
    # part of the case JSON: a case describes evidence about the world,
    # not the operator's own right to place the call.
    parser.add_argument("--consent-obtained", action="store_true")
    parser.add_argument("--consent-timestamp", type=parse_utc_timestamp, default=None)
    parser.add_argument("--dnc-checked", action="store_true")
    parser.add_argument(
        "--gdpr-basis-documented",
        action="store_true",
        help="Attests that a GDPR Art. 6 lawful basis for processing this recipient's personal "
        "data has been identified and documented - required for any EU number, regardless of "
        "use case, since this obligation is not scoped to commercial solicitation. This is not "
        "marketing consent: for appointment_confirmation, the relevant basis is ordinarily "
        "Art. 6(1)(b) (necessary to perform an existing appointment/service) or Art. 6(1)(f) "
        "(legitimate interest in confirming it) - not Art. 6(1)(a) (consent), which does not "
        "apply here. Passing this flag never creates that basis; it only attests that the "
        "operator has already identified and documented one for this specific call.",
    )
    parser.add_argument("--recipient-timezone", default=None, help="IANA timezone name, for example Europe/Paris.")
    parser.add_argument("--intends-to-record", action="store_true")
    parser.add_argument("--solicitations-in-last-24h", type=int, default=None)
    parser.add_argument("--entity-name", default=None)
    parser.add_argument("--agent-name", default=None)
    return parser.parse_args(argv)


class CliObserver(Observer):
    """Prints exactly what resolver.py printed before the pipeline was
    extracted, at exactly the same points. Holds only display state: the
    poll clock, and the call id the Ctrl+C message needs.
    """

    def __init__(self) -> None:
        self.call_id: str | None = None
        self._poll_started_at: float | None = None

    def on_start(self, case: Case, mode: str) -> None:
        print(f"Case: {case.name}", flush=True)
        print(f"Mode: {mode}", flush=True)
        print(f"Use case: {case.use_case}", flush=True)
        print_evidence_state(case)

    def on_reasoning(self, reasoning: ReasoningResult) -> None:
        print_reasoning(reasoning)
        print_call_justification(reasoning.decision_critical)

    def on_compliance_checks(self, decision: PreCallDecision) -> None:
        print("=== CALL PERMISSION ===", flush=True)
        print_compliance_decision(decision)

    def on_use_case_filter(
        self, applicable: PreCallDecision, exempted_checks: tuple[str, ...], use_case: str
    ) -> None:
        if exempted_checks:
            print(
                f"  Not applicable to use case {use_case!r} (commercial-solicitation-specific): "
                f"{', '.join(exempted_checks)}",
                flush=True,
            )
        print(f"Compliance gate (applicable to {use_case!r}): allowed={applicable.allowed}", flush=True)

    def on_blocked(self, window: str) -> None:
        print(f"  Next legal window: {window}", flush=True)

    def on_call_preview(self, preview: dict[str, Any]) -> None:
        # The pipeline hands over the real request body. Masking the
        # recipient is a display concern and happens here, at the point
        # of printing, never upstream - the body actually sent to CALL-E
        # must keep the real number.
        print("=== CALL-E ===", flush=True)
        displayed = {
            "task": preview["task"],
            "recipients": [redacted_recipient_for_display(r) for r in preview["recipients"]],
            "result_schema": preview["result_schema"],
        }
        print(json.dumps(displayed, indent=2), flush=True)

    def on_dry_run(self) -> None:
        print(
            "Dry-run: call is justified and permitted. Nothing was sent (pass --execute to "
            "place it and reach a verdict).",
            flush=True,
        )

    def on_api_key(self, api_key: str) -> None:
        if api_key == FAKE_DEV_API_KEY:
            print("Using API key=<fake dev key, not a real credential> (non-live target)", flush=True)
        else:
            print(f"Using API key={mask_secret(api_key)}", flush=True)

    def on_call_created(self, call_id: str, status: Any) -> None:
        # call_id is kept raw here only so the Ctrl+C handler can name the
        # call; everything printed goes through sanitize_for_display
        # first, since these lines interpolate provider-controlled strings
        # directly, unlike the response bodies below, which json.dumps
        # already escapes.
        self.call_id = call_id
        self._poll_started_at = time.monotonic()
        print(
            f"Created call {sanitize_for_display(call_id)} "
            f"with status {sanitize_for_display(status)}",
            flush=True,
        )

    def on_poll(self, call: dict[str, Any]) -> None:
        started = self._poll_started_at if self._poll_started_at is not None else time.monotonic()
        elapsed_seconds = time.monotonic() - started
        print(
            f"Poll: status={sanitize_for_display(call.get('status'))} "
            f"(elapsed: {elapsed_seconds:.0f}s)",
            flush=True,
        )

    def on_poll_warning(self, minutes_elapsed: float, call: dict[str, Any]) -> None:
        print(
            f"This call has been in progress for over {minutes_elapsed:.0f} minutes. Still "
            f"watching... (last status: {sanitize_for_display(call.get('status'))})",
            flush=True,
        )

    def on_call_completed(self, call: dict[str, Any]) -> None:
        print(json.dumps(redacted_call_for_display(call), indent=2), flush=True)

    def on_verdict(self, verdict: Verdict) -> None:
        print_verdict(verdict)


def build_request(args: argparse.Namespace) -> ResolutionRequest:
    return ResolutionRequest(
        case_path=args.case,
        base_url=args.base_url,
        execute=args.execute,
        allow_live=args.allow_live,
        authorize_destination=args.authorize_destination,
        phone_override=args.phone,
        now_utc=args.now_utc,
        poll_interval_seconds=args.poll_interval_seconds,
        poll_timeout_seconds=args.poll_timeout_seconds,
        poll_warn_after_seconds=args.poll_warn_after_seconds,
        intends_to_record=args.intends_to_record,
        consent_obtained=args.consent_obtained,
        consent_timestamp=args.consent_timestamp,
        dnc_checked=args.dnc_checked,
        gdpr_basis_documented=args.gdpr_basis_documented,
        recipient_timezone=args.recipient_timezone,
        solicitations_in_last_24h=args.solicitations_in_last_24h,
        entity_name=args.entity_name,
        agent_name=args.agent_name,
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    observer = CliObserver()
    try:
        resolve(build_request(args), observer)
    except (ResolutionRefused, UnknownUseCaseError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print(
            f"\nStopped watching call {sanitize_for_display(observer.call_id)} (Ctrl+C). "
            "The call itself was not canceled.",
            file=sys.stderr,
        )
        return 1
    except (CallEAPIError, TimeoutError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
