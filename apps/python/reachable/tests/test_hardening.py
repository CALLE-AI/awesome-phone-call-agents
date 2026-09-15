"""Hardening: concurrency, crash recovery, and repository hygiene.

These are the tests that check the app behaves under conditions nobody arranges
on purpose -- two clicks at once, a process killed mid-call, a fixture that
quietly acquires a real phone number.
"""

from __future__ import annotations

import re
import threading
from pathlib import Path

import pytest

from fake_calle.scripts import SCRIPTS
from reachable.config import Config
from reachable.models import AttemptState, ContactCheckState, NoCallReason, PatternState
from reachable.orchestrator import Orchestrator
from reachable.phone import is_e164, is_reserved_number
from reachable.store import Store

from .conftest import APP_ROOT, SCHOOL_DAY_IN_WINDOW

IVY_CASE = "PF-P-1041-2026-09-11"
CC_CASE = "CC-2026-autumn-C-2088"


# ===========================================================================
# Concurrency
# ===========================================================================


def test_eight_simultaneous_clicks_place_exactly_one_call(live, fake_client):
    """The dashboard serves requests across threads; a double-click must not dial twice.

    Before the orchestrator held a lock across guard-check-then-reserve, every
    thread could pass guard 6 before any wrote an attempt row, and only the
    UNIQUE constraint on the idempotency key stopped a second dial -- by raising
    an IntegrityError the operator would see as a 500, with no way to tell
    whether a call had happened.
    """
    live.scan_register()
    threads_count = 8
    ready = threading.Barrier(threads_count)
    placed: list[bool] = []
    reasons: list[str] = []
    errors: list[str] = []

    def dial() -> None:
        ready.wait()
        try:
            outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
            placed.append(outcome.placed)
            if not outcome.placed and outcome.reason:
                reasons.append(outcome.reason.value)
        except Exception as exc:  # noqa: BLE001 - the thing under test
            errors.append(f"{type(exc).__name__}: {exc}")

    threads = [threading.Thread(target=dial) for _ in range(threads_count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)

    assert errors == []
    assert sum(1 for p in placed if p) == 1
    assert len(fake_client.state.requests) == 1
    assert len(live.store.rows("SELECT 1 FROM call_attempts")) == 1
    # Every loser is refused by name, not by exception.
    assert set(reasons) == {NoCallReason.CALL_IN_PROGRESS.value}


def test_a_duplicate_reservation_is_a_named_refusal_not_a_crash(live):
    """Honouring reserve_key's return value rather than ignoring it."""
    live.scan_register()
    request, contact, pupil, key = live.build_request(IVY_CASE)
    from reachable.models import Workflow
    from reachable.store import intent_digest

    live.store.reserve_key(
        key,
        workflow=Workflow.PATTERN_FOLLOWUP,
        case_id=IVY_CASE,
        pupil_id=pupil.pupil_id,
        contact_id=contact.contact_id,
        digest=intent_digest(
            case_id=IVY_CASE,
            workflow="pattern_followup",
            pupil=pupil.pupil_id,
            contact=contact.contact_id,
            destination=contact.phone_e164,
        ),
    )
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    assert not outcome.placed
    # Guard 9 sees the reservation first and names it precisely. The `not fresh`
    # branch inside _reserve is defence in depth for the concurrent case, where
    # guard 9 legitimately passed because nothing was reserved yet.
    assert outcome.reason is NoCallReason.IDEMPOTENCY_KEY_USED


def test_the_lock_is_not_held_across_the_network_call(live):
    """Holding it would serialise every dial in the building behind one slow call."""
    source = (APP_ROOT / "reachable" / "orchestrator.py").read_text(encoding="utf-8")
    block = source[source.index("def place_call") : source.index("def _reserve")]
    lock_line = block.index("with self._lock:")
    create_line = block.index("self.client.create(request)")
    assert lock_line < create_line
    # The lock block contains only the reservation call.
    locked = block[lock_line : block.index("if isinstance(reserved, CallOutcome)")]
    assert "self.client.create" not in locked


# ===========================================================================
# Crash recovery
# ===========================================================================


def test_a_process_killed_mid_call_resumes_by_reading_not_redialling(
    store, live_env, fake_client, fake_state
):
    """The whole point of create-then-poll rather than create_and_wait."""
    first = Orchestrator(
        store=store,
        config=Config.from_env(live_env),
        client=fake_client,
        clock=lambda: SCHOOL_DAY_IN_WINDOW,
    )
    first.import_data()
    first.start_contact_check()
    request, *_ = first.build_request(CC_CASE)
    fake_state.queue(request.idempotency_key, "timeout_then_complete")
    first.place_call(CC_CASE, confirmed=True)
    submitted = len(fake_client.state.requests)
    assert store.case(CC_CASE)["state"] == ContactCheckState.CC_IN_FLIGHT.value

    # The process dies here. A new orchestrator over the same database.
    second = Orchestrator(
        store=store,
        config=Config.from_env(live_env),
        client=fake_client,
        clock=lambda: SCHOOL_DAY_IN_WINDOW,
    )
    second.import_data()
    second.resume()
    second.resume()

    assert len(fake_client.state.requests) == submitted, "a restart must not redial"
    assert store.case(CC_CASE)["state"] == ContactCheckState.CC_VERIFIED.value


def test_an_unknown_submission_blocks_the_case_until_a_person_resolves_it(
    live, fake_state, fake_client
):
    live.scan_register()
    fake_state.fail_submission = "unknown"
    live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    assert live.store.case(IVY_CASE)["state"] == PatternState.PF_CALL_UNVERIFIED.value

    attempt = live.store.rows("SELECT * FROM call_attempts")[0]
    assert attempt["state"] == AttemptState.SUBMISSION_UNKNOWN.value
    assert not attempt["call_id"]

    # Resume cannot resolve it: there is no call id to read back.
    fake_state.fail_submission = None
    live.resume()
    assert fake_client.state.requests == []

    # And a further dial is refused rather than guessed.
    blocked = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    assert blocked.reason is NoCallReason.CALL_IN_PROGRESS
    reasons = [e["reason"] for e in live.store.events_for(IVY_CASE)]
    assert any("a person must reconcile" in r for r in reasons)


def test_state_survives_closing_and_reopening_the_database(tmp_path, live_env, fake_client):
    path = tmp_path / "persist.sqlite3"
    first = Orchestrator(
        store=Store.open(path),
        config=Config.from_env(live_env),
        client=fake_client,
        clock=lambda: SCHOOL_DAY_IN_WINDOW,
    )
    first.import_data()
    first.scan_register()
    before = first.store.case(IVY_CASE)["state"]
    decisions = len(first.store.decisions())
    first.store.close()

    reopened = Store.open(path)
    assert reopened.case(IVY_CASE)["state"] == before
    assert len(reopened.decisions()) == decisions
    reopened.close()


# ===========================================================================
# Repository hygiene
# ===========================================================================

APP_FILES = [
    path
    for path in APP_ROOT.rglob("*")
    if path.is_file()
    and path.suffix in {".py", ".md", ".json", ".csv", ".toml", ".html", ".example"}
    and ".venv" not in path.parts
    and "data" not in path.parts
    and "__pycache__" not in path.parts
]


def test_there_are_files_to_scan():
    assert len(APP_FILES) > 25


def test_no_uk_number_in_the_app_could_ring_a_real_subscriber():
    """Every +44 number must be Ofcom-reserved, or not a dialable number at all.

    This caught a real problem: the live-contact tests originally used an
    ordinary-looking 07911 mobile number as a stand-in for "a number you own".
    It sits outside every reserved range, so it could belong to somebody. The
    number itself is not repeated here, because this scan reads its own source.
    """
    offenders = []
    for path in APP_FILES:
        for number in re.findall(r"\+44\d{9,13}(?!\w)", path.read_text(encoding="utf-8")):
            if is_reserved_number(number):
                continue
            if not is_e164(number):
                continue  # cannot be dialled at all
            offenders.append(f"{path.name}: {number}")
    assert offenders == []


def test_no_credential_shaped_string_is_committed():
    """No real-looking API key, bearer token or private key in the tree."""
    patterns = [
        r"sk-[A-Za-z0-9]{16,}",
        r"gh[pousr]_[A-Za-z0-9]{20,}",
        r"Bearer\s+[A-Za-z0-9._-]{20,}",
        r"BEGIN (RSA|OPENSSH|PRIVATE) KEY",
        r"AKIA[0-9A-Z]{16}",
    ]
    offenders = []
    for path in APP_FILES:
        text = path.read_text(encoding="utf-8")
        for pattern in patterns:
            if re.search(pattern, text):
                offenders.append(f"{path.name}: {pattern}")
    assert offenders == []


def test_env_example_documents_variables_but_carries_no_values():
    text = (APP_ROOT / ".env.example").read_text(encoding="utf-8")
    assigned = [
        line
        for line in text.splitlines()
        if "=" in line and not line.strip().startswith("#")
    ]
    assert assigned, "the example must document the variables"
    for line in assigned:
        name, _, value = line.partition("=")
        # Only non-secret defaults may carry a value.
        if value.strip():
            assert name.strip() in {
                "REACHABLE_TRIGGER_SESSIONS",
                "REACHABLE_MAX_ATTEMPTS",
                "REACHABLE_CASCADE_LIMIT",
                "REACHABLE_CONFIDENCE_FLOOR",
                "REACHABLE_TRANSCRIPT_RETENTION_DAYS",
                "REACHABLE_CALLE_TIMEOUT_SECONDS",
                "REACHABLE_DATA_DIR",
                "REACHABLE_DB",
            }, name
    for secret in ("CALLE_API_KEY", "REACHABLE_ADMIN_TOKEN"):
        assert f"{secret}=\n" in text or f"{secret}=" in text
        assert not re.search(rf"{secret}=\S", text)


def test_a_real_env_file_is_not_committed():
    assert not (APP_ROOT / ".env").exists() or ".env" in (
        APP_ROOT / ".gitignore"
    ).read_text(encoding="utf-8")


def test_the_gitignore_covers_the_database_and_env():
    text = (APP_ROOT / ".gitignore").read_text(encoding="utf-8")
    for entry in (".env", "data/", "*.sqlite3"):
        assert entry in text, entry


def test_no_forbidden_dependency_string_appears_under_apps():
    """The repository validator bans four literal strings anywhere under apps/."""
    validator = (
        APP_ROOT.parent.parent.parent / "scripts" / "validate_repository.py"
    ).read_text(encoding="utf-8")
    block = validator[validator.index("forbidden_dependency_snippets") :]
    block = block[: block.index("]")]
    banned = re.findall(r'"([^"]+)"|\'([^\']+)\'', block)
    banned = [a or b for a, b in banned]
    assert banned, "could not read the validator's list"

    offenders = []
    for path in APP_FILES:
        text = path.read_text(encoding="utf-8")
        for needle in banned:
            if needle in text:
                offenders.append(f"{path.name}: {needle}")
    assert offenders == []


def test_no_cjk_text_anywhere_in_the_app():
    """The validator walks the filesystem, including untracked files."""
    # Built from escapes on purpose: writing the ranges literally would put
    # CJK characters in this file and trip the very check it performs.
    # Ranges built with chr() so that no CJK codepoint appears in this
    # file. Writing them literally puts the characters in the source and
    # trips the very check being performed -- which is how this was found.
    ranges = [(0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF)]
    cjk = re.compile("[" + "".join(f"{chr(a)}-{chr(b)}" for a, b in ranges) + "]")
    offenders = [p.name for p in APP_FILES if cjk.search(p.read_text(encoding="utf-8"))]
    assert offenders == []


# ===========================================================================
# Task text can never name a child before identity, or carry forbidden content
# ===========================================================================


def test_the_voicemail_line_names_no_child_and_gives_no_reason():
    from reachable.calls.contracts import IDENTITY_GATE_BLOCK

    block = IDENTITY_GATE_BLOCK.format(
        school_name="Fernhollow Primary School", contact_name="Martin Dunn"
    )
    voicemail = block[block.index("If you reach a voicemail") :]
    assert "Please call the school office" in voicemail
    assert "Do not name any child" in voicemail
    for leak in ("absent", "absence", "attendance", "reason"):
        assert leak not in voicemail.lower(), leak


def test_every_rendered_task_gates_identity_before_naming_the_child(live):
    """Checked on the real rendered output for every case the app can build."""
    live.import_data()
    live.scan_register()
    live.start_contact_check()
    checked = 0
    for case in live.store.cases():
        if not case["contact_id"]:
            continue
        pupil = live.dataset.pupils.get(case["pupil_id"])
        if pupil is None:
            continue
        try:
            task = live.preview(case["case_id"]).task
        except Exception:  # noqa: BLE001 - a refusal is not a leak
            continue
        gate = task.index("Before you say anything about any child")
        first_use = task.index(pupil.first_name)
        assert gate < first_use, case["case_id"]

        # The pupil's FULL name must never appear. The surname alone can
        # legitimately occur inside the contact's own name -- a parent usually
        # shares it, and the call has to ask "Am I speaking to Sinead
        # Kelleher?" before it may say anything about a child at all.
        assert f"{pupil.first_name} {pupil.last_name}" not in task, case["case_id"]
        if pupil.year_group:
            assert f"Year {pupil.year_group}" not in task, case["case_id"]
        if pupil.form_group:
            assert pupil.form_group not in task, case["case_id"]
        checked += 1
    assert checked >= 5


@pytest.mark.parametrize(
    "forbidden", ["fined", "penalty notice", "prosecute", "court", "diagnose"]
)
def test_no_rendered_task_body_threatens_or_advises(live, forbidden):
    live.scan_register()
    task = live.preview(IVY_CASE).task
    body = task[: task.index("You are gathering information only")]
    assert forbidden not in body.lower()


def test_a_provider_error_is_reported_without_ever_carrying_the_key():
    """The message is needed to diagnose; the key must never ride along with it.

    "CalleAPIError" alone tells an operator nothing about whether they are out
    of credit or sending a bad region. The message says which -- but a provider
    message can echo the request, and this string is written to the event log
    and rendered in the dashboard.
    """
    from reachable.calls.calle_client import CalleClient

    key = "sk-" + "z" * 92
    client = CalleClient(Config(calle_api_key=key, live_calls=True))

    class CalleAPIError(Exception):
        pass

    described = client._describe(CalleAPIError(f"400 bad region (auth {key})"))
    assert "CalleAPIError" in described
    assert "bad region" in described, "the message has to survive, or it is useless"
    assert key not in described
    assert "[redacted]" in described


def test_an_error_with_no_message_still_names_its_type():
    from reachable.calls.calle_client import CalleClient

    client = CalleClient(Config(calle_api_key="k" * 40, live_calls=True))

    class CalleConnectionError(Exception):
        pass

    assert client._describe(CalleConnectionError()) == "CalleConnectionError"


def test_provider_diagnostics_mask_before_truncating():
    from reachable.calls.calle_client import CalleClient

    key = "synthetic-review-key-" + "z" * 92
    client = CalleClient(Config(calle_api_key=key, live_calls=True))
    described = client._describe(RuntimeError("x" * 280 + key))
    assert "synthetic-review-key" not in described
    assert "[redacted]" in described
    assert "+447700900101" not in client._describe(RuntimeError("Call +447700900101"))
