"""A scenario cannot make the phone ring. Proved, not asserted in a README.

The premise of REDLINE's offline mode is that running the catalogue costs
nothing: no credentials, no network, no credits, no stranger's phone ringing.
Everything else in the project depends on that being true -- it is why the
catalogue can be a regression test, why CI can run it, and why somebody can
try the tool before they trust it.

A catalogue is also the part contributors extend. So the question this file
answers is not "does the shipped catalogue behave" but "*could* a scenario
misbehave" -- could a YAML file, by any route, cause a real call to be placed?

The answer has to be structural rather than statistical. Each test below closes
one route:

* the scenario format has no way to name a transport, and rejects any key it
  does not know;
* the loader constructs no transport, so there is nothing for a scenario to
  reach;
* the entire shipped suite, driven end to end, leaves the spend ledger at zero;
* the only object that can spend is the live transport, and it cannot be built
  without a credential, a budget and an allowlist that has to be passed in.
"""

from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from redline import runner
from redline import scenario as scenario_package
from redline.evaluate import assertion_names
from redline.remediate import generate_patch
from redline.runner import run_suite
from redline.scenario import load_scenario, load_scenarios
from redline.scenario.loader import ScenarioError
from redline.spend import CREDITS_PER_CALL, SpendLedger, WetOperationRefusedError
from redline.subject import SubjectUnderTest
from redline.transport import LiveTransport, MockTransport
from redline.verify import verify_patch

PACKAGE = Path(__file__).resolve().parent.parent

BARE_GOAL = (
    "Call the customer and confirm whether they can still attend their "
    "appointment on Thursday at 2pm. Ask them to confirm yes or no."
)


def agent() -> SubjectUnderTest:
    return SubjectUnderTest(
        name="appointment-agent",
        goal=BARE_GOAL,
        result_schema={
            "type": "object",
            "properties": {"confirmed": {"type": "boolean"}},
        },
        context={"appointment_time": "Thursday 2pm"},
    )


@pytest.fixture(scope="module")
def catalogue():
    return load_scenarios(PACKAGE / "scenarios", known_assertions=assertion_names())


@pytest.fixture(scope="module")
def benign():
    return load_scenarios(PACKAGE / "benign", known_assertions=assertion_names())


class TestTheScenarioFormatCannotReachTheWetPath:
    """There is no key to set, and unknown keys are refused."""

    def test_the_schema_forbids_unknown_top_level_keys(self) -> None:
        import json

        schema = json.loads(
            (PACKAGE / "redline" / "scenario" / "schema.json").read_text(
                encoding="utf-8"
            )
        )
        assert schema["additionalProperties"] is False

    def test_no_key_in_the_schema_names_a_transport(self) -> None:
        import json

        text = (PACKAGE / "redline" / "scenario" / "schema.json").read_text(
            encoding="utf-8"
        )
        schema = json.loads(text)
        assert "transport" not in schema["properties"]
        # And nowhere nested either: a `transport` block inside `persona` would
        # be just as dangerous and much easier to miss in review.
        for forbidden in ("transport", "recipient", "budget", "api_key", "live"):
            assert f'"{forbidden}"' not in text, forbidden

    @pytest.mark.parametrize(
        "injected",
        [
            {"transport": "live"},
            {"recipient": "+" + "14155550142"},
            {"budget": 5},
            {"live": True},
        ],
    )
    def test_a_scenario_that_tries_to_name_one_is_refused(
        self, injected: dict[str, object]
    ) -> None:
        document = {
            "id": "probe",
            "family": "adversarial",
            "severity": "high",
            "title": "Probe",
            "rationale": "x" * 130,
            "persona": {"opening": "answer", "turns": [{"say": "Hello"}]},
            "expect": [{"assert": "max_turns", "lte": 4, "because": "y"}],
            **injected,
        }
        with pytest.raises(ScenarioError):
            load_scenario(document, known_assertions=assertion_names())

    def test_the_loader_imports_no_transport_at_all(self) -> None:
        # The strongest form of this: a scenario cannot reach what its own
        # module has never heard of.
        source = inspect.getsource(scenario_package.loader)
        assert "transport" not in source.lower()
        assert "LiveTransport" not in source


class TestTheShippedSuiteSpendsNothing:
    """Every scenario that ships, driven end to end, against a real ledger."""

    def test_running_the_catalogue_places_no_calls(self, catalogue) -> None:
        report = run_suite(agent(), list(catalogue), MockTransport())
        assert report.real_calls_placed == 0

    def test_running_the_benign_suite_places_no_calls(self, benign) -> None:
        report = run_suite(agent(), list(benign), MockTransport())
        assert report.real_calls_placed == 0

    def test_the_whole_loop_leaves_the_ledger_at_zero(self, catalogue, benign) -> None:
        # run, fix, verify -- the sequence the README tells a reviewer to run.
        ledger = SpendLedger(call_budget=0)
        subject = agent()
        before = run_suite(subject, list(catalogue), MockTransport())
        patch = generate_patch(before, subject)
        verify_patch(
            patch,
            list(catalogue),
            MockTransport(),
            before=before,
            benign=list(benign),
        )
        # Nothing above was handed the ledger, which is the point: there is no
        # route from a scenario to something that could have touched it.
        ledger.assert_nothing_was_spent()

    def test_the_mock_declares_itself_dry(self) -> None:
        assert MockTransport.places_real_calls is False

    def test_the_runner_counts_calls_from_the_transport_not_the_scenario(
        self,
    ) -> None:
        # So a scenario cannot understate what it cost, either.
        source = inspect.getsource(runner)
        assert "transport.places_real_calls" in source


class TestOnlyTheLiveTransportCanSpend:
    def test_it_declares_itself_wet(self) -> None:
        assert LiveTransport.places_real_calls is True

    def test_it_cannot_be_built_without_an_allowlist(self) -> None:
        with pytest.raises(TypeError):
            LiveTransport(recipient="+" + "14155550142", budget=1)  # type: ignore[call-arg]

    def test_it_cannot_be_built_without_a_budget(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from redline.transport import BudgetExceededError

        number = "+" + "14155550142"
        monkeypatch.setenv("REDLINE_CALLE_API_KEY", "test-key-not-real")
        with pytest.raises(BudgetExceededError, match="budget"):
            LiveTransport(recipient=number, budget=0, allowlist=[number])

    def test_the_ledger_refuses_a_wet_operation_with_no_budget(self) -> None:
        ledger = SpendLedger(call_budget=0)
        with pytest.raises(WetOperationRefusedError):
            ledger.record_wet("run_call")

    def test_one_call_costs_five_credits(self) -> None:
        # Stated here because it is the number that makes the guard rails
        # worth having: an unattended run of the catalogue would be a hundred
        # calls and five hundred credits.
        assert CREDITS_PER_CALL == 5
