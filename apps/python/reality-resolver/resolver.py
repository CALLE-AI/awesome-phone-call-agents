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
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import replace
from datetime import datetime, timezone
from typing import Any

from client import (
    FAKE_DEV_API_KEY,
    REAL_API_BASE_URL,
    CallEAPIError,
    CallEClient,
    build_hardened_task,
    build_recipient,
    derive_idempotency_key,
    load_dotenv,
    mask_phone,
    mask_secret,
    parse_utc_timestamp,
    print_compliance_decision,
    redacted_call_for_display,
    redacted_recipient_for_display,
    render_disclosure_script,
    resolve_api_key,
    sanitize_for_display,
)
from compliance.dispatcher import resolve_locale_and_region, run_precall_checks
from compliance.models import PreCallContext, PreCallDecision
from compliance.use_cases import UnknownUseCaseError, apply_use_case
from evidence.engine import ReasoningResult, evaluate
from evidence.model import Case, load_case
from next_window import next_legal_window
from verdict import (
    ACTION_NO_ACTION_REQUIRED,
    ACTION_RETRY_WHEN_PERMITTED,
    Verdict,
    patient_intent_result_schema,
    reconcile,
)

load_dotenv()

DEFAULT_BASE_URL = REAL_API_BASE_URL


def evidence_citations(case: Case) -> tuple[str, ...]:
    return tuple(f"{item.source}: {item.claim!r}" for item in case.evidence.items)


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


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    # Safety interlock, checked before anything else is loaded or run: a
    # real call must always see the real current time. --allow-live only
    # ever means "a real call to CALL-E is explicitly authorized" -
    # --execute is still required as a second, separate confirmation
    # before anything is ever sent (see the dry-run check further down,
    # unchanged).
    if args.allow_live and args.now_utc is not None:
        print(
            "error: --now-utc cannot be combined with --allow-live. A real call must always be "
            "evaluated against the real current time, never an overridden one.",
            file=sys.stderr,
        )
        return 1

    case = load_case(args.case)
    if args.phone:
        case = replace(case, call_phone=args.phone)

    # Destination authorization, checked here because this is the first
    # point where the final number is known: --phone has already
    # overridden the case file's call_phone, so case.call_phone from here
    # on is exactly the string build_recipient() will put in the request
    # body. Comparison is byte-exact and deliberately does no
    # normalization - no stripping, no reformatting, no country-code
    # inference - so a number that merely looks equivalent can never
    # authorize a different one. --allow-live alone declares intent to
    # place a real call; it does not say which number that call may
    # reach, and this is what makes that explicit. Refused before the
    # evidence engine runs and long before any client is constructed, so
    # nothing can reach the network.
    if args.allow_live and args.authorize_destination != case.call_phone:
        if args.authorize_destination is None:
            print(
                "error: --allow-live requires --authorize-destination <E.164> naming the exact "
                "number this call may reach. Nothing was sent.",
                file=sys.stderr,
            )
        else:
            print(
                "error: --authorize-destination does not match the call's resolved destination "
                f"({mask_phone(args.authorize_destination)} authorized, "
                f"{mask_phone(case.call_phone)} would be called). The authorized number must "
                "match exactly, with no reformatting. Nothing was sent.",
                file=sys.stderr,
            )
        return 1

    now = args.now_utc or datetime.now(timezone.utc)

    print(f"Case: {case.name}", flush=True)
    print(f"Mode: {'EXECUTE' if args.execute else 'DRY-RUN'}", flush=True)
    print(f"Use case: {case.use_case}", flush=True)
    print_evidence_state(case)

    reasoning = evaluate(case.evidence, case.deadline, now, case.decision_deadline_threshold)
    print_reasoning(reasoning)
    print_call_justification(reasoning.decision_critical)

    citations = evidence_citations(case)

    if not reasoning.decision_critical:
        print_verdict(Verdict("NO_CALL_NEEDED", ACTION_NO_ACTION_REQUIRED, citations))
        return 0

    context = PreCallContext(
        phone_e164=case.call_phone,
        intends_to_record=args.intends_to_record,
        consent_obtained=args.consent_obtained,
        consent_timestamp=args.consent_timestamp,
        dnc_checked=args.dnc_checked,
        gdpr_basis_documented=args.gdpr_basis_documented,
        recipient_timezone=args.recipient_timezone,
        now_utc=now,
        solicitations_in_last_24h=args.solicitations_in_last_24h,
    )
    decision: PreCallDecision = run_precall_checks(context)
    print("=== CALL PERMISSION ===", flush=True)
    print_compliance_decision(decision)

    try:
        applicable_decision = apply_use_case(decision, case.use_case)
    except UnknownUseCaseError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    exempted_checks = tuple(
        result.check_name for result in decision.results if result not in applicable_decision.results
    )
    if exempted_checks:
        print(
            f"  Not applicable to use case {case.use_case!r} (commercial-solicitation-specific): "
            f"{', '.join(exempted_checks)}",
            flush=True,
        )
    print(f"Compliance gate (applicable to {case.use_case!r}): allowed={applicable_decision.allowed}", flush=True)
    use_case_citation = f"use_case={case.use_case}"

    if not applicable_decision.allowed:
        # Fully enforced, fail-closed - the hard gate always applies, for
        # every case and every target, real or fake. There is no mode
        # that bypasses or merely warns about a failing check still
        # applicable to this use case.
        window = next_legal_window(applicable_decision, args.recipient_timezone, now)
        print(f"  Next legal window: {window}", flush=True)
        print_verdict(
            Verdict(
                "UNRESOLVED_CALL_BLOCKED",
                ACTION_RETRY_WHEN_PERMITTED,
                citations
                + (
                    f"compliance gate blocked: {applicable_decision.blocking_reasons}",
                    f"next legal window: {window}",
                    use_case_citation,
                ),
            )
        )
        return 0

    locale, region, disclosure_script_template = resolve_locale_and_region(decision.jurisdiction_chain)
    disclosure_script = (
        render_disclosure_script(disclosure_script_template, args.entity_name, args.agent_name)
        if disclosure_script_template
        else None
    )
    hardened_task = build_hardened_task(case.call_task_hint, disclosure_script=disclosure_script)
    recipient = build_recipient(case.call_phone, locale, region)
    result_schema = patient_intent_result_schema()

    print("=== CALL-E ===", flush=True)
    body_preview = {
        "task": hardened_task,
        "recipients": [redacted_recipient_for_display(recipient)],
        "result_schema": result_schema,
    }
    print(json.dumps(body_preview, indent=2), flush=True)

    if not args.execute:
        print(
            "Dry-run: call is justified and permitted. Nothing was sent (pass --execute to "
            "place it and reach a verdict).",
            flush=True,
        )
        return 0

    api_key = resolve_api_key(args)
    if api_key == FAKE_DEV_API_KEY:
        print("Using API key=<fake dev key, not a real credential> (non-live target)", flush=True)
    else:
        print(f"Using API key={mask_secret(api_key)}", flush=True)

    client = CallEClient(base_url=args.base_url, api_key=api_key, allow_live=args.allow_live)
    idempotency_key = derive_idempotency_key(case.call_phone, case.call_task_hint, datetime.now(timezone.utc))

    try:
        created = client.create_call(
            task=hardened_task,
            recipients=[recipient],
            result_schema=result_schema,
            idempotency_key=idempotency_key,
        )
    except (CallEAPIError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    # call_id keeps the provider's raw value - it is what a later
    # GET /v1/calls/{id} must be built from - while everything printed
    # goes through sanitize_for_display first: these lines interpolate
    # provider-controlled strings directly, unlike the response bodies
    # below, which json.dumps already escapes.
    call_id = created["id"]
    print(
        f"Created call {sanitize_for_display(call_id)} "
        f"with status {sanitize_for_display(created.get('status'))}",
        flush=True,
    )

    poll_started_at = time.monotonic()

    def report(call: dict[str, Any]) -> None:
        elapsed_seconds = time.monotonic() - poll_started_at
        print(
            f"Poll: status={sanitize_for_display(call.get('status'))} "
            f"(elapsed: {elapsed_seconds:.0f}s)",
            flush=True,
        )

    def report_warning(minutes_elapsed: float, call: dict[str, Any]) -> None:
        print(
            f"This call has been in progress for over {minutes_elapsed:.0f} minutes. Still "
            f"watching... (last status: {sanitize_for_display(call.get('status'))})",
            flush=True,
        )

    try:
        final_call = client.poll_until_terminal(
            call_id,
            interval_seconds=args.poll_interval_seconds,
            timeout_seconds=args.poll_timeout_seconds,
            warn_after_seconds=args.poll_warn_after_seconds,
            on_poll=report,
            on_warn=report_warning,
        )
    except KeyboardInterrupt:
        print(
            f"\nStopped watching call {sanitize_for_display(call_id)} (Ctrl+C). "
            "The call itself was not canceled.",
            file=sys.stderr,
        )
        return 1
    except (CallEAPIError, TimeoutError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(json.dumps(redacted_call_for_display(final_call), indent=2), flush=True)

    structured_result = final_call.get("structured_result")
    verdict = reconcile(structured_result, case.decision_options, case.evidence)
    verdict = replace(verdict, evidence_cited=verdict.evidence_cited + (use_case_citation,))
    print_verdict(verdict)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
