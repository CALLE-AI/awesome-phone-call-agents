"""End-to-end tests for the command line.

These run the real commands against a real temporary project, because the
promise the CLI makes -- ``pip install``, ``redline run``, find a real defect,
in seconds, with no account -- is only worth anything if it is exercised the
way a user would exercise it.

Exit codes are asserted throughout: this tool is meant to be run in CI, where
the exit code is the entire interface.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from redline.cli import app

runner = CliRunner()

# Standards-reserved fiction: the NANP documentation block, which rings
# nothing anywhere. Never a number anybody could answer.
FICTIONAL = "+" + "1415555" + "0142"
OTHER_FICTIONAL = "+" + "1415555" + "0177"


@pytest.fixture
def project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A fresh project created by `redline init`, as a new user would have it."""
    monkeypatch.chdir(tmp_path)
    result = runner.invoke(app, ["init"])
    assert result.exit_code == 0, result.output
    return tmp_path


class TestInit:
    def test_it_creates_the_starter_files(self, tmp_path: Path, monkeypatch) -> None:
        monkeypatch.chdir(tmp_path)
        result = runner.invoke(app, ["init"])
        assert result.exit_code == 0
        assert (tmp_path / "redline.yaml").exists()
        assert (tmp_path / ".github/workflows/redline.yml").exists()

    def test_it_does_not_clobber_on_a_second_run(self, project: Path) -> None:
        (project / "redline.yaml").write_text("subject:\n  goal: mine\n", "utf-8")
        result = runner.invoke(app, ["init"])
        assert "exists" in result.output
        assert (project / "redline.yaml").read_text("utf-8") == (
            "subject:\n  goal: mine\n"
        )

    def test_it_says_what_to_do_next(self, project: Path) -> None:
        result = runner.invoke(app, ["init", "--force"])
        assert "redline run" in result.output


