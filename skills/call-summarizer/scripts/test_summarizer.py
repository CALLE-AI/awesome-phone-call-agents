#!/usr/bin/env python3
"""Tests for the call-summarizer skill.

Run:
    python3 scripts/test_summarizer.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_TRANSCRIPT = SKILL_DIR / "references" / "example-transcript.json"


def run_summarize(transcript_path: Path, out_path: Path | None = None) -> tuple[int, str]:
    cmd = [sys.executable, str(SCRIPTS / "summarize_call.py"), "--transcript", str(transcript_path)]
    if out_path:
        cmd += ["--out", str(out_path)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


def run_validate(brief_path: Path) -> tuple[int, str]:
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "validate_brief.py"), "--brief", str(brief_path)],
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def write_fixture(content: dict) -> Path:
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8")
    json.dump(content, tmp)
    tmp.close()
    return Path(tmp.name)


def test_example_transcript_produces_valid_brief() -> None:
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(EXAMPLE_TRANSCRIPT, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    assert brief["masked"] in (True, "partial"), "brief must be masked"
    assert "outcome" in brief and brief["outcome"], "outcome must be non-empty"
    assert brief["outcome"].startswith(("Appointment", "Request", "Reschedule", "No answer", "Voicemail", "unknown")), brief["outcome"]
    assert isinstance(brief["actions"], list), "actions must be a list"
    rc, val_text = run_validate(out_path)
    assert rc == 0, f"validate failed: {val_text}"


def test_empty_transcript_abstains() -> None:
    fixture = write_fixture({"call_id": "empty-001", "transcript": ""})
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    assert brief["outcome"] == "unknown", f"empty transcript must abstain, got {brief['outcome']}"
    assert brief["actions"] == [], "empty transcript must have no actions"
    assert brief["sentiment"]["label"] == "unknown"


def test_no_answer_transcript() -> None:
    fixture = write_fixture(
        {
            "call_id": "noanswer-001",
            "transcript": [
                {"speaker": "agent", "text": "Hello, this is an automated assistant."},
                {"speaker": "agent", "text": "(no response)"},
            ],
        }
    )
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    assert "No answer" in brief["outcome"], brief["outcome"]


def test_pii_is_masked() -> None:
    fixture = write_fixture(
        {
            "call_id": "pii-001",
            "callee_masked": "+15555550100",
            "transcript": [
                {"speaker": "agent", "text": "Calling about account #ABC123."},
                {"speaker": "callee", "text": "Yes, reach me at caller@example.com or +15555550199."},
            ],
        }
    )
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    summary = brief["summary"]
    assert "caller@example.com" not in summary, "email must be masked in summary"
    assert "15555550199" not in summary, "phone must be masked in summary"
    assert "ABC123" not in summary, "account id must be masked in summary"
    rc, val_text = run_validate(out_path)
    assert rc == 0, f"validate failed (PII leaked): {val_text}"


def test_action_owner_extraction() -> None:
    fixture = write_fixture(
        {
            "call_id": "action-001",
            "transcript": [
                {"speaker": "agent", "text": "I will send a reminder the day before."},
                {"speaker": "callee", "text": "I will call back tomorrow."},
            ],
        }
    )
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    owners = {a["owner"] for a in brief["actions"]}
    assert "agent" in owners, f"agent action must be extracted, got {brief['actions']}"


def test_sensitive_category_tagging() -> None:
    fixture = write_fixture(
        {
            "call_id": "sensitive-001",
            "transcript": [
                {"speaker": "agent", "text": "I will note that for your provider about your prescription."},
            ],
        }
    )
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    sensitive = [a for a in brief["actions"] if a.get("category") == "sensitive"]
    assert len(sensitive) >= 1, "sensitive action must be tagged"
    assert sensitive[0]["sensitive"] is True


def test_fingerprint_is_sha256() -> None:
    fixture = write_fixture({"call_id": "fp-001", "callee_masked": "+155****1234"})
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    assert brief["caller_fingerprint"].startswith("sha256:"), brief["caller_fingerprint"]


# ---------------------------------------------------------------------------
# Review item #1: actions[].verb and actions[].source_span must be masked.
# ---------------------------------------------------------------------------

def test_action_verb_and_source_span_are_masked() -> None:
    fixture = write_fixture(
        {
            "call_id": "act-pii-001",
            "callee_masked": "+155****1234",
            "transcript": [
                {
                    "speaker": "callee",
                    "text": "I will call back about account #ACME4242 at +15555550199.",
                },
            ],
        }
    )
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    actions = brief["actions"]
    assert actions, "expected at least one action"
    for a in actions:
        verb = a["verb"]
        span = a["source_span"]
        assert "ACME4242" not in verb, f"account id leaked into verb: {verb!r}"
        assert "15555550199" not in verb, f"phone leaked into verb: {verb!r}"
        assert "ACME4242" not in span, f"account id leaked into source_span: {span!r}"
        assert "15555550199" not in span, f"phone leaked into source_span: {span!r}"
    rc, val_text = run_validate(out_path)
    assert rc == 0, f"validate failed (PII leaked in actions): {val_text}"


# ---------------------------------------------------------------------------
# Review item #2: outcome detection must be callee-only and fail-closed on
# contradictions. An agent asking for confirmation followed by a callee
# declining must NOT be reported as confirmed.
# ---------------------------------------------------------------------------

def test_outcome_agent_confirm_then_callee_decline_is_not_confirmed() -> None:
    fixture = write_fixture(
        {
            "call_id": "contra-001",
            "transcript": [
                {"speaker": "agent", "text": "Can I confirm your appointment?"},
                {"speaker": "callee", "text": "No, I can't make it."},
            ],
        }
    )
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    assert brief["outcome"].startswith("Request declined"), brief["outcome"]
    assert "confirm" not in brief["outcome"].lower() or "declined" in brief["outcome"].lower(), brief["outcome"]


def test_outcome_callee_contradiction_fails_closed() -> None:
    # Callee says yes then later declines — the skill must fail closed to
    # "unknown" rather than asserting either side.
    fixture = write_fixture(
        {
            "call_id": "contra-002",
            "transcript": [
                {"speaker": "agent", "text": "Can you confirm?"},
                {"speaker": "callee", "text": "Yes, sounds good."},
                {"speaker": "agent", "text": "Great."},
                {"speaker": "callee", "text": "Actually, I can't make it."},
            ],
        }
    )
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    assert brief["outcome"] == "unknown", (
        f"contradictory callee responses must fail closed to unknown, got {brief['outcome']!r}"
    )


def test_outcome_agent_only_confirmation_is_not_confirmed() -> None:
    # An agent asking "can you confirm?" with no effective callee response must
    # never be reported as confirmed.
    fixture = write_fixture(
        {
            "call_id": "agent-only-001",
            "transcript": [
                {"speaker": "agent", "text": "Can I confirm your appointment for Tuesday?"},
                {"speaker": "agent", "text": "(no response)"},
            ],
        }
    )
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    assert not brief["outcome"].startswith("Appointment"), (
        f"agent-only confirm must not be reported as confirmed: {brief['outcome']!r}"
    )


# ---------------------------------------------------------------------------
# Review item #3: caller fingerprint must be stable across calls from the
# same caller (call_id must not be mixed in).
# ---------------------------------------------------------------------------

def test_fingerprint_is_stable_across_calls_with_same_caller() -> None:
    base = {"callee_masked": "+155****9999"}
    f1 = write_fixture({**base, "call_id": "call-A"})
    f2 = write_fixture({**base, "call_id": "call-B"})
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out1, \
         tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out2:
        out1_path, out2_path = Path(out1.name), Path(out2.name)
    rc1, _ = run_summarize(f1, out1_path)
    rc2, _ = run_summarize(f2, out2_path)
    assert rc1 == 0 and rc2 == 0
    b1 = json.loads(out1_path.read_text(encoding="utf-8"))
    b2 = json.loads(out2_path.read_text(encoding="utf-8"))
    assert b1["caller_fingerprint"] == b2["caller_fingerprint"], (
        f"same caller must produce same fingerprint across calls; got "
        f"{b1['caller_fingerprint']} vs {b2['caller_fingerprint']}"
    )


def test_fingerprint_does_not_change_with_call_id() -> None:
    # Explicit regression test for review item #3: varying call_id alone must
    # NOT change the fingerprint when the caller identity is stable.
    f1 = write_fixture({"callee_masked": "+155****4321", "call_id": "x-1"})
    f2 = write_fixture({"callee_masked": "+155****4321", "call_id": "x-2"})
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out1, \
         tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out2:
        out1_path, out2_path = Path(out1.name), Path(out2.name)
    run_summarize(f1, out1_path)
    run_summarize(f2, out2_path)
    b1 = json.loads(out1_path.read_text(encoding="utf-8"))
    b2 = json.loads(out2_path.read_text(encoding="utf-8"))
    assert b1["caller_fingerprint"] == b2["caller_fingerprint"]


# ---------------------------------------------------------------------------
# Review item #1 (second pass): personal names leak through summary, verb,
# and source_span while the brief claims masked:true. The summarizer must
# redact names and the validator must reject a brief that still leaks them.
# ---------------------------------------------------------------------------

def test_personal_names_are_redacted_from_summary_verb_and_source_span() -> None:
    # "Dr. Patel" (title-prefixed) and "John Smith" (cue-introduced) must not
    # survive into any emitted field while masked is true.
    fixture = write_fixture(
        {
            "call_id": "name-001",
            "callee_masked": "+155****1234",
            "transcript": [
                {
                    "speaker": "agent",
                    "text": "Hello, this is Dr. Patel from Example Clinic. May I confirm your appointment?",
                },
                {
                    "speaker": "callee",
                    "text": "Yes, this is John Smith, I will call back tomorrow.",
                },
            ],
        }
    )
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    blob = json.dumps(brief)
    assert "Patel" not in blob, f"personal name 'Patel' leaked into brief: {blob}"
    assert "Smith" not in blob, f"personal name 'Smith' leaked into brief: {blob}"
    # Role labels must be preserved (the safety contract keeps them).
    assert "callee" in brief["summary"].lower(), f"role label 'callee' was stripped: {brief['summary']!r}"
    for a in brief["actions"]:
        assert "Patel" not in a["verb"] and "Smith" not in a["verb"]
        assert "Patel" not in a["source_span"] and "Smith" not in a["source_span"]
    rc, val_text = run_validate(out_path)
    assert rc == 0, f"validate failed (name leaked): {val_text}"


def test_validator_rejects_brief_that_leaks_personal_name() -> None:
    # The validator must flag a hand-crafted brief that still contains a
    # cue-introduced personal name in the summary while masked is true (legacy
    # form: claims all PII is masked — a name leak is a contract violation).
    bad_brief = {
        "outcome": "Appointment or request confirmed.",
        "summary": "The callee said: this is John Smith, I can make it.",
        "actions": [],
        "sentiment": {"label": "positive", "justification": "Callee confirmed."},
        "caller_fingerprint": "sha256:abcdef012345",
        "masked": True,
    }
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    out_path.write_text(json.dumps(bad_brief), encoding="utf-8")
    rc, val_text = run_validate(out_path)
    assert rc != 0, "validator should reject a brief with a leaked personal name"
    assert "name" in val_text.lower(), f"validator error should mention name: {val_text}"


def test_partial_masking_contract_is_honest_about_uncued_names() -> None:
    # Review item #1 (third pass): the reviewer's frozen Must Fix is that
    # ordinary names like "Alice will call Bob" pass through while masked is
    # true. We narrow the contract: masked is now "partial" with a
    # masking_scope documenting exactly what IS tokenized. An uncued name
    # like "Alice" in the summary is NOT a violation when masked is "partial"
    # because the contract no longer claims all-name redaction.
    fixture = write_fixture(
        {
            "call_id": "uncued-name-001",
            "callee_masked": "+155****1234",
            "transcript": [
                {
                    "speaker": "agent",
                    "text": "Alice will call Bob tomorrow about the appointment.",
                },
            ],
        }
    )
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    # The contract is now honest: masked is "partial", not True.
    assert brief["masked"] == "partial", (
        f"masked must be 'partial' (honest contract), got {brief['masked']!r}"
    )
    assert "masking_scope" in brief, "partial masking must document its scope"
    # The uncued names "Alice" and "Bob" may appear — the brief does NOT
    # claim to redact them. The validator must ACCEPT this brief because the
    # contract is honest about the boundary.
    rc, val_text = run_validate(out_path)
    assert rc == 0, (
        f"validator must accept honest partial-masking brief with uncued names: {val_text}"
    )


# ---------------------------------------------------------------------------
# Review item #2 (second pass): outcome classification must not take the
# first matching cue inside a single utterance. A contradictory response
# such as "Yes, I can't make it" must fail closed to "unknown".
# ---------------------------------------------------------------------------

def test_outcome_single_utterance_contradiction_fails_closed() -> None:
    # "Yes, I can't make it." contains both a confirmation cue and a decline
    # cue. The previous implementation matched "confirmed" first. It must now
    # fail closed to "unknown".
    fixture = write_fixture(
        {
            "call_id": "intra-contra-001",
            "transcript": [
                {"speaker": "agent", "text": "Can you confirm your appointment?"},
                {"speaker": "callee", "text": "Yes, I can\u0027t make it."},
            ],
        }
    )
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    assert brief["outcome"] == "unknown", (
        f"single-utterance contradiction must fail closed to unknown, got {brief['outcome']!r}"
    )


def test_outcome_unambiguous_confirmation_still_confirmed() -> None:
    # Guard against over-fitting: a clean confirmation with no decline cue
    # must still be reported as confirmed, not closed to unknown.
    fixture = write_fixture(
        {
            "call_id": "clean-confirm-001",
            "transcript": [
                {"speaker": "agent", "text": "May I confirm your appointment?"},
                {"speaker": "callee", "text": "Yes, sounds good. I will be there."},
            ],
        }
    )
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as out:
        out_path = Path(out.name)
    rc, out_text = run_summarize(fixture, out_path)
    assert rc == 0, f"summarize failed: {out_text}"
    brief = json.loads(out_path.read_text(encoding="utf-8"))
    assert brief["outcome"].startswith("Appointment"), (
        f"clean confirmation must still be confirmed, got {brief['outcome']!r}"
    )


def main() -> int:
    tests = [
        test_example_transcript_produces_valid_brief,
        test_empty_transcript_abstains,
        test_no_answer_transcript,
        test_pii_is_masked,
        test_action_owner_extraction,
        test_sensitive_category_tagging,
        test_fingerprint_is_sha256,
        # Review item #1: PII masking in actions verb + source_span
        test_action_verb_and_source_span_are_masked,
        # Review item #2: callee-only outcome detection + fail-closed
        test_outcome_agent_confirm_then_callee_decline_is_not_confirmed,
        test_outcome_callee_contradiction_fails_closed,
        test_outcome_agent_only_confirmation_is_not_confirmed,
        # Review item #3: stable fingerprint across calls (no call_id)
        test_fingerprint_is_stable_across_calls_with_same_caller,
        test_fingerprint_does_not_change_with_call_id,
        # Review item #1 (second pass): personal-name redaction
        test_personal_names_are_redacted_from_summary_verb_and_source_span,
        test_validator_rejects_brief_that_leaks_personal_name,
        # Review item #1 (third pass): narrowed masking contract
        test_partial_masking_contract_is_honest_about_uncued_names,
        # Review item #2 (second pass): intra-utterance contradiction
        test_outcome_single_utterance_contradiction_fails_closed,
        test_outcome_unambiguous_confirmation_still_confirmed,
    ]
    failures = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except AssertionError as exc:
            print(f"FAIL {test.__name__}: {exc}")
            failures += 1
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR {test.__name__}: {exc}")
            failures += 1
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
