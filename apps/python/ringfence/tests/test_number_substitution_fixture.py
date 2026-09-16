"""Proves the number-substitution-attack fixture itself demonstrates the
security invariant, not just the synthetic cases in
test_invariant_never_calls_request_supplied_number.py.
"""

import json
from pathlib import Path

from ringfence.case import Case
from ringfence.verify_call import resolve_dial_target

FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent
    / "fixtures"
    / "12_number_substitution_attack.json"
)


def test_fixture_case_dials_on_file_number_never_the_smuggled_one():
    record = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    case_data = record["case"]
    assert case_data["request_supplied_callback_number"] is not None
    assert case_data["request_supplied_callback_number"] != case_data["on_file_phone"]

    case = Case.from_dict(case_data)
    assert resolve_dial_target(case) == case_data["on_file_phone"]
