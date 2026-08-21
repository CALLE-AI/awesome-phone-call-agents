import screen

SAMPLES = "samples/suspicious_email.txt"


def _run_preview(monkeypatch, argv):
    monkeypatch.setattr("sys.argv", ["screen.py", *argv])
    return screen.main()


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