class TestCheck:
    def test_a_fresh_project_checks_out(self, project: Path) -> None:
        result = runner.invoke(app, ["check"])
        assert result.exit_code == 0
        assert "config valid" in result.output

    def test_it_states_that_no_credential_is_needed(self, project: Path) -> None:
        # The single most important sentence for a reviewer deciding whether
        # to bother running this.
        result = runner.invoke(app, ["check"])
        assert "no credentials required" in result.output

    def test_it_warns_about_a_boolean_outcome(self, project: Path) -> None:
        result = runner.invoke(app, ["check"])
        assert "boolean field" in result.output

    def test_a_missing_config_is_a_usage_error(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.chdir(tmp_path)
        result = runner.invoke(app, ["check"])
        assert result.exit_code == 2
        assert "redline init" in result.output

    def test_a_broken_scenario_names_the_file(self, project: Path) -> None:
        (project / "scenarios" / "broken.yaml").write_text(
            "id: broken\nfamily: nonsense\n", encoding="utf-8"
        )
        result = runner.invoke(app, ["check"])
        assert result.exit_code == 2
        assert "broken.yaml" in result.output

    def test_a_mistyped_assertion_is_caught_before_anything_runs(
        self, project: Path
    ) -> None:
        (project / "scenarios" / "typo.yaml").write_text(
            "id: typo-case\n"
            "family: ambiguity\n"
            "severity: low\n"
            "title: A scenario with a mistyped assertion\n"
            "persona:\n  opening: answer\n"
            "expect:\n  - assert: no_canary_leek\n",
            encoding="utf-8",
        )
        result = runner.invoke(app, ["check"])
        assert result.exit_code == 2
        assert "unknown assertion" in result.output


class TestRun:
    def test_the_first_run_finds_a_real_defect(self, project: Path) -> None:
        # The whole promise of the tool, asserted directly.
        result = runner.invoke(app, ["run"])
        assert result.exit_code == 1
        assert "FAIL" in result.output
        assert "soft-no-as-confirmation" in result.output

    def test_it_places_no_calls(self, project: Path) -> None:
        result = runner.invoke(app, ["run"])
        assert "0 real calls" in result.output

    def test_hardening_the_goal_alone_is_not_enough(self, project: Path) -> None:
        # A goal that demands an explicit answer cannot help if the schema has
        # nowhere to put "I don't know". The defect is authored into the
        # boolean, and this is the lesson the tool exists to teach.
        config = (project / "redline.yaml").read_text("utf-8")
        config = config.replace(
            "Ask them to confirm yes or no.",
            "Ask them to confirm yes or no. Require an explicit yes.",
        )
        (project / "redline.yaml").write_text(config, encoding="utf-8")
        result = runner.invoke(app, ["run"])
        assert result.exit_code == 1
        assert "evidence_grounded" in result.output

    def test_hardening_the_goal_and_the_schema_exits_zero(self, project: Path) -> None:
        assert runner.invoke(app, ["fix", "--apply"]).exit_code == 0
        assert runner.invoke(app, ["run"]).exit_code == 0

    def test_only_filters_the_catalogue(self, project: Path) -> None:
        result = runner.invoke(app, ["run", "--only", "ambiguity"])
        assert "1 scenarios" in result.output

    def test_an_unmatched_filter_is_a_usage_error(self, project: Path) -> None:
        result = runner.invoke(app, ["run", "--only", "no-such-thing"])
        assert result.exit_code == 2
        assert "redline scenarios" in result.output

    def test_json_output_is_written_and_parseable(self, project: Path) -> None:
        result = runner.invoke(app, ["run", "--json", "out.json"])
        assert result.exit_code == 1
        payload = json.loads((project / "out.json").read_text("utf-8"))
        assert payload["summary"]["failed"] == 1

    def test_html_output_is_self_contained(self, project: Path) -> None:
        runner.invoke(app, ["run", "--html", "out.html"])
        html = (project / "out.html").read_text("utf-8")
        assert "https://" not in html
        assert "<script" not in html.lower()

    def test_an_unknown_transport_is_refused(self, project: Path) -> None:
        result = runner.invoke(app, ["run", "--transport", "carrier-pigeon"])
        assert result.exit_code == 2
        assert "unknown transport" in result.output

    def test_mock_is_a_legacy_alias_reported_as_static(self, project: Path) -> None:
        result = runner.invoke(
            app,
            ["run", "--transport", "mock", "--json", "out.json"],
        )
        assert result.exit_code == 1
        payload = json.loads((project / "out.json").read_text("utf-8"))
        assert payload["transport"] == "static"

    def test_transport_live_no_longer_exists(self, project: Path) -> None:
        # One character from `--transport replay` in a shell history, and the
        # two differ by a phone call. Refused rather than honoured.
        result = runner.invoke(app, ["run", "--transport", "live"])
        assert result.exit_code == 2
        assert "--live" in result.output

    def test_live_without_the_attestation_is_refused(self, project: Path) -> None:
        result = runner.invoke(app, ["run", "--live"])
        assert result.exit_code == 2
        assert "--i-am-authorized-to-test-this-target" in result.output

    def test_live_without_a_recipient_is_refused(self, project: Path) -> None:
        result = runner.invoke(
            app, ["run", "--live", "--i-am-authorized-to-test-this-target"]
        )
        assert result.exit_code == 2
        assert "--recipient" in result.output

    def test_live_without_a_scope_file_is_refused(self, project: Path) -> None:
        result = runner.invoke(
            app,
            [
                "run",
                "--live",
                "--i-am-authorized-to-test-this-target",
                "--recipient",
                FICTIONAL,
                "--budget",
                "1",
            ],
        )
        assert result.exit_code == 2
        assert "redline.scope.yaml" in result.output

    def test_live_against_a_number_the_scope_does_not_cover_is_refused(
        self, project: Path
    ) -> None:
        (project / "redline.scope.yaml").write_text(
            "authorised_by: Dana Okafor\n"
            "contact: dana@example.com\n"
            "expires: 2099-12-31\n"
            "targets:\n"
            f'  - number: "{FICTIONAL}"\n'
            "    owner: Test handset\n",
            encoding="utf-8",
        )
        result = runner.invoke(
            app,
            [
                "run",
                "--live",
                "--i-am-authorized-to-test-this-target",
                "--recipient",
                OTHER_FICTIONAL,
                "--budget",
                "1",
            ],
        )
        assert result.exit_code == 2
        assert "exact" in result.output
        # The refusal must not print the number it refused.
        assert OTHER_FICTIONAL not in result.output

    def test_live_without_a_credential_is_refused(
        self, project: Path, monkeypatch
    ) -> None:
        monkeypatch.delenv("REDLINE_CALLE_API_KEY", raising=False)
        (project / "redline.scope.yaml").write_text(
            "authorised_by: Dana Okafor\n"
            "contact: dana@example.com\n"
            "expires: 2099-12-31\n"
            "targets:\n"
            f'  - number: "{FICTIONAL}"\n'
            "    owner: Test handset\n",
            encoding="utf-8",
        )
        result = runner.invoke(
            app,
            [
                "run",
                "--live",
                "--i-am-authorized-to-test-this-target",
                "--recipient",
                FICTIONAL,
                "--budget",
                "1",
            ],
        )
        assert result.exit_code == 2
        assert "REDLINE_CALLE_API_KEY" in result.output


class TestExplain:
    def test_it_shows_the_transcript_and_the_reason(self, project: Path) -> None:
        result = runner.invoke(app, ["explain", "soft-no-as-confirmation"])
        assert result.exit_code == 0
        assert "TRANSCRIPT" in result.output
        assert "WHY" in result.output

    def test_it_names_the_missing_defence(self, project: Path) -> None:
        result = runner.invoke(app, ["explain", "soft-no-as-confirmation"])
        assert "ambiguity halt" in result.output

    def test_an_unknown_scenario_is_a_usage_error(self, project: Path) -> None:
        result = runner.invoke(app, ["explain", "no-such-scenario"])
        assert result.exit_code == 2


class TestFix:
    def test_it_proposes_a_diff_and_explains_why(self, project: Path) -> None:
        result = runner.invoke(app, ["fix"])
        assert result.exit_code == 0
        assert "Safety rules for this call" in result.output
        assert "closes: soft-no-as-confirmation" in result.output

    def test_it_changes_nothing_without_apply(self, project: Path) -> None:
        original = (project / "redline.yaml").read_text("utf-8")
        runner.invoke(app, ["fix"])
        assert (project / "redline.yaml").read_text("utf-8") == original

    def test_apply_writes_the_config_and_backs_it_up(self, project: Path) -> None:
        original = (project / "redline.yaml").read_text("utf-8")
        result = runner.invoke(app, ["fix", "--apply"])
        assert result.exit_code == 0
        assert (project / "redline.yaml").read_text("utf-8") != original
        assert (project / "redline.yaml.bak").read_text("utf-8") == original

    def test_it_admits_that_comments_are_lost(self, project: Path) -> None:
        # A tool that silently mangles a file it was asked to improve does not
        # get used twice.
        result = runner.invoke(app, ["fix", "--apply"])
        assert "not preserved" in result.output

    def test_applying_the_fix_makes_the_run_pass(self, project: Path) -> None:
        runner.invoke(app, ["fix", "--apply"])
        assert runner.invoke(app, ["run"]).exit_code == 0

    def test_a_clean_subject_has_nothing_to_fix(self, project: Path) -> None:
        runner.invoke(app, ["fix", "--apply"])
        result = runner.invoke(app, ["fix"])
        assert "Nothing to fix" in result.output


class TestVerify:
    def test_it_reports_the_before_and_after(self, project: Path) -> None:
        result = runner.invoke(app, ["verify"])
        assert result.exit_code == 0
        assert "before" in result.output
        assert "after" in result.output
        assert "CLOSED" in result.output

    def test_it_says_when_everything_is_closed(self, project: Path) -> None:
        result = runner.invoke(app, ["verify"])
        assert "now closed" in result.output

    def test_verification_does_not_modify_the_config(self, project: Path) -> None:
        original = (project / "redline.yaml").read_text("utf-8")
        runner.invoke(app, ["verify"])
        assert (project / "redline.yaml").read_text("utf-8") == original

    def test_it_writes_a_before_and_after_json(self, project: Path) -> None:
        runner.invoke(app, ["verify", "--json", "v.json"])
        payload = json.loads((project / "v.json").read_text("utf-8"))
        assert payload["closed"] == ["soft-no-as-confirmation"]
        assert payload["regressions"] == []

    def test_nothing_to_verify_when_already_hardened(self, project: Path) -> None:
        runner.invoke(app, ["fix", "--apply"])
        result = runner.invoke(app, ["verify"])
        assert "Nothing to verify" in result.output


class TestIntrospection:
    def test_scenarios_lists_the_catalogue(self, project: Path) -> None:
        result = runner.invoke(app, ["scenarios"])
        assert result.exit_code == 0
        assert "soft-no-as-confirmation" in result.output

    def test_assertions_lists_every_check_with_a_description(self) -> None:
        result = runner.invoke(app, ["assertions"])
        assert result.exit_code == 0
        assert "no_canary_leak" in result.output
        assert "evidence_grounded" in result.output

    def test_version_prints_a_version(self) -> None:
        result = runner.invoke(app, ["version"])
        assert result.exit_code == 0
        assert "redline" in result.output

    def test_no_arguments_shows_help(self) -> None:
        result = runner.invoke(app, [])
        assert "init" in result.output
        assert "verify" in result.output


class TestTheFullLoopFromTheCommandLine:
    def test_init_run_fix_verify_run(self, project: Path) -> None:
        """The demo, exactly as it will be recorded."""
        assert runner.invoke(app, ["run"]).exit_code == 1

        fix = runner.invoke(app, ["fix", "--apply"])
        assert fix.exit_code == 0

        verify = runner.invoke(app, ["verify"])
        assert "Nothing to verify" in verify.output

        assert runner.invoke(app, ["run"]).exit_code == 0


class TestPreflight:
    """The free path onto the real platform.

    Every test here drives a fake planner. The point is not to test CALL-E, it
    is to test that this command spends nothing and reports honestly on what
    planning returns -- including the case where CALL-E refuses a goal, which
    is a real risk for a tool whose scenarios ask an agent to read out a
    reference number.
    """

    def plan_returning(self, monkeypatch, payload: dict) -> list[str]:
        """Install a fake planner and record what it was asked."""
        seen: list[str] = []

        def fake_plan_call(goal: str, *, ledger, **kwargs):
            from redline.calle.plan import PLAN_TOOL, PlanResult

            seen.append(goal)
            ledger.record_dry(PLAN_TOOL)
            return PlanResult(**payload)

        import redline.cli as cli_module

        monkeypatch.setattr(cli_module, "plan_call", fake_plan_call)
        monkeypatch.setattr(cli_module, "cli_available", lambda: True)
        return seen

    def test_it_reports_an_accepted_goal(self, project: Path, monkeypatch) -> None:
        self.plan_returning(monkeypatch, {"accepted": True, "plan_id": "plan_1"})
        result = runner.invoke(app, ["preflight"])
        assert result.exit_code == 0
        assert "ACCEPTED" in result.output

    def test_it_says_a_run_costs_nothing(self, project: Path, monkeypatch) -> None:
        self.plan_returning(monkeypatch, {"accepted": True, "plan_id": "plan_1"})
        result = runner.invoke(app, ["preflight"])
        assert "0 calls, 0 credits" in result.output

    def test_a_refusal_is_reported_as_a_refusal(
        self, project: Path, monkeypatch
    ) -> None:
        # The risk this command exists to surface: REDLINE's own scenarios ask
        # an agent to read back a reference, and CALL-E's content screen has
        # been observed refusing exactly that.
        self.plan_returning(
            monkeypatch,
            {
                "accepted": False,
                "refusal": "I can't place a call that involves "
                "confirmation-code readback.",
            },
        )
        result = runner.invoke(app, ["preflight"])
        assert "REFUSED" in result.output
        assert "confirmation-code readback" in result.output

    def test_it_shows_what_call_e_rewrote_the_goal_into(
        self, project: Path, monkeypatch
    ) -> None:
        # `display_goal` is authoritative over what you typed, so a defence
        # audit has to run on it rather than on the draft.
        self.plan_returning(
            monkeypatch,
            {
                "accepted": True,
                "plan_id": "plan_1",
                "display_goal": "Call the customer. Do not leave a message if "
                "you reach a voicemail.",
            },
        )
        result = runner.invoke(app, ["preflight"])
        assert "rewrote the goal" in result.output
        assert "CALL-E added: machine detection" in result.output

    def test_a_defence_lost_in_the_rewrite_is_flagged(
        self, project: Path, monkeypatch
    ) -> None:
        # The finding nobody is looking for: you wrote a defence, and the goal
        # CALL-E will actually run no longer states it.
        config = (project / "redline.yaml").read_text("utf-8")
        (project / "redline.yaml").write_text(
            config.replace(
                "Ask them to confirm yes or no.",
                "Ask them to confirm yes or no. Never read out any reference number.",
            ),
            encoding="utf-8",
        )
        self.plan_returning(
            monkeypatch,
            {
                "accepted": True,
                "plan_id": "plan_1",
                "display_goal": "Call the customer and confirm Thursday at 2pm.",
            },
        )
        result = runner.invoke(app, ["preflight"])
        assert "the rewrite does not" in result.output
        assert "no context disclosure" in result.output

    def test_hardened_plans_the_patched_goal_too(
        self, project: Path, monkeypatch
    ) -> None:
        seen = self.plan_returning(monkeypatch, {"accepted": True, "plan_id": "plan_1"})
        result = runner.invoke(app, ["preflight", "--hardened"])
        assert result.exit_code == 0
        assert len(seen) == 2
        assert "Safety rules for this call" in seen[1]

    def test_a_missing_cli_says_what_to_install(
        self, project: Path, monkeypatch
    ) -> None:
        import redline.cli as cli_module

        monkeypatch.setattr(cli_module, "cli_available", lambda: False)
        result = runner.invoke(app, ["preflight"])
        assert result.exit_code == 2
        # rich wraps the line, so match a fragment that survives the wrap.
        assert "Install Node" in result.output

    def test_the_schema_is_linted_locally_for_free(
        self, project: Path, monkeypatch
    ) -> None:
        self.plan_returning(monkeypatch, {"accepted": True, "plan_id": "plan_1"})
        result = runner.invoke(app, ["preflight"])
        # The starter schema is a bare boolean, which is accepted but regretted.
        assert "boolean field" in result.output
