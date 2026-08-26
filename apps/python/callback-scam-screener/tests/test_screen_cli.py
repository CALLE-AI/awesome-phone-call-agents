import screen
from pipeline.caller import CallEClient, CallResult
from pipeline.models import CallMetadata

SAMPLES = "samples/suspicious_email.txt"


def _run_preview(monkeypatch, argv):
    monkeypatch.setattr("sys.argv", ["screen.py", *argv])
    return screen.main()


class _StubClient(CallEClient):
    """Stands in for RealCallEClient so a real subprocess/CLI is never
    invoked, while still exercising main()'s actual exception handling."""

    def __init__(self, number_dialed: str, **kwargs):
        self._number_dialed = number_dialed

    def place_screening_call(self, phone_number, task, result_schema=None):
        return CallResult(
            transcript="a real conversation happened",
            metadata=CallMetadata(
                number_dialed=self._number_dialed, duration_seconds=30, timestamp="now", status="COMPLETED"
            ),
        )


def test_preview_masks_the_extracted_number_by_default(monkeypatch, capsys):
    exit_code = _run_preview(
        monkeypatch, ["--email", SAMPLES, "--sender-domain", "secure-alerts-billing.com"]
    )
    out = capsys.readouterr().out
    assert exit_code == screen.EXIT_OK
    assert "5550187" not in out  # the sample email's number, unmasked, must not appear
    assert "*" in out  # masked form should be present instead


def test_preview_shows_full_number_when_requested(monkeypatch, capsys):
    exit_code = _run_preview(
        monkeypatch,
        ["--email", SAMPLES, "--sender-domain", "secure-alerts-billing.com", "--show-full-number"],
    )
    out = capsys.readouterr().out
    assert exit_code == screen.EXIT_OK
    assert "555-0187" in out  # full number visible when explicitly requested


def test_preview_masks_the_number_even_when_it_shares_the_claimed_reason_line(monkeypatch, capsys, tmp_path):
    # samples/suspicious_email.txt happens to put the urgency phrase and the
    # phone number on different lines, so it can't catch a leak specific to
    # "Claimed reason:" - real callback-scam emails routinely put both in
    # the same sentence (e.g. "call back immediately at <number>"), which is
    # exactly what claimed_reason extracts verbatim.
    email = tmp_path / "urgent_same_line.txt"
    email.write_text(
        "Subject: Account Suspended\n\n"
        "Your account has been suspended. Call back immediately at +18005550187 to resolve this.\n",
        encoding="utf-8",
    )
    exit_code = _run_preview(
        monkeypatch, ["--email", str(email), "--sender-domain", "secure-alerts-billing.com"]
    )
    out = capsys.readouterr().out
    assert exit_code == screen.EXIT_OK
    assert "5550187" not in out
    assert "Claimed reason:" in out


def test_live_run_exits_54_on_recipient_mismatch(monkeypatch, capsys, tmp_path):
    # End-to-end through screen.main() (no real subprocess/CLI involved):
    # CALL-E reports a genuinely different destination than requested, which
    # must surface as exit code 54 with an accurate message, not fall
    # through to the generic "CALL-E would not plan this call" (51) path.
    #
    # screen.py has no --state-path override, so CallGuardrails otherwise
    # uses the real on-disk default state file - shared across every test in
    # the suite that goes through this path, and liable to already have this
    # fictional number recorded as attempted/screened by another test,
    # producing exit 52 instead. Redirect state_path to an isolated tmp file.
    real_call_guardrails = screen.CallGuardrails
    monkeypatch.setattr(
        screen, "CallGuardrails",
        lambda **kwargs: real_call_guardrails(**kwargs, state_path=tmp_path / "state.json"),
    )
    monkeypatch.setattr(screen, "RealCallEClient", lambda **kwargs: _StubClient("+19995550199"))
    exit_code = _run_preview(
        monkeypatch,
        [
            "--email", SAMPLES,
            "--sender-domain", "secure-alerts-billing.com",
            "--live", "--confirm",
            "--to-phone", "+18005550187",
            "--allow-number", "+18005550187",
        ],
    )
    err = capsys.readouterr().err
    assert exit_code == screen.EXIT_RECIPIENT_MISMATCH
    assert "mismatched recipient" in err
    assert "would not plan this call" not in err  # must not be misreported as a plan rejection


# --- --unrestricted must not itself be treated as authorization for a
# specific destination — a PR reviewer flagged this: "an acknowledgment that
# any extracted number may be dialed is not recipient authorization." Fixed
# by requiring --confirm-number to independently match --to-phone exactly. ---


def test_unrestricted_without_confirm_number_is_refused(monkeypatch, capsys):
    exit_code = _run_preview(
        monkeypatch,
        [
            "--email", SAMPLES,
            "--sender-domain", "secure-alerts-billing.com",
            "--live", "--confirm",
            "--to-phone", "+18005550187",
            "--unrestricted",
        ],
    )
    err = capsys.readouterr().err
    assert exit_code == screen.EXIT_USAGE_OR_REFUSAL
    assert "--confirm-number" in err


def test_unrestricted_with_mismatched_confirm_number_is_refused(monkeypatch, capsys):
    exit_code = _run_preview(
        monkeypatch,
        [
            "--email", SAMPLES,
            "--sender-domain", "secure-alerts-billing.com",
            "--live", "--confirm",
            "--to-phone", "+18005550187",
            "--unrestricted",
            "--confirm-number", "+19995550199",  # deliberately different from --to-phone
        ],
    )
    err = capsys.readouterr().err
    assert exit_code == screen.EXIT_USAGE_OR_REFUSAL
    assert "--confirm-number" in err


def test_unrestricted_with_matching_confirm_number_proceeds(monkeypatch, capsys, tmp_path):
    real_call_guardrails = screen.CallGuardrails
    monkeypatch.setattr(
        screen, "CallGuardrails",
        lambda **kwargs: real_call_guardrails(**kwargs, state_path=tmp_path / "state.json"),
    )
    monkeypatch.setattr(screen, "RealCallEClient", lambda **kwargs: _StubClient("+18005550187"))
    exit_code = _run_preview(
        monkeypatch,
        [
            "--email", SAMPLES,
            "--sender-domain", "secure-alerts-billing.com",
            "--live", "--confirm",
            "--to-phone", "+18005550187",
            "--unrestricted",
            "--confirm-number", "+18005550187",  # matches --to-phone exactly
        ],
    )
    assert exit_code == screen.EXIT_OK
