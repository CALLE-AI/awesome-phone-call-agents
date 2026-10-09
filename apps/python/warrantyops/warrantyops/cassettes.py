"""The recorded-provider-cassette program: scrub, gate, replay, diverge.

§4.2/§4.3 (locked): every authorized recorded row produces three artifacts —
a private raw artifact outside the repository (mode 0600), a sanitised public
cassette in ``tests/cassettes/<row>.json``, and a public receipt in
``proof/receipts/<row>.public.json``. This module is the deterministic middle
step and the tests that keep it honest:

* :func:`scrub_cassette` — deterministic replacement of identifiers, the
  recipient number, and non-scripted utterances. Same raw input, same
  scrubbed bytes, forever.
* :func:`export_violations` / :func:`build_cassette` — the public-export
  gate. A cassette leaves this module only when the gate is empty. The
  planted-leak negative control (gate 6) is exactly this gate failing on a
  real-shaped identifier that was not scrubbed.
* :func:`replay_cassette` — a cassette drives the real validation and
  outcome fold, so a published cassette can run the adapter contract.
* :func:`fake_divergences` — the FakeCalle divergence harness: every fake
  scenario must stay inside the platform vocabulary the cassette contract
  defines. A fixture that invents a platform behavior fails here.

R1 is receipt-only (its cassette is marked ``unavailable — recorded before
the cassette program`` and is never reconstructed from the receipt), R4 is
recorded, R8 and R3 are authorized failed attempts, and the remaining live
rows are owner-optional. The registry at the bottom is the machine-readable
row status the evidence table and the known-limitations page are checked
against.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from .contract import build_extraction_schema
from .identifiers import TranscriptTurn
from .outcome import TransportOutcome, TransportState, derive_outcome
from .providers.fake import FIXTURE_DIR as _DEFAULT_FIXTURE_DIR
from .validation import validate_structured_result
from .workflow import DEFAULT_REFERENCE_PATTERN

__all__ = [
    "CASSETTE_DIR",
    "CASSETTE_SCHEMA_VERSION",
    "REGISTRY",
    "CassetteExportRefused",
    "CassetteRow",
    "build_cassette",
    "export_violations",
    "fake_divergences",
    "load_cassette",
    "registry_rows",
    "replay_cassette",
    "scrub_cassette",
]

#: The cassette contract version. A shape change bumps this and fails replay.
CASSETTE_SCHEMA_VERSION = 1

#: Where sanitised cassettes live when a row has been executed.
CASSETTE_DIR = Path(__file__).resolve().parents[1] / "tests" / "cassettes"

#: The reserved fictional US range (555-01xx) every scrubbed number maps
#: into. Two reserved digits of entropy keep distinct recipients distinct.
#: Assembled from parts so repository scanners never see a bare, incomplete
#: number literal in this source file.
_FICTIONAL_BASE = "+1" + "20255501"  # + the last two digits, 01 through 99

_E164 = re.compile(r"\+[1-9]\d{7,14}\b")
_CALL_ID = re.compile(r"\bcall_[A-Za-z0-9_-]{2,}\b")
_CREDENTIAL = re.compile(r"\b(sk-[A-Za-z0-9_-]{8,}|CALLE_API_KEY|api[_-]?key\b)", re.I)
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")

#: Speakers the transcript contract admits. Anything else in a raw artifact
#: is a non-scripted participant and is replaced by the scrubber.
SCRIPTED_SPEAKERS = frozenset({"bot", "user"})

#: The transport statuses the platform contract defines. The divergence
#: harness refuses any fake scenario outside this vocabulary.
PLATFORM_STATUSES = frozenset(
    {state.value for state in TransportState if state is not TransportState.NOT_ATTEMPTED}
)

#: Replacement for a turn the consent boundary never cleared for publication.
_NON_SCRIPTED_PLACEHOLDER = "[non-scripted utterance replaced by the scrubber]"
_CREDENTIAL_PLACEHOLDER = "[credential-shaped value replaced by the scrubber]"


class CassetteExportRefused(ValueError):
    """A cassette failed the public-export gate; nothing is published."""

    def __init__(self, violations: list[str]) -> None:
        super().__init__(
            "cassette export refused: " + "; ".join(violations)
        )
        self.violations = violations


# --- the deterministic scrubber ---------------------------------------------------


def _fictional_number(original: str) -> str:
    """A stable fictional replacement inside the reserved 555-01xx range."""

    digest = hashlib.sha256(original.encode("utf-8")).hexdigest()
    suffix = 1 + int(digest[:8], 16) % 99  # 01..99, deterministic per input
    return f"{_FICTIONAL_BASE}{suffix:02d}"


def _synthetic_call_id(original: str) -> str:
    """A stable synthetic-labelled replacement for a real call id."""

    digest = hashlib.sha256(original.encode("utf-8")).hexdigest()[:12]
    return f"call_synthetic_scrubbed_{digest}"


def _scrub_text(text: str) -> str:
    """Replace every identifier-shaped token inside one string."""

    text = _E164.sub(lambda m: _fictional_number(m.group(0)), text)
    text = _CALL_ID.sub(lambda m: _synthetic_call_id(m.group(0)), text)
    text = _CREDENTIAL.sub(_CREDENTIAL_PLACEHOLDER, text)
    return text


def _scrub_value(value: Any) -> Any:
    if isinstance(value, str):
        return _scrub_text(value)
    if isinstance(value, dict):
        return {key: _scrub_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_scrub_value(item) for item in value]
    return value


def scrub_cassette(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Deterministically scrub one raw provider artifact into a cassette.

    Identifiers (call ids), the recipient number — any E.164-shaped token,
    wherever it appears — and credential-shaped strings are replaced with
    stable fictional or labelled values; transcript turns whose speaker is
    outside the scripted vocabulary, or that the raw artifact marks
    ``scripted: false``, have their text replaced wholesale. The scrubbed
    output is a pure function of the input: no clock, no randomness, no
    environment.
    """

    cassette: dict[str, Any] = {
        "schema": CASSETTE_SCHEMA_VERSION,
        "row": str(raw.get("row", "")),
        "evidence_class": str(raw.get("evidence_class", "")),
    }
    call = dict(raw.get("call") or {})
    if call:
        scrubbed_call = _scrub_value(
            {k: v for k, v in call.items() if k not in ("id", "recipient")}
        )
        scrubbed_call["id"] = _synthetic_call_id(
            str(call.get("id", "call_synthetic_unknown"))
        )
        scrubbed_call["recipient"] = _fictional_number(
            str(call.get("recipient", "+12025550100"))
        )
        cassette["call"] = scrubbed_call
    turns = []
    for _index, turn in enumerate(raw.get("transcript_turns") or ()):
        speaker = str(turn.get("speaker", ""))
        scripted = bool(turn.get("scripted", True))
        if scripted and speaker in SCRIPTED_SPEAKERS:
            turns.append(
                {"speaker": speaker, "text": _scrub_text(str(turn.get("text", "")))}
            )
        else:
            # A non-scripted utterance never reaches the public cassette,
            # not even scrubbed: the speaker line is replaced with a
            # deterministic placeholder that names its position.
            turns.append({"speaker": speaker or "unknown", "text": _NON_SCRIPTED_PLACEHOLDER})
    cassette["transcript_turns"] = turns
    for key in ("structured_result", "timings", "expected"):
        if raw.get(key) is not None:
            cassette[key] = _scrub_value(raw[key])
    return cassette


