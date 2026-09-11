#!/usr/bin/env python3
"""Behavioural tests for call_agent.py, against the fake provider.

Places no calls, needs no credentials, no network, no node.

    python3 test_call_agent.py

These assert on SIDE EFFECTS -- how many times the provider was submitted to,
what mode a file was created with, what ended up on disk -- not only on what a
function returned. A suite that checks return values can pass while the code
places a second charged call, which is how that defect once shipped past
fourteen tests.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
from pathlib import Path

FAILURES: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        print(f"  ok   {message}")
    else:
        print(f"  FAIL {message}")
        FAILURES.append(message)


def load(tmp: str, *, rewrite: str = "none", fail_status: bool = False):
    """Fresh module state against an empty state directory."""
    os.environ["CALL_STATE_DIR"] = tmp
    for name in [m for m in sys.modules if m.startswith(("call_agent", "fake_provider"))]:
        del sys.modules[name]
    ca = importlib.import_module("call_agent")
    fp = importlib.import_module("fake_provider")
    provider = fp.FakeProvider(rewrite=rewrite, fail_status=fail_status)
    ca.PROVIDERS["fake"] = fp.FakeProvider
    ca.get_provider = lambda: provider
    return ca, fp, provider


PLAN_ARGS = dict(
    to=["+15550101234"],
    purpose="Check availability before travelling",
    field=["unit_price=How much is it", "in_stock=Do you have it in stock"],
    callee_name="Miller Hardware",
    region=None,
    language=None,
)


def plan(ca):
    return ca.cmd_plan(argparse.Namespace(**PLAN_ARGS))


def run(ca, plan_id, wait=False):
    return ca.cmd_run(
        argparse.Namespace(plan_id=plan_id, wait=wait, max_wait=1)
    )


def status(ca, run_id, wait=False):
    return ca.cmd_status(
        argparse.Namespace(run_id=run_id, wait=wait, max_wait=1)
    )


# --------------------------------------------------------------------------
# The one that matters most
# --------------------------------------------------------------------------


def test_run_submits_exactly_once(tmp):
    ca, _, prov = load(tmp)
    p = plan(ca)
    run(ca, p["plan_id"])
    check(len(prov.submissions) == 1, "one run submits exactly one call")


def test_second_run_is_a_second_call(tmp):
    """Documents current behaviour, and it is not yet what we want.

    Single-use plan execution is on the v1.19.0 list: a retry should poll the
    existing run rather than submit again. Until that ships, calling run twice
    submits twice -- and this test says so out loud rather than leaving it
    undiscovered.
    """
    ca, _, prov = load(tmp)
    p = plan(ca)
    run(ca, p["plan_id"])
    run(ca, p["plan_id"])
    check(
        len(prov.submissions) == 2,
        "KNOWN GAP: a second run submits a second call (single-use not built)",
    )


# --------------------------------------------------------------------------
# Spend credential
# --------------------------------------------------------------------------


def test_fake_provider_resolves_from_the_env_var_alone(tmp):
    """The documented no-call path must work without help.

    SKILL.md and references/examples.md both tell a reader to run
    CALL_PROVIDER=fake. If the adapter only knows about the fake because a
    test registered it by hand, the documented path is broken for everyone
    who follows the documentation.
    """
    os.environ["CALL_STATE_DIR"] = tmp
    os.environ["CALL_PROVIDER"] = "fake"
    for name in [m for m in sys.modules if m.startswith(("call_agent", "fake_provider"))]:
        del sys.modules[name]
    try:
        ca = importlib.import_module("call_agent")
        prov = ca.get_provider()
        check(prov.name == "fake", f"CALL_PROVIDER=fake resolves (got {prov.name!r})")
    finally:
        os.environ["CALL_PROVIDER"] = "calle"


def test_unready_plan_says_so_and_keeps_the_questions(tmp):
    """A plan the provider will not run yet is not a failure.

    It comes back with a null token and answerable questions. Dropping them
    leaves the caller with a plan that looks fine and a missing-token error at
    run time that says nothing about what was needed.
    """
    ca, fp, _ = load(tmp)
    prov = fp.FakeProvider(unready=True)
    ca.get_provider = lambda: prov
    p = plan(ca)

    check(p["ready_to_run"] is False, "ready_to_run is reported as false")
    check("NOT READY" in p["next"], f"the next step says NOT READY (got {p['next'][:40]!r})")
    check(
        "run --plan-id" not in p["next"],
        "the next step does NOT advise a run that cannot work",
    )
    check(
        len(p.get("clarifying_questions") or []) == 1,
        "the clarifying question is surfaced to the caller",
    )
    check("confirm_token" not in p, "no token is returned for an unready plan")

    rec = json.loads((Path(tmp) / f"{p['plan_id']}.json").read_text())
    check(
        rec.get("clarifying_questions"),
        "the clarifying question is persisted to the plan record",
    )


def test_unready_plan_cannot_be_run(tmp):
    ca, fp, prov = load(tmp)
    prov2 = fp.FakeProvider(unready=True)
    ca.get_provider = lambda: prov2
    p = plan(ca)
    try:
        run(ca, p["plan_id"])
        check(False, "running an unready plan is refused")
    except ca.CallAgentError:
        check(True, "running an unready plan is refused")
    check(
        not prov2.submissions,
        "an unready plan reaches the provider zero times on run",
    )


def test_token_never_returned_to_caller(tmp):
    ca, _, _ = load(tmp)
    p = plan(ca)
    check("confirm_token" not in p, "plan output carries no confirm_token")


def test_token_stored_under_plan_id_only(tmp):
    ca, _, _ = load(tmp)
    p = plan(ca)
    r = run(ca, p["plan_id"])
    plan_rec = json.loads((Path(tmp) / f"{p['plan_id']}.json").read_text())
    run_rec = json.loads((Path(tmp) / f"{r['run_id']}.json").read_text())
    check("confirm_token" in plan_rec, "token is stored under the plan id")
    check(
        "confirm_token" not in run_rec,
        "token is NOT copied into the run sidecar",
    )


def test_token_never_reaches_the_result_sidecar(tmp):
    ca, _, _ = load(tmp)
    p = plan(ca)
    r = run(ca, p["plan_id"])
    status(ca, r["run_id"])
    blob = (Path(tmp) / f"{r['run_id']}.result.json").read_text()
    check("confirm_token" not in blob, "result sidecar carries no token")


def test_two_recipients_on_one_plan_are_refused(tmp):
    """One approval authorises one destination.

    A confirmation token covers the whole plan and an in-flight call cannot be
    cancelled, so the only recipient count where the approval and the
    irrevocable action correspond exactly is one.
    """
    ca, _, prov = load(tmp)
    args = dict(PLAN_ARGS)
    args["to"] = ["+15550101234", "+15550105678"]
    try:
        ca.cmd_plan(argparse.Namespace(**args))
        check(False, "two recipients on one plan are refused")
    except ca.CallAgentError:
        check(True, "two recipients on one plan are refused")
    check(not prov.plans, "the cap fires before the provider is touched")


def test_live_provider_is_never_the_default(tmp):
    """Nothing should be able to ring a phone because a variable was unset.

    Imports the module with CALL_PROVIDER absent from the environment
    entirely, which is the state a stranger's shell is in.
    """
    os.environ["CALL_STATE_DIR"] = tmp
    os.environ.pop("CALL_PROVIDER", None)
    for name in [m for m in sys.modules if m.startswith(("call_agent", "fake_provider"))]:
        del sys.modules[name]
    try:
        ca = importlib.import_module("call_agent")
        check(
            ca.PROVIDER == "fake",
            f"an unset CALL_PROVIDER selects the fake (got {ca.PROVIDER!r})",
        )
        check(
            ca.get_provider().name == "fake",
            "and get_provider returns it without registration",
        )
    finally:
        os.environ["CALL_PROVIDER"] = "calle"


def test_non_ascii_digits_are_rejected(tmp):
    """Python's \\d matches every Unicode decimal digit.

    A fullwidth or Arabic-Indic numeral inside an otherwise plausible number
    passes a \\d-based check and reaches the provider. These must not.
    """
    ca, _, _ = load(tmp)
    ok = "+442079460123"
    check(ca._validate_e164(ok) == ok, "a plain ASCII number is accepted")
    for bad, label in [
        # U+FF14 FULLWIDTH DIGIT FOUR. Python's \d matches it, so a \d-based
        # check accepts this number and passes it to the provider.
        ("+4420794601\uff141", "fullwidth digit mid-number"),
        ("+\u0664\u0664\u0662\u0660\u0667\u0669\u0664\u0666\u0660\u0661\u0662\u0663", "Arabic-Indic digits"),
        ("+4420794601\u0664\u0661", "Arabic-Indic digits mid-number"),
        ("+44 2079 460123", "spaces"),
        ("+44-2079-460123", "dashes"),
    ]:
        try:
            ca._validate_e164(bad)
            check(False, f"{label} is rejected")
        except ca.CallAgentError:
            check(True, f"{label} is rejected")


def test_mask_phone_is_one_format_everywhere(tmp):
    ca, _, _ = load(tmp)
    check(
        ca.mask_phone("+442079460123") == "+44...0123",
        f"a valid number masks to country code and last four "
        f"(got {ca.mask_phone('+442079460123')!r})",
    )
    check(
        ca.mask_phone("07700 900123") == "<redacted>",
        "anything not E.164 is replaced entirely, not partially revealed",
    )
    check(ca.mask_phone(None) == "<none>", "a missing number is not masked as a number")


def test_output_is_sanitized_everywhere_not_just_the_number_field(tmp):
    """A masked destination and a full number three fields later is not masking.

    Numbers get quoted back inside summaries, transcript turns and goal text.
    """
    ca, _, _ = load(tmp)
    envelope = {
        "to_phones": ["+442079460123"],
        "confirm_token": "SPEND-CREDENTIAL",
        "summary": "Reached them on +442079460123 and they confirmed.",
        "transcript": [
            {"t": "00:00:03", "speaker": "callee", "text": "Call us back on +442079460456."}
        ],
        "nested": {"goal_sent": "Call +442079460123 and ask about stock."},
    }
    out = ca.sanitize_for_output(envelope)
    blob = json.dumps(out)

    check("confirm_token" not in blob, "the spend credential is dropped from output")
    check("SPEND-CREDENTIAL" not in blob, "and so is its value")
    check(out["to_phones"] == ["+44...0123"], "the phone field is masked")
    check(
        "+442079460123" not in blob,
        "the number does not survive anywhere in the output",
    )
    check(
        "+442079460456" not in blob,
        "a number quoted inside a transcript turn is masked too",
    )
    # Assert on the structure, not on json.dumps output: the mask uses an
    # ellipsis, which serialises to ... and will not match a literal.
    check(
        "+44...0456" in out["transcript"][0]["text"],
        "the transcript number is masked rather than deleted",
    )
    check(
        "+44...0123" in out["nested"]["goal_sent"],
        "and nested free text is swept too",
    )


def test_every_phone_shape_is_redacted_not_just_e164(tmp):
    """Free text quotes numbers back in whatever form the speaker used.

    A sanitiser that only understands "+" leaves a national-format number,
    a spaced number and a bracketed number untouched -- which is most of what
    actually appears in a transcript.
    """
    ca, _, _ = load(tmp)
    for text, label in [
        ("Call us on +442079460123 tomorrow.", "E.164 in a sentence"),
        ("Try 07700 900123 after ten.", "national format, spaced"),
        ("Ring (212) 555-0100 now.", "bracketed area code"),
        ("or 212-555-0100.", "dashed, sentence-final"),
        ("call back on 0207 946 0123 please", "spaced landline"),
        ("my number is 442079460123", "no plus"),
    ]:
        out = ca._redact_text(text)
        # Either fully replaced, or masked to country code + last four. A bare
        # "..." check would pass on any sentence containing an ellipsis.
        redacted = bool(
            "<redacted>" in out or re.search(r"\+\d{1,3}\.\.\.\d{4}", out)
        )
        check(redacted, f"{label} is redacted (got {out!r})")


def test_sanitizer_leaves_non_phone_digits_alone(tmp):
    """A transcript full of <redacted> where the prices were is not useful.

    Over-redaction is a real cost, not a safe default: it destroys the record
    the persistence design exists to keep.
    """
    ca, _, _ = load(tmp)
    for text, label in [
        ("Meeting on 2026-01-01 at 09:30.", "an ISO date"),
        ("The order was 24 pounds for 10 stems.", "prices and quantities"),
        ("Ext 4471 is the desk.", "a short extension"),
        ("call at 09:30 or 14:00", "clock times"),
        ("Version 1.18.0 shipped.", "a version string"),
    ]:
        out = ca._redact_text(text)
        check(out == text, f"{label} survives untouched (got {out!r})")


def test_no_real_numbers_in_this_suite(tmp):
    """Fixtures use reserved ranges only.

    +1555 01xx is reserved in NANP; +44 7700 900xxx and +44 20 7946 0xxx are
    Ofcom's drama ranges and are never allocated. A plausible-looking number
    in a public test file is somebody's phone ringing.
    """
    src = Path(__file__).read_text(encoding="utf-8")
    runs = re.findall(r"(?<![\w.])(?:\+|\()?\d[\d\s()\-]{5,17}\d(?![\w])", src)
    reserved = ("5550", "7946", "7700")
    stray = [
        r.strip() for r in runs
        if not any(k in re.sub(r"\D", "", r) for k in reserved)
        and not re.match(r"^\d{4}-\d{2}-\d{2}$", r.strip())
    ]
    check(not stray, f"no non-reserved phone-shaped fixtures (found {stray})")


def test_state_on_disk_is_masked_too(tmp):
    """"Their own machine" is not a security boundary.

    A sidecar is backed up, synced, screenshotted and pasted into issues like
    any other file. A number quoted back inside a transcript turn is the same
    disclosure wherever it sits.
    """
    ca, _, _ = load(tmp)
    ca.save_state("pTEST", {
        "plan_id": "pTEST",
        "confirm_token": "TOKEN-KEEP-ME",
        "to_phones": ["+442079460123"],
        "goal_sent": "Call +442079460123. Alt 07700 900123.",
        "transcript": [{"t": "00:00:03", "speaker": "callee",
                        "text": "Ring us on (212) 555-0100."}],
        "raw": {"activity": [{"msg": "dialed 442079460123"}]},
    })
    blob = (Path(tmp) / "pTEST.json").read_text(encoding="utf-8")

    check("+442079460123" not in blob, "the destination is not stored in full")
    check("07700 900123" not in blob, "nor a number quoted inside the goal")
    check("(212) 555-0100" not in blob, "nor one inside a transcript turn")
    check("442079460123" not in blob, "nor one inside a nested activity entry")
    check(
        "TOKEN-KEEP-ME" in blob,
        "the confirm token IS kept: run needs it, and it never reaches output",
    )


def test_state_full_opt_out_keeps_the_audit_trail(tmp):
    """An operator who needs to know which business a four-day-old record
    belongs to can have it. Off by default, and a deliberate choice."""
    os.environ["CALL_STATE_DIR"] = tmp
    os.environ["CALL_STATE_FULL"] = "1"
    for name in [m for m in sys.modules if m.startswith(("call_agent", "fake_provider"))]:
        del sys.modules[name]
    try:
        ca = importlib.import_module("call_agent")
        ca.save_state("pFULL", {"to_phones": ["+442079460123"]})
        blob = (Path(tmp) / "pFULL.json").read_text(encoding="utf-8")
        check(
            "+442079460123" in blob,
            "CALL_STATE_FULL=1 keeps the unmasked number locally",
        )
    finally:
        os.environ.pop("CALL_STATE_FULL", None)


def test_argv_redacts_the_token(tmp):
    ca, _, _ = load(tmp)
    argv = ca._redact_argv([
        "node", "x",
        "--confirm-token", "SECRET",
        "--to-phone", "+442079460123",
        "--goal", "Call them and ask whether white lilies are in stock.",
        "--json",
    ])
    blob = " ".join(argv)
    check("SECRET" not in blob, "_redact_argv replaces the token value")
    check("--confirm-token" in argv, "_redact_argv keeps the flag itself")
    check("+442079460123" not in blob, "the destination is masked in argv")
    check("+44...0123" in blob, "and masked rather than removed")
    check(
        "white lilies" not in blob,
        "the goal text is not reproduced in argv; it is stored once elsewhere",
    )


def test_cmd_show_output_carries_no_full_number(tmp):
    ca, _, _ = load(tmp)
    p = plan(ca)
    out = ca.sanitize_for_output(ca.cmd_show(argparse.Namespace(id=p["plan_id"])))
    blob = json.dumps(out)
    check("confirm_token" not in blob, "show carries no token")
    check(
        "+15550101234" not in blob,
        "show carries no unmasked destination",
    )


def test_show_strips_the_token(tmp):
    ca, _, _ = load(tmp)
    p = plan(ca)
    out = ca.cmd_show(argparse.Namespace(id=p["plan_id"]))
    check("confirm_token" not in out, "show strips the token")


# --------------------------------------------------------------------------
# File modes -- asserted on disk, not on the call that set them
# --------------------------------------------------------------------------


def test_files_are_owner_only_at_creation(tmp):
    ca, _, _ = load(tmp)
    p = plan(ca)
    r = run(ca, p["plan_id"])
    status(ca, r["run_id"])

    if os.name != "posix":
        # NTFS has no POSIX mode bits, so mkstemp's 0600 is reported as 0o666
        # and the assertion would fail on correct code. Announced rather than
        # silently skipped: a check that quietly stops checking is worse than
        # one that fails.
        print(
            "  SKIP file modes are not asserted on this platform "
            f"(os.name={os.name!r}); the 0600 guarantee is POSIX-only"
        )
        return

    for f in Path(tmp).glob("*.json"):
        mode = stat.S_IMODE(f.stat().st_mode)
        check(mode == 0o600, f"{f.name} is 0600 (got {oct(mode)})")
    dir_mode = stat.S_IMODE(Path(tmp).stat().st_mode)
    check(dir_mode == 0o700, f"state dir is 0700 (got {oct(dir_mode)})")


def test_no_temp_files_survive(tmp):
    ca, _, _ = load(tmp)
    p = plan(ca)
    run(ca, p["plan_id"])
    leftovers = list(Path(tmp).glob("*.tmp"))
    check(not leftovers, f"no .tmp files left behind ({len(leftovers)} found)")


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------


def test_extraction_uses_the_requested_keys(tmp):
    ca, _, _ = load(tmp)
    p = plan(ca)
    r = run(ca, p["plan_id"])
    s = status(ca, r["run_id"])
    fields = s.get("extracted_fields") or {}
    check(
        set(fields) == {"unit_price", "in_stock"},
        f"both requested keys extracted (got {sorted(fields)})",
    )


def test_trailing_note_is_trimmed_but_value_punctuation_survives(tmp):
    ca, _, _ = load(tmp)
    p = plan(ca)
    r = run(ca, p["plan_id"])
    s = status(ca, r["run_id"])
    val = (s.get("extracted_fields") or {}).get("in_stock", "")
    check("Note:" not in val, "trailing note is trimmed from the last value")
    check("," in val, "a comma inside the value survives the trim")


def test_absent_not_empty_when_nothing_parses(tmp):
    ca, _, _ = load(tmp)
    envelope = {"summary": "nothing here matches", "run_id": "R", "state": "completed"}
    ca._attach_extracted(envelope, {"field_keys": ["unit_price"]})
    check(
        "extracted_fields" not in envelope,
        "extracted_fields is ABSENT when nothing parses, never an empty dict",
    )


def test_unmatched_keys_are_reported_not_silent(tmp):
    """Observed live: a call answered both questions in prose and used none of
    the requested key names. Silence there is indistinguishable from a call
    where nothing was said."""
    ca, _, _ = load(tmp)
    envelope = {
        "summary": "They confirmed white lilies are available, about 24 pounds.",
        "run_id": "R",
        "state": "completed",
    }
    ca._attach_extracted(envelope, {"field_keys": ["in_stock", "unit_price"]})
    check(
        envelope.get("extraction_status") == "no_keys_in_summary",
        f"a prose summary with no keys is reported (got "
        f"{envelope.get('extraction_status')!r})",
    )
    check(
        "do not treat this as an unanswered call" in (
            envelope.get("extraction_note") or ""
        ),
        "the note tells the caller the answers may still be there",
    )
    check(
        "extracted_fields" not in envelope,
        "no fields are invented from prose",
    )


def test_partial_extraction_names_the_missing_keys(tmp):
    ca, _, _ = load(tmp)
    envelope = {
        "summary": "in_stock: yes, several. The price was not discussed.",
        "run_id": "R",
        "state": "completed",
    }
    ca._attach_extracted(envelope, {"field_keys": ["in_stock", "unit_price"]})
    check(
        envelope.get("extraction_status") == "partial",
        f"a partial parse is reported as partial (got "
        f"{envelope.get('extraction_status')!r})",
    )
    check(
        envelope.get("extraction_missing_keys") == ["unit_price"],
        f"the missing key is named (got {envelope.get('extraction_missing_keys')!r})",
    )


def test_no_summary_is_distinct_from_no_keys(tmp):
    ca, _, _ = load(tmp)
    envelope = {"run_id": "R", "state": "completed"}
    ca._attach_extracted(envelope, {"field_keys": ["in_stock"]})
    check(
        envelope.get("extraction_status") == "no_summary",
        "an absent summary is a different status from an unmatched one",
    )


def test_longer_key_wins_over_its_own_prefix(tmp):
    ca, _, _ = load(tmp)
    got = ca._extract_fields(
        "unit_price: 24 dollars; price: 30 dollars", ["price", "unit_price"]
    )
    check(
        got.get("unit_price") == "24 dollars",
        f"a key that prefixes another cannot claim its match (got {got})",
    )


# --------------------------------------------------------------------------
# Transcript
# --------------------------------------------------------------------------


def test_transcript_parses_to_turns(tmp):
    ca, _, _ = load(tmp)
    p = plan(ca)
    r = run(ca, p["plan_id"])
    s = status(ca, r["run_id"])
    check(len(s["transcript"]) == 6, f"6 turns parsed (got {len(s['transcript'])})")
    speakers = {t["speaker"] for t in s["transcript"]}
    check(speakers == {"agent", "callee"}, f"speakers mapped (got {speakers})")


def test_wrapped_line_joins_the_turn_above(tmp):
    ca, _, _ = load(tmp)
    turns = ca.CalleProvider.normalize_transcript(
        "[00:00:01] BOT: Hello there\nand a wrapped continuation"
    )
    check(len(turns) == 1, "a wrapped line does not become its own turn")
    check(
        turns[0]["text"].endswith("continuation"),
        "a wrapped line is appended to the turn above it",
    )


# --------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------


def test_show_follows_a_plan_id_to_its_result(tmp):
    ca, _, _ = load(tmp)
    p = plan(ca)
    r = run(ca, p["plan_id"])
    status(ca, r["run_id"])
    out = ca.cmd_show(argparse.Namespace(id=p["plan_id"]))
    check("result" in out, "show on a PLAN id returns the run's result")


def test_hollow_read_does_not_replace_content(tmp):
    ca, _, _ = load(tmp)
    ca.save_result(
        {
            "run_id": "R1",
            "state": "completed",
            "summary": "unit_price: 24 dollars",
            "transcript": [{"t": "00:00:01", "speaker": "agent", "text": "hi"}],
        }
    )
    ca.save_result({"run_id": "R1", "state": "failed", "raw": {"message": "run_id not found"}})
    rec = json.loads((Path(tmp) / "R1.result.json").read_text())
    check(rec.get("summary") == "unit_price: 24 dollars", "content survives a hollow read")
    check(len(rec.get("hollow_reads") or []) == 1, "the hollow read is appended, dated")


def test_hollow_first_read_is_marked(tmp):
    ca, _, _ = load(tmp)
    ca.save_result({"run_id": "R2", "state": "failed"})
    rec = json.loads((Path(tmp) / "R2.result.json").read_text())
    check(rec.get("content_empty") is True, "an empty terminal record is marked")
    check(
        "hollow_reads" not in rec,
        "a first hollow read is not also appended to itself",
    )


def test_in_progress_is_not_persisted(tmp):
    ca, _, _ = load(tmp)
    ca.save_result({"run_id": "R3", "state": "in_progress", "summary": "partial"})
    check(
        not (Path(tmp) / "R3.result.json").exists(),
        "a non-terminal state writes no result sidecar",
    )


def test_save_result_refuses_a_token_in_the_envelope(tmp):
    ca, _, _ = load(tmp)
    ca.save_result(
        {
            "run_id": "R4",
            "state": "completed",
            "summary": "x",
            "confirm_token": "SPEND",
        }
    )
    check(
        not (Path(tmp) / "R4.result.json").exists(),
        "save_result refuses to write when the ENVELOPE carries a token",
    )


# --------------------------------------------------------------------------
# Validation, locally and free
# --------------------------------------------------------------------------


def test_malformed_number_is_rejected_not_repaired(tmp):
    ca, _, prov = load(tmp)
    args = dict(PLAN_ARGS)
    args["to"] = ["+44 7700 900123"]
    try:
        ca.cmd_plan(argparse.Namespace(**args))
        check(False, "a formatted number is rejected")
    except ca.CallAgentError:
        check(True, "a formatted number is rejected")
    check(not prov.plans, "no plan reached the provider after a bad number")


def test_missing_callee_name_is_rejected(tmp):
    ca, _, prov = load(tmp)
    args = dict(PLAN_ARGS)
    args["callee_name"] = "  "
    try:
        ca.cmd_plan(argparse.Namespace(**args))
        check(False, "a missing callee name is rejected")
    except ca.CallAgentError:
        check(True, "a missing callee name is rejected")
    check(not prov.plans, "no plan reached the provider without a callee name")


def test_region_is_format_checked_not_list_checked(tmp):
    ca, _, _ = load(tmp)
    check(ca._validate_region("gb") == "GB", "a valid-format region is upcased")
    try:
        ca._validate_region("UNITED KINGDOM")
        check(False, "a malformed region is rejected")
    except ca.CallAgentError:
        check(True, "a malformed region is rejected")
    # ZZ is not a region the provider supports. It must still pass: a local
    # copy of their table can only go stale, and would fail by refusing a call
    # that would have worked.
    check(
        ca._validate_region("ZZ") == "ZZ",
        "an unknown two-letter region is passed through, not refused locally",
    )


# --------------------------------------------------------------------------
# Goal assembly and the rewrite modes
# --------------------------------------------------------------------------


def test_goal_carries_the_identity_ask_and_the_field_order(tmp):
    ca, _, _ = load(tmp)
    g = ca.build_goal(
        "Check availability",
        ["How much is it", "Do you have it in stock"],
        "Miller Hardware",
        ["unit_price", "in_stock"],
    )
    check("Miller Hardware" in g, "the callee name is substituted into the goal")
    check("{name}" not in g, "no unformatted placeholder survives into the goal")
    check(
        g.index("(1) unit_price") < g.index("(2) in_stock"),
        "fields appear in the order they were given",
    )


def test_every_rewrite_mode_sets_the_boolean(tmp):
    """The boolean cannot discriminate, and that is the point.

    All five mutations -- including `normalised`, which changes nothing that
    matters -- set goal_modified_by_provider. A harmless rewording and a
    dropped field are indistinguishable here. That is why the four anomaly
    categories are a judgement made by the reader against the stored pair, and
    why no numeric threshold appears in the skill text.
    """
    for mode in ["normalised", "added", "merged", "referent", "dropped"]:
        sub = tempfile.mkdtemp()
        try:
            ca, _, _ = load(sub, rewrite=mode)
            p = plan(ca)
            check(
                p["goal_modified_by_provider"] is True,
                f"mode {mode!r} sets goal_modified_by_provider",
            )
        finally:
            shutil.rmtree(sub, ignore_errors=True)

    sub = tempfile.mkdtemp()
    try:
        ca, _, _ = load(sub, rewrite="none")
        p = plan(ca)
        check(
            p["goal_modified_by_provider"] is False,
            "mode 'none' leaves goal_modified_by_provider false",
        )
    finally:
        shutil.rmtree(sub, ignore_errors=True)


def test_display_goal_is_persisted_for_the_reader(tmp):
    ca, _, _ = load(tmp, rewrite="added")
    p = plan(ca)
    rec = json.loads((Path(tmp) / f"{p['plan_id']}.json").read_text())
    check("goal_sent" in rec and "display_goal" in rec, "both goal texts persisted")
    check(
        rec["goal_sent"] != rec["display_goal"],
        "the stored pair differs, so a reader can diff it",
    )


def test_abandoned_diff_fields_do_not_exist(tmp):
    """Sentence-level goal diffing was built, measured and abandoned.

    Exact matching cannot separate a paraphrase from a removal, and splitting
    on [.!?] does not split Devanagari -- a Hindi goal would report no change
    at all, which is false silence on a safety-relevant field. If any of these
    names reappear, the mechanism has been reintroduced by another route.
    """
    src = Path(__file__).with_name("call_agent.py").read_text()
    for name in ["goal_additions", "constraints_dropped", "diff_goal"]:
        check(name not in src, f"the abandoned diff field {name!r} is absent")


# --------------------------------------------------------------------------


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in tests:
        print(f"\n{fn.__name__}")
        tmp = tempfile.mkdtemp()
        try:
            fn(tmp)
        except Exception as exc:  # noqa: BLE001
            print(f"  ERROR {type(exc).__name__}: {exc}")
            FAILURES.append(f"{fn.__name__}: {exc}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    print(f"\n{'-' * 60}")
    if FAILURES:
        print(f"{len(FAILURES)} FAILED")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print(f"all {len(tests)} test groups passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
