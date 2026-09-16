"""The controlled runtime-proof pathway: preflight, probe, execute, recover.

Four separately invoked commands, in increasing order of consequence.

**Preflight** is local-only: version, SDK importability, environment
presence, envelope/gate dry runs and ledger availability. It inspects
whether the idempotency key is free (creating only the empty table, never a
reservation) and touches no network, no provider and no key value.

**The authentication probe** dials nothing: it performs one ``calls.get``
against a known-nonexistent synthetic call id and reads the authenticated
404 as connectivity evidence. It never constructs a call.

**Execution** is the live runtime proof. It refuses before ``calls.create``
unless every explicit confirmation is present: the execute flag, the
consenting-recipient flag, the exact confirmation phrase, an explicit
durable ledger outside the repository, the private environment, and Python
3.11+. The run itself is the ordinary workflow: every deterministic gate,
atomic reservation, at most one creation, call id persisted before polling,
bounded polling, local validation, a human-review packet — and the
write-back withheld. Execution and recovery both atomically write a
sanitized JSON receipt (mode 0600) into the artifact directory; a receipt
that cannot be written is reported as an explicit evidence-persistence
failure and never triggers a retry of call creation.

**Recovery** re-reads a call that already happened: the durable ledger's
stored call id, one ``calls.get``, never ``calls.create`` — and rebuilds
the corrected sanitized receipt from the existing record.

Secrets never cross the CLI surface: the API key is read only from
``CALLE_API_KEY`` (never an argument, never printed, presence checked
without echoing), the recipient only from
``WARRANTYOPS_TEST_RECIPIENT_E164`` and displayed only masked. No
recipient, task, transcript or organization value is written to the
durable ledger; what it holds is the key digest, the request fingerprint
digest, a state, timestamps and the vendor call id.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
from collections.abc import Mapping
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Optional, Union

from .authorization import (
    E164_RE,
    AuthorizationBasis,
    CallAuthorization,
    authorize_call,
    mask_e164,
    normalize_e164,
)
from .config import (
    ConfigRefusal,
    artifact_dir_refusals,
    live_call_refusals,
    load_config,
)
from .contract import CONTRACT_VERSION, build_extraction_schema
from .envelope import (
    ExceptionStatus,
    ExhaustionManifest,
    ExhaustionRoute,
    OrdinaryRemedy,
    SourceClaim,
    validate_source_claim,
)
from .gates import (
    DEFAULT_POLICY_BOOK,
    assess_economics,
    assess_residual_necessity,
)
from .idempotency import derive_idempotency_key
from .identifiers import fold_text
from .ledger import (
    AttemptLedgerUnavailable,
    LedgerRefusal,
    SqliteAttemptLedger,
    ledger_path_refusals,
)
from .outcome import (
    TransportOutcome,
    TransportState,
    WorkflowOutcome,
    derive_outcome,
)
from .providers.calle_client import (
    KNOWN_SDK_STATUSES,
    CalleCallProvider,
    PollingConfig,
    attempt_transcript,
)
from .review import prepare_review
from .source import InMemorySourceStore
from .validation import validate_structured_result
from .workflow import DEFAULT_REFERENCE_PATTERN, run_exception

#: The exact phrase that must accompany --execute-live-call. It names the
#: claim so the confirmation cannot be pasted onto a different run.
CONFIRMATION_PHRASE = "W1042-RUNTIME-PROOF"

#: A call id that cannot exist. Probing it can only produce an
#: authenticated not-found or an error — never a call.
PROBE_CALL_ID = "call_runtime_proof_synthetic_nonexistent_0000"

RECIPIENT_ENV = "WARRANTYOPS_TEST_RECIPIENT_E164"
API_KEY_ENV = "CALLE_API_KEY"
PURPOSE = "warranty claim exception follow-up"

EXPECTED_PYTHON = (3, 11)

#: One shared check row: ``(name, ok, detail)``. The detail is either a short
#: human sentence or, when the check failed, the refusal names it produced.
Check = tuple[str, bool, Union[str, tuple[str, ...]]]


def _env(source: Optional[Mapping[str, str]]) -> Mapping[str, str]:
    return os.environ if source is None else source


def _version_ok(version_info: Optional[tuple[int, ...]]) -> bool:
    info = version_info if version_info is not None else sys.version_info
    return (info[0], info[1]) >= EXPECTED_PYTHON


def _sdk_imports() -> bool:
    try:
        import calle  # noqa: F401 - presence is the check
    except Exception:  # pragma: no cover - depends on the host interpreter
        return False
    return True


def _key_present(env: Mapping[str, str]) -> bool:
    """Presence only. The value is never returned, stored or printed."""

    return bool(env.get(API_KEY_ENV, "").strip())


def _recipient_state(env: Mapping[str, str]) -> tuple[bool, Optional[str]]:
    """(valid, masked-display). The raw value never leaves this function."""

    raw = env.get(RECIPIENT_ENV, "").strip()
    if not raw:
        return False, None
    if E164_RE.fullmatch(raw) is None:
        return False, None
    return True, mask_e164(raw)


def _raw_recipient(env: Mapping[str, str]) -> str:
    return env.get(RECIPIENT_ENV, "").strip()


def canonical_source_claim(recipient_e164: str) -> SourceClaim:
    """The synthetic W-1042 envelope for the runtime proof.

    Every value is fictional: NorthStar Equipment (Maya's organization)
    chasing a returned claim with BlueRock Machinery, eight hundred
    dollars, no reason on the portal. The recipient is the consenting
    role-player's number, supplied only through the environment.
    """

    return SourceClaim(
        source_platform="SYNTHETIC-NORTHSTAR",
        source_claim_id="W-1042",
        source_version="runtime-proof-v1",
        exception_status=ExceptionStatus.RETURNED,
        submitted_at=date(2026, 9, 1),
        caller_organization="NorthStar Equipment",
        account_context="NorthStar synthetic dealer account 1042 (role-play)",
        counterparty_phone_e164=recipient_e164,
        economic_policy_id="standard-pursuit",
        claim_face_value=Decimal("800"),
        claim_currency="USD",
        documented_code="R-RETURNED-NO-REASON",
        documented_reason="Returned: no reason stated on the portal",
        documented_next_step=None,
        ordinary_remedies=(
            OrdinaryRemedy(
                "portal_status_check", "portal shows only 'returned', no reason"
            ),
            OrdinaryRemedy(
                "documented_code_resolution",
                "no published code sheet covers R-RETURNED-NO-REASON",
            ),
            OrdinaryRemedy(
                "written_follow_up", "two emails to the claims desk, no reply"
            ),
        ),
        exhaustion_manifest=ExhaustionManifest(
            source_version="runtime-proof-v1",
            routes=(
                ExhaustionRoute(
                    "portal_status_check",
                    "portal shows only 'returned', no reason",
                    attempted_at=date(2026, 9, 2),
                ),
                ExhaustionRoute(
                    "documented_code_resolution",
                    "no published code sheet covers R-RETURNED-NO-REASON",
                    attempted_at=date(2026, 9, 3),
                ),
                ExhaustionRoute(
                    "written_follow_up",
                    "two emails to the claims desk, no reply",
                    attempted_at=date(2026, 9, 8),
                ),
            ),
            information_gap=(
                "no ordinary route states why the claim was returned or what "
                "the desk needs to rework it"
            ),
        ),
    )


def canonical_authorization(recipient_e164: str, now: datetime) -> CallAuthorization:
    return CallAuthorization(
        recipient_e164=recipient_e164,
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose=PURPOSE,
        granted_by="runtime-proof-operator",
        granted_at=now - timedelta(days=1),
        expires_at=now + timedelta(days=1),
        record_reference="synthetic://runtime-proof/consent/W-1042",
    )


def mask_call_id(call_id: Optional[str]) -> Optional[str]:
    """Prefix and suffix only; the middle never reaches a public surface."""

    if not call_id:
        return None
    if len(call_id) <= 12:
        return call_id[:4] + "…"
    return f"{call_id[:8]}…{call_id[-4:]}"


#: The generic receipt filename. No phone number, call id, claim or date:
#: one canonical sanitized receipt per runtime-proof installation.
RECEIPT_FILENAME = "runtime-proof-receipt.json"
RECEIPT_SCHEMA = "warrantyops-runtime-receipt/1"
WRITE_BACK_TOKEN = "WRITE_BACK_WITHHELD_PENDING_HUMAN_REVIEW"


class EvidencePersistenceError(RuntimeError):
    """The sanitized receipt could not be written after a completed call."""


def write_runtime_receipt(report: dict[str, Any], artifact_dir: Path) -> Path:
    """Atomically write the sanitized receipt, mode 0600.

    Written through a temporary file in the same directory followed by
    ``os.replace``, so a reader never sees a half-written receipt and a
    crash mid-write leaves at most an orphaned dot-prefixed temporary. The
    directory itself is only created when absent (0700); an existing
    directory's permissions are never touched.
    """

    directory = Path(artifact_dir)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = directory / RECEIPT_FILENAME
    temporary = directory / f".{RECEIPT_FILENAME}.tmp"
    payload = json.dumps(report, indent=2, sort_keys=True) + "\n"
    descriptor = os.open(
        temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    except BaseException:
        with contextlib.suppress(OSError):
            temporary.unlink()
        raise
    os.chmod(target, 0o600)
    return target


#: Retention for private runtime artifacts (P8): a receipt older than this is
#: deleted by ``--purge-artifacts``. The TTL is a floor the operator enforces
#: from the runbook, not a promise of automatic deletion — nothing in this
#: package runs on a timer.
DEFAULT_RETENTION_DAYS = 90


def purge_artifacts(
    env: Optional[Mapping[str, str]] = None,
    *,
    retention_days: int = DEFAULT_RETENTION_DAYS,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    """Delete expired runtime receipts from the private artifact directory.

    Only the two files this package can write are ever considered — the
    receipt and its orphaned temporary — and only when their modification
    time is older than the retention window; an operator's other private
    material in the directory is never touched. The attempt ledger is not
    part of this operation: deleting private evidence never rewrites
    history, and a purged run's reservation still suppresses redials.
    """

    source = os.environ if env is None else env
    moment = datetime.now(timezone.utc) if now is None else now
    if retention_days < 0:
        return {
            "refused": True,
            "reasons": ["NEGATIVE_RETENTION_WINDOW"],
            "purged": [],
            "retained": 0,
        }
    artifact_dir = load_config(source).artifact_dir
    if artifact_dir is None:
        return {
            "refused": True,
            "reasons": ["ARTIFACT_DIR_MISSING"],
            "purged": [],
            "retained": 0,
        }
    path_refusals = [
        refusal.value for refusal in artifact_dir_refusals(artifact_dir)
    ]
    if path_refusals:
        return {
            "refused": True,
            "reasons": path_refusals,
            "purged": [],
            "retained": 0,
        }

    owned = (RECEIPT_FILENAME, f".{RECEIPT_FILENAME}.tmp")
    cutoff = moment.timestamp() - retention_days * 86400
    purged: list[str] = []
    retained = 0
    undeletable: list[str] = []
    for name in owned:
        candidate = artifact_dir / name
        try:
            expired = candidate.stat().st_mtime < cutoff
        except OSError:
            continue  # not present; nothing to retain or purge
        if not expired:
            retained += 1
            continue
        try:
            candidate.unlink()
        except OSError:
            undeletable.append(name)
            continue
        purged.append(name)
    report: dict[str, Any] = {
        "refused": False,
        "retention_days": retention_days,
        "purged": purged,
        "retained": retained,
    }
    if undeletable:
        report["undeletable"] = undeletable
    return report


#: Leading words that carry no requirement content, and trailing ones that
#: only restate that a requirement exists. Stripping exactly these (nothing
#: smarter) keeps the merge conservative: entries collapse only when what
#: remains is identical.
_REQUIREMENT_PREFIX_STOPS = frozenset(
    {
        "requires", "require", "required", "requiring",
        "needs", "need", "needed",
        "please", "provide", "provides", "send", "sends", "submit",
        "include", "attach", "upload", "we", "us",
    }
)
_REQUIREMENT_ARTICLES = frozenset({"a", "an", "the"})
_REQUIREMENT_SUFFIX_STOPS = frozenset(
    {"required", "needed", "is", "are", "was", "were", "be"}
)


def _normalize_requirement(text: str) -> str:
    words = fold_text(text).split()
    while words and words[0] in _REQUIREMENT_PREFIX_STOPS:
        words.pop(0)
    while words and words[0] in _REQUIREMENT_ARTICLES:
        words.pop(0)
    while words and words[-1] in _REQUIREMENT_SUFFIX_STOPS:
        words.pop()
    return " ".join(words)


def dedupe_requirements(entries: list[str]) -> list[str]:
    """Collapse semantically equivalent requirement phrasings to one display.

    Conservative by construction: two entries merge only when their
    normalized remainders are exactly equal, so an unrelated requirement is
    never absorbed. The shortest original phrasing is displayed; every
    supporting evidence quote stays in the evidence list untouched.
    """

    display: dict[str, str] = {}
    for entry in entries:
        key = _normalize_requirement(entry) or fold_text(entry)
        if key not in display or len(entry) < len(display[key]):
            display[key] = entry
    return list(display.values())


def _reference_presentation(outcome: WorkflowOutcome) -> Optional[dict[str, Any]]:
    """The reference as it may be shown: display, normalized, method, label.

    The label is the extracted kind when one was established (CLAIM, CASE,
    CREDIT) and the generic ``reference`` otherwise — a kind is never forced
    when the source did not establish one.
    """

    reference = outcome.business.confirmed_reference
    if reference is None:
        return None
    item = next(
        (
            entry
            for entry in outcome.business.evidence
            if entry.get("field") == "confirmed_reference"
        ),
        {},
    )
    kind = reference.kind.value
    return {
        "normalized": reference.value,
        "display": item.get("display") or reference.value,
        "method": item.get("method"),
        "label": kind if kind in {"CLAIM", "CASE", "CREDIT"} else "reference",
    }


def _runtime_receipt(
    *,
    mode: str,
    outcome: WorkflowOutcome,
    masked_recipient: Optional[str],
    reservation: dict[str, Any],
    source_version: str,
    audit_chain_head: Optional[str] = None,
) -> dict[str, Any]:
    """The sanitized receipt body shared by execution and recovery."""

    business = outcome.business
    return {
        "schema": RECEIPT_SCHEMA,
        "mode": mode,
        "source_version": source_version,
        "contract_version": CONTRACT_VERSION,
        "recipient": masked_recipient,
        "audit_chain_head": audit_chain_head,
        "call_id": mask_call_id(outcome.transport.call_id),
        "transport_state": outcome.transport.state.value,
        "terminal_state": outcome.terminal_state.value,
        "claim_status": business.claim_status.value,
        "missing_requirement": dedupe_requirements(
            [
                value
                for value in (
                    business.required_correction,
                    *business.required_documents,
                )
                if value
            ]
        ),
        "reference": _reference_presentation(outcome),
        "evidence": [dict(item) for item in business.evidence],
        "ledger_state": reservation.get("state"),
        "write_back": WRITE_BACK_TOKEN,
    }


def _persist_receipt(report: dict[str, Any], artifact_dir: Path | None) -> dict[str, Any]:
    """Attach receipt persistence status without ever failing the call."""

    if artifact_dir is None:
        # The live-config gate refuses a missing artifact directory before
        # any call exists; reaching here without one means the gate was
        # bypassed, and the receipt says so instead of crashing.
        report["evidence_persistence"] = "FAILED"
        report["receipt_error"] = "no artifact directory configured"
        return report
    try:
        path = write_runtime_receipt(report, artifact_dir)
    except OSError as error:
        report["evidence_persistence"] = "FAILED"
        report["receipt_error"] = f"{type(error).__name__}: {error}"
        return report
    report["evidence_persistence"] = "SAVED"
    report["receipt_path"] = str(path)
    return report


def _derivation_key(
    env: Mapping[str, str], claim: SourceClaim, authorization: CallAuthorization
) -> str:
    config = load_config(env)
    return derive_idempotency_key(
        namespace=config.idempotency_namespace,
        authorization_record_reference=authorization.record_reference,
        source_platform=claim.source_platform,
        source_claim_id=claim.source_claim_id,
        source_version=claim.source_version,
        contract_version=CONTRACT_VERSION,
    )


def _common_gates(
    env: Mapping[str, str],
    python_version_info: Optional[tuple[int, ...]],
    sdk_imports: Optional[bool] = None,
) -> list[Check]:
    """Checks shared by every runtime command, each a (name, ok, detail).

    ``sdk_imports`` overrides the real import attempt (tests inject True
    because the test interpreter is deliberately older than the live one).
    """

    checks: list[Check] = []
    version_ok = _version_ok(python_version_info)
    checks.append((
        "python_311_plus",
        version_ok,
        f"{sys.version_info[0]}.{sys.version_info[1]} (needs >= 3.11)",
    ))
    sdk_ok = (
        sdk_imports if sdk_imports is not None else _sdk_imports()
    ) if version_ok else False
    checks.append((
        "live_sdk_importable",
        sdk_ok,
        "calle package imports" if version_ok else "skipped: python too old",
    ))
    checks.append((
        "api_key_env_present",
        _key_present(env),
        f"{API_KEY_ENV} present (value never read into any report)",
    ))
    recipient_ok, masked = _recipient_state(env)
    checks.append((
        "recipient_env_valid_e164",
        recipient_ok,
        f"{RECIPIENT_ENV} masked: {masked}" if recipient_ok
        else f"{RECIPIENT_ENV} missing or not strict E.164 (raw value not echoed)",
    ))
    config = load_config(env)
    refusals = live_call_refusals(config)
    checks.append((
        "live_config_gates",
        not refusals,
        () if not refusals else tuple(r.value for r in refusals),
    ))
    return checks


def preflight_report(
    *,
    env: Optional[Mapping[str, str]] = None,
    ledger_db: Optional[Path] = None,
    confirm_consenting_recipient: bool = False,
    confirm_phrase: Optional[str] = None,
    python_version_info: Optional[tuple[int, ...]] = None,
    sdk_imports: Optional[bool] = None,
    now: Optional[datetime] = None,
    on: Optional[date] = None,
) -> dict[str, Any]:
    """Local checks only. Zero network, zero provider, zero reservation."""

    source = _env(env)
    moment = now or datetime.now(timezone.utc)
    today = on or date.today()
    checks = _common_gates(source, python_version_info, sdk_imports)

    recipient_ok, masked = _recipient_state(source)
    recipient = _raw_recipient(source) if recipient_ok else None
    claim = canonical_source_claim(recipient or "+12025550100")
    envelope = validate_source_claim(claim, on=today)
    checks.append((
        "canonical_envelope_valid",
        envelope.ok,
        () if envelope.ok else tuple(r.value for r in envelope.refusals),
    ))
    residual = assess_residual_necessity(claim)
    checks.append((
        "residual_gate",
        residual.allowed,
        () if residual.allowed else tuple(r.value for r in residual.refusals),
    ))
    economics = assess_economics(
        claim, policy_book=DEFAULT_POLICY_BOOK, on=today
    )
    checks.append((
        "economic_gate",
        economics.allowed,
        () if economics.allowed else tuple(r.value for r in economics.refusals),
    ))

    authorization = canonical_authorization(recipient or "+12025550100", moment)
    decision = authorize_call(
        authorization, requested_purpose=PURPOSE, now=moment
    )
    bound = recipient_ok and normalize_e164(
        authorization.recipient_e164
    ) == normalize_e164(claim.counterparty_phone_e164)
    checks.append((
        "authorization_bound_to_recipient",
        decision.allowed and bound,
        () if decision.allowed and bound else tuple(
            r.value for r in decision.refusals
        ) or ("RECIPIENT_MISMATCH",),
    ))

    checks.append((
        "consent_confirmation_supplied",
        confirm_consenting_recipient
        and confirm_phrase == CONFIRMATION_PHRASE,
        "consenting-recipient flag plus the exact confirmation phrase",
    ))

    path_refusals = ledger_path_refusals(ledger_db)
    key = _derivation_key(source, claim, authorization)
    reservation: Optional[dict[str, Any]] = None
    if ledger_db is not None and not path_refusals:
        try:
            # Inspect only. The table may be created; no row is written, so
            # the key stays unreserved for the executing command.
            ledger = SqliteAttemptLedger(ledger_db)
            reservation = ledger.find(key)
        except AttemptLedgerUnavailable as error:
            checks.append((
                "ledger_openable",
                False,
                f"attempt ledger unavailable: {error}",
            ))
    checks.append((
        "ledger_path_explicit_and_outside_repository",
        not path_refusals and ledger_db is not None,
        () if not path_refusals and ledger_db is not None
        else tuple(r.value for r in path_refusals) or ("LEDGER_PATH_MISSING",),
    ))
    checks.append((
        "no_existing_reservation",
        reservation is None,
        "idempotency key is free (inspected, not reserved)"
        if reservation is None
        else f"already reserved in state {reservation.get('state')}",
    ))

    report = {
        "mode": "preflight",
        "ok": all(ok for _, ok, _ in checks),
        "checks": [
            {"name": name, "ok": ok, "detail": detail}
            for name, ok, detail in checks
        ],
        "recipient": masked,
        "network_requests": 0,
        "calls_placed": 0,
    }
    return report


def probe_auth(
    *,
    env: Optional[Mapping[str, str]] = None,
    client_factory: Optional[Callable[[], Any]] = None,
    python_version_info: Optional[tuple[int, ...]] = None,
    sdk_imports: Optional[bool] = None,
) -> dict[str, Any]:
    """One authenticated not-found read. Zero dials, zero creations."""

    source = _env(env)
    gates = _common_gates(source, python_version_info, sdk_imports)
    if not all(ok for _, ok, _ in gates):
        return {
            "mode": "probe-auth",
            "refused": True,
            "stage": "GATES",
            "checks": [
                {"name": name, "ok": ok, "detail": detail}
                for name, ok, detail in gates
            ],
            "calls_created": 0,
        }

    config = load_config(source)
    if client_factory is not None:
        context = client_factory()
    else:
        from calle import CalleClient

        context = CalleClient(
            api_key=config.api_key or "", base_url=config.base_url, timeout=30.0
        )
    with context as client:
        try:
            client.calls.get(PROBE_CALL_ID)
        except Exception as error:
            status = getattr(error, "status_code", None)
            if status == 404:
                return {
                    "mode": "probe-auth",
                    "outcome": "AUTHENTICATED_NOT_FOUND",
                    "http_status": 404,
                    "calls_created": 0,
                }
            if status in (401, 403):
                return {
                    "mode": "probe-auth",
                    "refused": True,
                    "reasons": ["AUTHENTICATION_REFUSED"],
                    "http_status": status,
                    "calls_created": 0,
                }
            label = type(error).__name__
            return {
                "mode": "probe-auth",
                "refused": True,
                "reasons": ["UNEXPECTED_RESPONSE"],
                "error_class": label,
                "http_status": status if isinstance(status, int) else None,
                "calls_created": 0,
            }
        return {
            "mode": "probe-auth",
            "refused": True,
            "reasons": ["UNEXPECTED_RESPONSE"],
            "detail": "a nonexistent call id returned success",
            "calls_created": 0,
        }


#: The call id a contract check reads when no recorded one is supplied: the
#: deterministic known-nonexistent id (one ``calls.get``, zero creates).
CONTRACT_CALL_ID_ENV = "WARRANTYOPS_CONTRACT_CALL_ID"

#: Speaker labels the transcript-consuming layers understand.
_SPEAKER_LABELS = frozenset({"bot", "user", "unknown"})


def _call_shape_checks(payload: Any) -> list[Check]:
    """Structural checks of a ``calls.get`` payload against the contract.

    Deliberately shallow and additive: these pin the surface the adapter
    depends on (object type, documented statuses, recipients/attempts/
    transcript shape, a structured-result key) so drift at the provider is
    named at contract time instead of discovered mid-run.
    """

    body = payload if isinstance(payload, Mapping) else {}
    checks: list[Check] = []

    checks.append((
        "object_is_call_task",
        body.get("object") == "call_task",
        f"object: {body.get('object')!r}",
    ))

    status = body.get("status")
    checks.append((
        "status_documented",
        isinstance(status, str) and status in KNOWN_SDK_STATUSES,
        f"status: {status!r}",
    ))

    recipients = body.get("recipients")
    recipient_ok = isinstance(recipients, list) and bool(recipients)
    checks.append((
        "recipients_listed",
        recipient_ok,
        f"{len(recipients) if isinstance(recipients, list) else 0} recipient(s)",
    ))

    speakers: set[str] = set()
    turns_seen = False
    if isinstance(recipients, list):
        for recipient in recipients:
            attempts = (
                recipient.get("attempts")
                if isinstance(recipient, Mapping)
                else None
            )
            if not isinstance(attempts, list):
                continue
            for attempt in attempts:
                turns = (
                    attempt.get("transcript_turns")
                    if isinstance(attempt, Mapping)
                    else None
                )
                if not isinstance(turns, list):
                    continue
                for turn in turns:
                    if isinstance(turn, Mapping) and "speaker" in turn:
                        turns_seen = True
                        speaker = turn.get("speaker")
                        if isinstance(speaker, str):
                            speakers.add(speaker)
    checks.append((
        "transcript_turns_labeled",
        turns_seen and speakers <= _SPEAKER_LABELS,
        f"speakers: {sorted(speakers) if speakers else 'none'}",
    ))

    checks.append((
        "structured_result_key_present",
        "structured_result" in body,
        "key present" if "structured_result" in body else "key absent",
    ))
    return checks


def contract_live_check(
    *,
    env: Optional[Mapping[str, str]] = None,
    client_factory: Optional[Callable[[], Any]] = None,
    python_version_info: Optional[tuple[int, ...]] = None,
    sdk_imports: Optional[bool] = None,
    call_id: Optional[str] = None,
) -> dict[str, Any]:
    """An env-gated, GET-only contract check. Zero dials, zero creates.

    Reads one call — the deterministic known-nonexistent id by default, or a
    recorded id via ``WARRANTYOPS_CONTRACT_CALL_ID`` — and reports the
    payload's structural agreement with the contract the adapter assumes.
    There is no create path in this function, by construction: the only SDK
    method it can reach is ``calls.get``.
    """

    source = _env(env)
    # A contract read has no called party, so the recipient check is dropped
    # from the shared gates; the origin check joins them instead, because a
    # GET against an unofficial origin is not a contract check.
    gates = [
        gate for gate in _common_gates(source, python_version_info, sdk_imports)
        if gate[0] != "recipient_env_valid_e164"
    ]
    config = load_config(source)
    origin_refusals = [
        refusal.value
        for refusal in live_call_refusals(config)
        if refusal is ConfigRefusal.UNOFFICIAL_ORIGIN
    ]
    gates.append((
        "official_origin",
        not origin_refusals,
        () if not origin_refusals else tuple(origin_refusals),
    ))
    if not all(ok for _, ok, _ in gates):
        return {
            "mode": "contract-live",
            "refused": True,
            "stage": "GATES",
            "checks": [
                {"name": name, "ok": ok, "detail": detail}
                for name, ok, detail in gates
            ],
            "calls_created": 0,
        }

    target = call_id or source.get(CONTRACT_CALL_ID_ENV) or PROBE_CALL_ID
    if client_factory is not None:
        context = client_factory()
    else:
        from calle import CalleClient

        context = CalleClient(
            api_key=config.api_key or "", base_url=config.base_url, timeout=30.0
        )
    with context as client:
        try:
            payload = client.calls.get(target)
        except Exception as error:
            status = getattr(error, "status_code", None)
            if status == 404:
                return {
                    "mode": "contract-live",
                    "refused": False,
                    "outcome": "AUTHENTICATED_NOT_FOUND",
                    "call_id": mask_call_id(target),
                    "http_status": 404,
                    "shape_checks": [
                        {
                            "name": "shape_not_checked",
                            "ok": None,
                            "detail": (
                                "the default id is known-nonexistent; supply "
                                f"{CONTRACT_CALL_ID_ENV} with a recorded id "
                                "for full shape validation"
                            ),
                        }
                    ],
                    "calls_created": 0,
                }
            if status in (401, 403):
                return {
                    "mode": "contract-live",
                    "refused": True,
                    "reasons": ["AUTHENTICATION_REFUSED"],
                    "http_status": status,
                    "calls_created": 0,
                }
            return {
                "mode": "contract-live",
                "refused": True,
                "reasons": ["UNEXPECTED_RESPONSE"],
                "error_class": type(error).__name__,
                "http_status": status if isinstance(status, int) else None,
                "calls_created": 0,
            }
        shape = _call_shape_checks(payload)
        return {
            "mode": "contract-live",
            "refused": False,
            "outcome": "READ",
            "call_id": mask_call_id(target),
            "shape_checks": [
                {"name": name, "ok": ok, "detail": detail}
                for name, ok, detail in shape
            ],
            "shape_ok": all(ok for _, ok, _ in shape),
            "calls_created": 0,
        }


def execute_live_call(
    *,
    env: Optional[Mapping[str, str]] = None,
    ledger_db: Optional[Path] = None,
    confirm_consenting_recipient: bool = False,
    confirm_phrase: Optional[str] = None,
    client_factory: Optional[Callable[[], Any]] = None,
    polling: Optional[PollingConfig] = None,
    python_version_info: Optional[tuple[int, ...]] = None,
    sdk_imports: Optional[bool] = None,
    now: Optional[datetime] = None,
    on: Optional[date] = None,
) -> dict[str, Any]:
    """The live runtime proof. Refuses before ``calls.create`` on any gap."""

    source = _env(env)
    moment = now or datetime.now(timezone.utc)
    today = on or date.today()

    requirements: list[str] = []
    if not confirm_consenting_recipient:
        requirements.append("MISSING_CONFIRM_CONSENTING_RECIPIENT_FLAG")
    if confirm_phrase != CONFIRMATION_PHRASE:
        requirements.append("CONFIRMATION_PHRASE_MISMATCH")
    # The kill switch and its siblings are entry gates here, not just the
    # provider seam: a misconfigured run must refuse before it reserves the
    # idempotency key, or a switch-off attempt would burn the reservation.
    requirements.extend(
        refusal.value for refusal in live_call_refusals(load_config(source))
    )
    path_refusals = ledger_path_refusals(ledger_db)
    if ledger_db is None:
        requirements.append("MISSING_LEDGER_DB")
    elif path_refusals:
        requirements.extend(r.value for r in path_refusals)

    gates = _common_gates(source, python_version_info, sdk_imports)
    gates_ok = all(ok for _, ok, _ in gates)
    if requirements or not gates_ok:
        return {
            "mode": "execute-live-call",
            "refused": True,
            "stage": "REQUIREMENTS",
            "reasons": requirements or [],
            "checks": [
                {"name": name, "ok": ok, "detail": detail}
                for name, ok, detail in gates
            ],
            "calls_placed": 0,
        }

    recipient = _raw_recipient(source)
    _, masked = _recipient_state(source)
    claim = canonical_source_claim(recipient)
    authorization = canonical_authorization(recipient, moment)

    config = load_config(source)
    decision = authorize_call(
        authorization, requested_purpose=PURPOSE, now=moment
    )

    try:
        # The requirements gate above appended MISSING_LEDGER_DB when the
        # path is absent, so reaching here means one was supplied.
        assert ledger_db is not None
        ledger = SqliteAttemptLedger(ledger_db)
    except AttemptLedgerUnavailable as error:
        return {
            "mode": "execute-live-call",
            "refused": True,
            "stage": "LEDGER",
            "reasons": [LedgerRefusal.ATTEMPT_LEDGER_UNAVAILABLE.value],
            "detail": str(error),
            "calls_placed": 0,
        }

    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    provider = CalleCallProvider(
        config=config,
        authorization=decision,
        polling=polling or PollingConfig(),
        client_factory=client_factory,
    )
    try:
        run = run_exception(
            claim,
            authorization,
            provider,
            version_reader=store,
            attempt_ledger=ledger,
            namespace=config.idempotency_namespace,
            now=moment,
            on=today,
            allowlist=frozenset({recipient}),
        )
    except Exception as error:
        return {
            "mode": "execute-live-call",
            "refused": True,
            "stage": "RUNTIME",
            "reasons": [type(error).__name__],
            "detail": "the attempt needs manual reconciliation; the durable "
            "reservation is retained",
            "calls_placed": provider.calls_placed,
        }

    key = run.idempotency_key
    if run.refusal is not None:
        report = {
            "mode": "execute-live-call",
            "refused": True,
            "stage": "WORKFLOW",
            "gate": run.refusal.gate.value,
            "reasons": list(run.refusal.reasons),
            "details": run.refusal.details,
            "recipient": masked,
            # A run refused before key derivation has no reservation to
            # report; the empty lookup says exactly that.
            "ledger_state": (
                (ledger.find(key) or {}).get("state") if key is not None else None
            ),
            "write_back": WRITE_BACK_TOKEN,
            "calls_placed": provider.calls_placed,
        }
        return report

    # CaseRun is exclusive by construction: a run either refused (returned
    # above) or produced an outcome. The dataclass type cannot express that;
    # this assertion states it for the receipt construction below.
    assert run.outcome is not None
    outcome = run.outcome
    packet = prepare_review(outcome, recipient)
    reservation = (ledger.find(key) or {}) if key is not None else {}
    receipt = _runtime_receipt(
        mode="execute-live-call",
        outcome=outcome,
        masked_recipient=masked,
        reservation=reservation,
        source_version=claim.source_version,
        audit_chain_head=(
            ledger.audit_chain_head(key) if key is not None else None
        ),
    )
    receipt["refused"] = False
    receipt["identifier_state"] = (
        outcome.identifier.state.value if outcome.identifier else None
    )
    receipt["review_id"] = packet.review_id
    receipt["calls_placed"] = provider.calls_placed
    return _persist_receipt(receipt, config.artifact_dir)


def recover_runtime_result(
    *,
    env: Optional[Mapping[str, str]] = None,
    ledger_db: Optional[Path] = None,
    client_factory: Optional[Callable[[], Any]] = None,
    python_version_info: Optional[tuple[int, ...]] = None,
    sdk_imports: Optional[bool] = None,
    now: Optional[datetime] = None,
    on: Optional[date] = None,
) -> dict[str, Any]:
    """Re-read the already-placed runtime-proof call and rebuild the receipt.

    This is a read of the existing CALL-E record, not a telephone call:
    ``calls.get`` on the id the durable ledger stored, never
    ``calls.create``, never a second dial. The ledger reservation is left
    exactly as it was — recovery only reads it.
    """

    source = _env(env)
    moment = now or datetime.now(timezone.utc)

    requirements: list[str] = []
    if ledger_db is None:
        requirements.append("MISSING_LEDGER_DB")
    else:
        requirements.extend(r.value for r in ledger_path_refusals(ledger_db))
    gates = _common_gates(source, python_version_info, sdk_imports)
    if requirements or not all(ok for _, ok, _ in gates):
        return {
            "mode": "recover-runtime-result",
            "refused": True,
            "stage": "REQUIREMENTS",
            "reasons": requirements,
            "checks": [
                {"name": name, "ok": ok, "detail": detail}
                for name, ok, detail in gates
            ],
            "calls_created": 0,
        }

    recipient = _raw_recipient(source)
    _, masked = _recipient_state(source)
    claim = canonical_source_claim(recipient)
    authorization = canonical_authorization(recipient, moment)
    key = _derivation_key(source, claim, authorization)

    try:
        # MISSING_LEDGER_DB was appended above when the path is absent, so
        # reaching here means one was supplied.
        assert ledger_db is not None
        ledger = SqliteAttemptLedger(ledger_db)
    except AttemptLedgerUnavailable as error:
        return {
            "mode": "recover-runtime-result",
            "refused": True,
            "stage": "LEDGER",
            "reasons": [LedgerRefusal.ATTEMPT_LEDGER_UNAVAILABLE.value],
            "detail": str(error),
            "calls_created": 0,
        }

    reservation = ledger.find(key)
    existing_call_id = (reservation or {}).get("call_id")
    if reservation is None or not existing_call_id:
        return {
            "mode": "recover-runtime-result",
            "refused": True,
            "stage": "LEDGER",
            "reasons": ["NO_CALL_ID_TO_RECOVER"],
            "detail": "the reservation holds no call id to retrieve",
            "ledger_state": (reservation or {}).get("state"),
            "calls_created": 0,
        }

    config = load_config(source)
    if client_factory is not None:
        context = client_factory()
    else:
        from calle import CalleClient

        context = CalleClient(
            api_key=config.api_key or "", base_url=config.base_url, timeout=30.0
        )
    with context as client:
        try:
            payload = client.calls.get(existing_call_id)
        except Exception as error:
            status = getattr(error, "status_code", None)
            label = type(error).__name__
            return {
                "mode": "recover-runtime-result",
                "refused": True,
                "stage": "RETRIEVAL",
                "reasons": ["EXISTING_CALL_READ_FAILED"],
                "error_class": label,
                "http_status": status if isinstance(status, int) else None,
                "ledger_state": reservation.get("state"),
                "calls_created": 0,
            }

    transport = TransportOutcome(
        state=TransportState(payload.get("status", "in_progress")),
        call_id=payload.get("id") or existing_call_id,
        diagnostic_failure_code=payload.get("failure_code"),
        diagnostic_failure_message=payload.get("failure_message"),
    )
    transcript = attempt_transcript(payload, recipient)
    validation = validate_structured_result(
        payload.get("structured_result"), build_extraction_schema()
    )
    outcome = derive_outcome(
        transport,
        validation,
        transcript=transcript or None,
        expected_reference_pattern=DEFAULT_REFERENCE_PATTERN,
    )
    receipt = _runtime_receipt(
        mode="recover-runtime-result",
        outcome=outcome,
        masked_recipient=masked,
        reservation=reservation,
        source_version=claim.source_version,
        audit_chain_head=ledger.audit_chain_head(key),
    )
    receipt["refused"] = False
    receipt["ledger_reservation_untouched"] = True
    receipt["calls_created"] = 0
    return _persist_receipt(receipt, config.artifact_dir)
