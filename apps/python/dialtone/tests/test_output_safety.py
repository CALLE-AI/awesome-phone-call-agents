import json
from types import SimpleNamespace

import pytest

from dialtone import runner
from dialtone.privacy import mask_text, public_value


@pytest.mark.parametrize("phone", ["+1١٢٣٤٥٦٧٨٩", "+12025550123\n", "2025550123"])
def test_live_builder_rejects_non_ascii_or_inexact_phone(phone):
    with pytest.raises(SystemExit):
        runner.build_request(phone, "Ask about hours", "the operator", "plain", "123")


def test_public_masking_preserves_private_request():
    request = runner.build_request("+12025550123", "Call back at (212) 555-0199", "operator", "plain", "123")
    shown = json.dumps(public_value(request))
    assert "2025550123" not in shown and "555-0199" not in shown
    assert request["recipients"][0]["phones"] == ["+12025550123"]
    assert "(212) 555-0199" in request["task"]


def test_nested_derived_results_are_masked_before_save(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "RESULTS_DIR", tmp_path)
    result = {"name": "test", "verdict": {"reasons": ["They said +12025550123"], "artifact": "(212) 555-0199"}}
    path = runner.save_result(result)
    assert "2025550123" not in path.read_text() and "555-0199" not in path.read_text()
    assert "2025550123" in result["verdict"]["reasons"][0]


def test_vapi_error_body_is_omitted():
    from dialtone.line.vapi import Vapi
    vapi = Vapi.__new__(Vapi)
    response = SimpleNamespace(status_code=400, text="private provider token and +12025550123")
    vapi.http = SimpleNamespace(request=lambda *args, **kwargs: response)
    with pytest.raises(SystemExit) as error:
        vapi._req("GET", "/call/example")
    assert "400" in str(error.value)
    assert "token" not in str(error.value) and "2025550123" not in str(error.value)


def test_cli_provider_exception_is_safe(monkeypatch, capsys):
    from dialtone import cli
    def fail(_argv):
        raise RuntimeError("private token +12025550123")
    monkeypatch.setattr(cli, "_main", fail)
    assert cli.main([]) == 1
    shown = capsys.readouterr().err
    assert "private token" not in shown and "2025550123" not in shown


def test_non_phone_text_is_unchanged():
    assert mask_text("Booking LT1234, party of 2") == "Booking LT1234, party of 2"