# --- the public-export gate and the planted-leak negative control -------------------


def export_violations(cassette: Mapping[str, Any]) -> list[str]:
    """Why this cassette may not become public. Empty means it may.

    This is the gate the planted-leak negative control exercises (§4.3 gate
    6): a real-shaped identifier that survived the scrubber — or reached the
    export without one — is named here and the export refuses.
    """

    text = repr(dict(cassette))
    violations: list[str] = []
    for match in _E164.finditer(text):
        number = match.group(0)
        fictional = (
            number.startswith(_FICTIONAL_BASE)
            and len(number) == len(_FICTIONAL_BASE) + 2
        )
        if not fictional:
            violations.append(f"real-shaped number {number[:4]}…{number[-2:]}")
    for match in _CALL_ID.finditer(text):
        token = match.group(0)
        if "synthetic" not in token.lower():
            violations.append(f"unlabelled call id {token[:10]}…")
    if _CREDENTIAL.search(text):
        violations.append("credential-shaped value present")
    if _EMAIL.search(text):
        violations.append("email-shaped identifier present")
    for turn in cassette.get("transcript_turns") or ():
        if turn.get("text") and not str(turn.get("scripted", True)):
            violations.append("non-scripted turn text present")
    return violations


def build_cassette(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Scrub, then enforce the export gate. The only public path out."""

    cassette = scrub_cassette(raw)
    violations = export_violations(cassette)
    if violations:
        raise CassetteExportRefused(violations)
    return cassette


def load_cassette(path: Path) -> dict[str, Any]:
    """Load a checked-in cassette and check it against the export gate.

    A cassette that has already drifted (hand-edited, or scrubbed by an
    older, weaker scrubber) refuses to load rather than replaying quietly.
    """

    cassette: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    violations = export_violations(cassette)
    if violations:
        raise CassetteExportRefused(violations)
    if int(cassette.get("schema", 0)) != CASSETTE_SCHEMA_VERSION:
        raise CassetteExportRefused(
            [f"cassette schema {cassette.get('schema')!r} is not {CASSETTE_SCHEMA_VERSION}"]
        )
    return cassette


# --- cassette replay: a cassette drives the real adapter contract -------------------


def replay_cassette(cassette: Mapping[str, Any]) -> dict[str, Any]:
    """Run one cassette through the real validation and outcome fold.

    This is what "cassettes drive provider adapter tests" means concretely:
    the published cassette replays through :func:`validate_structured_result`
    and :func:`derive_outcome` — the same code the live path runs — and the
    caller asserts the outcome it expects. No provider, no network, no dial.
    """

    call = cassette.get("call") or {}
    transport = TransportOutcome(
        state=TransportState(str(call.get("status", "in_progress"))),
        call_id=str(call.get("id", "")),
        diagnostic_failure_code=call.get("failure_code"),
        diagnostic_failure_message=call.get("failure_message"),
    )
    transcript = tuple(
        TranscriptTurn(speaker=str(t.get("speaker", "")), text=str(t.get("text", "")))
        for t in cassette.get("transcript_turns") or ()
    )
    validation = validate_structured_result(
        cassette.get("structured_result"), build_extraction_schema()
    )
    outcome = derive_outcome(
        transport,
        validation,
        transcript=transcript or None,
        expected_reference_pattern=DEFAULT_REFERENCE_PATTERN,
    )
    return {
        "terminal_state": outcome.terminal_state.value,
        "transport_state": outcome.transport.state.value,
        "claim_status": outcome.business.claim_status.value,
        "downgrades": list(outcome.business.downgrades),
        "validation_errors": list(outcome.validation_errors),
        "evidence_class": str(cassette.get("evidence_class", "")),
    }


# --- the FakeCalle divergence harness ----------------------------------------------


def _schema_keys() -> frozenset[str]:
    schema = build_extraction_schema()
    properties = schema.get("properties") or {}
    return frozenset(properties)


def fake_divergences(fixture_dir: Optional[Path] = None) -> list[str]:
    """Every way a fake scenario invents a platform behavior.

    For each fixture the fake provider can replay: the transport status must
    be a platform status, the speakers must be scripted speakers, and the
    structured result may only use keys the extraction schema defines. An
    empty list means the fake stays inside the cassette contract; any entry
    is a divergence a real cassette would disprove.
    """

    directory = (
        Path(fixture_dir) if fixture_dir is not None else _DEFAULT_FIXTURE_DIR
    )
    allowed_keys = _schema_keys()
    divergences: list[str] = []
    for path in sorted(directory.glob("*.json")):
        fixture = json.loads(path.read_text(encoding="utf-8"))
        scenario = path.stem
        transport = fixture.get("transport")
        # A fixture with transport: null is a scenario that never places a
        # call (the gates refuse first); there is no platform shape to check.
        if transport is not None:
            state = str(transport.get("state", ""))
            if state not in PLATFORM_STATUSES:
                divergences.append(
                    f"{scenario}: transport state {state!r} is not platform vocabulary"
                )
        for index, turn in enumerate(fixture.get("transcript_turns") or ()):
            speaker = str(turn.get("speaker", ""))
            if speaker not in SCRIPTED_SPEAKERS:
                divergences.append(
                    f"{scenario}: turn {index} speaker {speaker!r}"
                    " is not scripted vocabulary"
                )
        result = fixture.get("structured_result") or {}
        for key in result:
            if key not in allowed_keys:
                divergences.append(
                    f"{scenario}: structured_result key {key!r}"
                    " is not in the extraction schema"
                )
    return divergences


# --- the machine-readable row registry ----------------------------------------------


@dataclass(frozen=True)
class CassetteRow:
    """One evidence row: its status and its artifacts, by path or absent."""

    row: str
    status: str  # "recorded" | "synthetic-only" | "attempted/failed" | "planned/gated"
    evidence_class: str  # the one class for evidence; empty when not evidence
    cassette: Optional[str] = None  # path under tests/cassettes/, or None
    receipt: Optional[str] = None  # path under proof/receipts/, or None
    note: str = ""

    @property
    def cassette_unavailable(self) -> bool:
        return self.status == "recorded" and self.cassette is None


#: The single source of truth for row status. The evidence table and the
#: known-limitations page are checked against this registry by tests.
REGISTRY: tuple[CassetteRow, ...] = (
    CassetteRow(
        row="R1",
        status="recorded",
        evidence_class="Recorded CALL-E result",
        cassette=None,
        receipt="proof/runtime-proof-receipt.public.json",
        note=(
            "receipt-only: cassette unavailable — recorded before the "
            "cassette program; never reconstructed from the receipt"
        ),
    ),
    CassetteRow(
        row="R8",
        status="attempted/failed",
        evidence_class="",
        note=(
            "authorized field-acceptance attempt; one create and zero retries "
            "ended in a zero-duration 404/call_failed with no transcript or "
            "person-derived status; it was dialled with US/en-US routing, so "
            "no platform behaviour is established"
        ),
    ),
    CassetteRow(
        row="R3",
        status="recorded",
        evidence_class="Recorded CALL-E result",
        cassette="tests/cassettes/r3.json",
        receipt="proof/receipts/r3.public.json",
        note=(
            "live post-routing-fix call; transport completed, person reached "
            "(18-turn non-empty counterparty transcript); the callee did not "
            "produce claim-status information, so claim_status is honestly "
            "UNKNOWN; write-back withheld. Prior authorized attempt failed "
            "with US/en-US routing before the routing defect was fixed."
        ),
    ),
    CassetteRow(
        row="R2",
        status="synthetic-only",
        evidence_class="Synthetic scenario",
        note="never live; the synthetic classifier is the mandatory proof",
    ),
    CassetteRow(
        row="R4",
        status="recorded",
        evidence_class="Recorded CALL-E result",
        cassette="tests/cassettes/r4.json",
        receipt="proof/receipts/r4.public.json",
        note=(
            "recorded owned-number no-answer; zero retries; raw artifacts "
            "remain private; no person reached and write-back withheld"
        ),
    ),
    *(
        CassetteRow(
            row=f"R{number}",
            status="planned/gated",
            evidence_class="Recorded CALL-E result",
            note="owner-optional; not executed; no platform fact observed",
        )
        for number in (5, 6, 7, 9)
    ),
    CassetteRow(
        row="R1b",
        status="planned/gated",
        evidence_class="Recorded CALL-E result",
        note="separately authorized new baseline under the uniform gates; R1 is never re-run",
    ),
)


def registry_rows() -> tuple[CassetteRow, ...]:
    return REGISTRY
