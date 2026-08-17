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
