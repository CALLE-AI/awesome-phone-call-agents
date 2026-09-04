"""Tests for `redline doctor` and the .env loader.

Two properties carry this file. The credential must never appear in full in any
output, and `doctor` must have no path to placing a call -- the whole reason it
exists is that finding out your key is wrong by dialling costs five credits and
rings somebody's phone.

Every key here is fabricated.
"""

from __future__ import annotations

import os
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest
from typer.testing import CliRunner

from redline.cli import app
from redline.doctor import (
    CheckStatus,
    mask_secret,
    run_diagnostics,
)
from redline.env import find_dotenv, load_dotenv, parse_dotenv

runner = CliRunner()

FAKE_KEY = "iams_live_" + "9f2b7d41ae6c3095db8e4417"
FICTIONAL = "+" + "1415555" + "0142"


#: Variables `run_diagnostics` may read or, via the .env loader, set.
#:
#: REDLINE_ALLOWED_RECIPIENTS is listed although nothing reads it any more: it
#: existed in an earlier version, so a developer's shell may still export it,
#: and a test that passed only because of a stale variable would be worse than
#: no test. Cleared here, and proved inert in test_transport_live_calls.py.
MANAGED = (
    "REDLINE_CALLE_API_KEY",
    "REDLINE_ALLOWED_RECIPIENTS",
    "REDLINE_MAX_REAL_CALLS",
)


@pytest.fixture(autouse=True)
def clean_environment() -> Iterator[None]:
    """Isolate every test from the developer's shell -- and from each other.

    Loading a .env deliberately mutates `os.environ`, which is the point of the
    feature and a hazard in a test suite: without restoring afterwards, a key
    loaded here leaks into unrelated tests and makes them pass for the wrong
    reason. This caught exactly that.
    """
    saved = {name: os.environ.get(name) for name in MANAGED}
    for name in MANAGED:
        os.environ.pop(name, None)
    try:
        yield
    finally:
        for name, value in saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


@pytest.fixture
def project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=False)
    (tmp_path / ".gitignore").write_text(
        ".env\nredline.scope.yaml\n", encoding="utf-8"
    )
    monkeypatch.chdir(tmp_path)
    return tmp_path


def write_env(directory: Path, body: str) -> Path:
    path = directory / ".env"
    path.write_text(body, encoding="utf-8")
    return path


def status_of(checks: object, name: str) -> CheckStatus | None:
    return next(
        (c.status for c in checks if c.name == name),  # type: ignore[union-attr]
        None,
    )


# --- The .env loader ----------------------------------------------------------


class TestParsing:
    def test_it_reads_key_value_pairs(self) -> None:
        assert parse_dotenv("A=1\nB=two\n") == {"A": "1", "B": "two"}

    def test_comments_and_blank_lines_are_skipped(self) -> None:
        assert parse_dotenv("# a comment\n\nA=1\n") == {"A": "1"}

    def test_export_prefixes_are_tolerated(self) -> None:
        assert parse_dotenv("export A=1\n") == {"A": "1"}

    def test_one_pair_of_quotes_is_stripped(self) -> None:
        assert parse_dotenv("A='1'\nB=\"2\"\n") == {"A": "1", "B": "2"}

    def test_an_empty_value_is_kept_as_empty(self) -> None:
        # The difference between "absent" and "present but blank" is the
        # difference between two very different error messages.
        assert parse_dotenv("A=\n") == {"A": ""}

    def test_a_value_containing_an_equals_survives(self) -> None:
        assert parse_dotenv("A=a=b=c\n") == {"A": "a=b=c"}

    def test_a_line_without_an_equals_is_skipped(self) -> None:
        assert parse_dotenv("nonsense\nA=1\n") == {"A": "1"}


class TestLoading:
    def test_a_path_that_does_not_exist_changes_nothing(self, tmp_path: Path) -> None:
        # Named explicitly rather than passing None. The first version of this
        # test relied on there being no .env in the repository, so it passed
        # until somebody followed the documented setup and created one -- which
        # is precisely the moment a test about .env loading must not break.
        environ: dict[str, str] = {}
        load_dotenv(tmp_path / "nothing-here", environ=environ)
        assert environ == {}

    def test_an_exported_variable_wins_over_the_file(self, tmp_path: Path) -> None:
        # A value already exported is a deliberate act -- a CI secret, a
        # one-off override. A file on disk must not silently replace it.
        path = write_env(tmp_path, "REDLINE_CALLE_API_KEY=from_file\n")
        environ = {"REDLINE_CALLE_API_KEY": "from_shell"}
        _, values = load_dotenv(path, environ=environ)
        assert environ["REDLINE_CALLE_API_KEY"] == "from_shell"
        assert values["REDLINE_CALLE_API_KEY"] == "from_file"

    def test_the_file_fills_an_unset_variable(self, tmp_path: Path) -> None:
        path = write_env(tmp_path, "REDLINE_CALLE_API_KEY=from_file\n")
        environ: dict[str, str] = {}
        load_dotenv(path, environ=environ)
        assert environ["REDLINE_CALLE_API_KEY"] == "from_file"

    def test_a_missing_file_is_not_an_error(self, tmp_path: Path) -> None:
        assert load_dotenv(tmp_path / "absent") == (None, {})


class TestFinding:
    def test_it_walks_up_to_the_repository_root(self, project: Path) -> None:
        # `redline run --config examples/x/redline.yaml` runs from the root,
        # where the credential lives, not from the example directory.
        write_env(project, "A=1\n")
        nested = project / "examples" / "agent"
        nested.mkdir(parents=True)
        assert find_dotenv(nested) == project / ".env"

    def test_it_stops_at_a_repository_boundary(self, tmp_path: Path) -> None:
        # Wandering into a parent project's credentials would be a surprise.
        outer = tmp_path / "outer"
        inner = outer / "inner"
        inner.mkdir(parents=True)
        (inner / ".git").mkdir()
        write_env(outer, "A=1\n")
        assert find_dotenv(inner) is None


# --- Masking ------------------------------------------------------------------


class TestMasking:
    def test_the_prefix_survives_and_the_secret_does_not(self) -> None:
        masked = mask_secret(FAKE_KEY)
        assert masked.startswith("iams_live_")
        assert "9f2b7d41" not in masked
        assert masked.endswith("17")

    def test_a_live_key_and_a_test_key_are_distinguishable(self) -> None:
        # They are different mistakes, so the mask has to keep them apart.
        assert "live" in mask_secret("iams_live" + "_abcdefgh")
        assert "test" in mask_secret("iams_test" + "_abcdefgh")

    def test_an_unset_key_says_so(self) -> None:
        assert mask_secret("") == "(not set)"

    def test_an_unrecognised_shape_is_still_masked(self) -> None:
        assert "abcdefghijkl" not in mask_secret("abcdefghijkl")


# --- Diagnostics --------------------------------------------------------------


class TestDiagnostics:
    def test_a_missing_key_fails(self, project: Path) -> None:
        diagnosis = run_diagnostics(start=project)
        assert status_of(diagnosis.checks, "api key") is CheckStatus.FAIL
        assert not diagnosis.is_ready_for_live

    def test_a_well_formed_key_passes(
        self, project: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        write_env(project, f"REDLINE_CALLE_API_KEY={FAKE_KEY}\n")
        diagnosis = run_diagnostics(start=project)
        assert status_of(diagnosis.checks, "api key") is CheckStatus.OK
        assert status_of(diagnosis.checks, "api key format") is CheckStatus.OK

    def test_a_present_but_empty_key_says_which_problem_it_is(
        self, project: Path
    ) -> None:
        write_env(project, "REDLINE_CALLE_API_KEY=\n")
        diagnosis = run_diagnostics(start=project)
        check = next(c for c in diagnosis.checks if c.name == "api key")
        assert check.status is CheckStatus.FAIL
        assert "empty" in check.detail

    def test_a_key_from_another_service_is_caught(self, project: Path) -> None:
        write_env(project, "REDLINE_CALLE_API_KEY=sk-" + "a" * 32 + "\n")
        diagnosis = run_diagnostics(start=project)
        check = next(c for c in diagnosis.checks if c.name == "api key format")
        assert check.status is CheckStatus.FAIL
        assert "different service" in check.detail

    def test_an_odd_shape_is_a_warning_not_a_failure(self, project: Path) -> None:
        # It might still work. Refusing to proceed on a shape guess would be
        # worse than saying so and offering --online.
        write_env(project, "REDLINE_CALLE_API_KEY=placeholder-of-odd-shape\n")
        diagnosis = run_diagnostics(start=project)
        assert status_of(diagnosis.checks, "api key format") is CheckStatus.WARN

    def test_a_shell_override_is_surfaced(
        self, project: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Right file, wrong value in use, is genuinely baffling otherwise.
        write_env(project, f"REDLINE_CALLE_API_KEY={FAKE_KEY}\n")
        other = "iams_live" + "_somethingelse"
        monkeypatch.setenv("REDLINE_CALLE_API_KEY", other)
        diagnosis = run_diagnostics(start=project)
        check = next(c for c in diagnosis.checks if c.name == "key source")
        assert check.status is CheckStatus.WARN
        assert "shell" in check.detail

    def test_git_is_asked_whether_the_file_is_ignored(self, project: Path) -> None:
        write_env(project, f"REDLINE_CALLE_API_KEY={FAKE_KEY}\n")
        diagnosis = run_diagnostics(start=project)
        assert status_of(diagnosis.checks, "env file ignored") is CheckStatus.OK

    def test_an_unignored_env_file_is_a_failure(self, project: Path) -> None:
        # The one finding that has to stop everything: a credential that would
        # reach the history needs a rewrite, not a follow-up commit.
        (project / ".gitignore").write_text("# nothing ignored\n", encoding="utf-8")
        write_env(project, f"REDLINE_CALLE_API_KEY={FAKE_KEY}\n")
        diagnosis = run_diagnostics(start=project)
        assert status_of(diagnosis.checks, "env file ignored") is CheckStatus.FAIL

    def test_a_missing_scope_file_is_a_warning_not_a_failure(
        self, project: Path
    ) -> None:
        # The offline path is the normal path. Most people running `doctor`
        # have no intention of dialling anything, and failing them for it
        # would teach them to ignore the output.
        diagnosis = run_diagnostics(start=project)
        assert status_of(diagnosis.checks, "call scope") is CheckStatus.WARN

    def test_a_malformed_scope_file_fails(self, project: Path) -> None:
        # Present-but-invalid is worse than absent: it looks like an
        # authorisation and is not one.
        (project / "redline.scope.yaml").write_text(
            "authorised_by: Someone\ncontact: a@example.com\n", encoding="utf-8"
        )
        diagnosis = run_diagnostics(start=project)
        assert status_of(diagnosis.checks, "call scope") is CheckStatus.FAIL

    def test_a_valid_scope_file_passes(self, project: Path) -> None:
        (project / "redline.scope.yaml").write_text(
            "authorised_by: Dana Okafor, Head of Support\n"
            "contact: dana@example.com\n"
            "expires: 2099-12-31\n"
            "targets:\n"
            f'  - number: "{FICTIONAL}"\n'
            "    owner: Test handset\n",
            encoding="utf-8",
        )
        diagnosis = run_diagnostics(start=project)
        check = next(c for c in diagnosis.checks if c.name == "call scope")
        assert check.status is CheckStatus.OK
        assert "Dana Okafor" in check.detail
        # Never the number itself, not even masked.
        assert FICTIONAL not in check.detail

    def test_the_safe_default_budget_is_reported_as_ok(self, project: Path) -> None:
        diagnosis = run_diagnostics(start=project)
        check = next(c for c in diagnosis.checks if c.name == "call budget")
        assert check.status is CheckStatus.OK
        assert "no real calls permitted" in check.detail

    def test_a_permissive_budget_is_flagged(
        self, project: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("REDLINE_MAX_REAL_CALLS", "10")
        diagnosis = run_diagnostics(start=project)
        check = next(c for c in diagnosis.checks if c.name == "call budget")
        assert check.status is CheckStatus.WARN
        assert "5 credits" in check.detail

    def test_nothing_touches_the_network_by_default(self, project: Path) -> None:
        write_env(project, f"REDLINE_CALLE_API_KEY={FAKE_KEY}\n")
        diagnosis = run_diagnostics(start=project)
        assert not diagnosis.online
        assert "authentication" not in {c.name for c in diagnosis.checks}


# --- The command ---------------------------------------------------------------


class TestDoctorCommand:
    def test_it_exits_non_zero_when_something_must_be_fixed(
        self, project: Path
    ) -> None:
        result = runner.invoke(app, ["doctor"])
        assert result.exit_code == 1
        assert "REDLINE_CALLE_API_KEY" in result.output

    def test_it_exits_zero_when_the_setup_is_sound(self, project: Path) -> None:
        write_env(project, f"REDLINE_CALLE_API_KEY={FAKE_KEY}\n")
        result = runner.invoke(app, ["doctor"])
        assert result.exit_code == 0, result.output

    def test_the_key_is_never_printed_in_full(self, project: Path) -> None:
        write_env(project, f"REDLINE_CALLE_API_KEY={FAKE_KEY}\n")
        result = runner.invoke(app, ["doctor"])
        assert FAKE_KEY not in result.output
        assert "iams_live_" in result.output

    def test_it_says_that_no_call_was_placed(self, project: Path) -> None:
        result = runner.invoke(app, ["doctor"])
        assert "No call was placed" in result.output

    def test_it_points_at_the_online_check(self, project: Path) -> None:
        result = runner.invoke(app, ["doctor"])
        assert "--online" in result.output

    def test_a_remedy_is_offered_for_every_problem(self, project: Path) -> None:
        result = runner.invoke(app, ["doctor"])
        assert "cp .env.example .env" in result.output


class TestDoctorCannotPlaceACall:
    def test_the_module_never_imports_the_live_transport_class(self) -> None:
        # It imports constants from that module -- the variable names and the
        # E.164 pattern, so they cannot drift apart -- but never the class that
        # can dial. Asserted rather than trusted to review.
        import redline.doctor as doctor_module

        source = Path(doctor_module.__file__).read_text(encoding="utf-8")
        assert "LiveTransport" not in source.replace(
            ":class:`~redline.transport.live.LiveTransport`", ""
        )

    def test_running_diagnostics_makes_no_call(
        self, project: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A blunt instrument on purpose: if anything in this path ever tries to
        # construct an SDK client offline, this fails loudly.
        import redline.transport.live as live_module

        def explode(*args: object, **kwargs: object) -> None:
            raise AssertionError("doctor must not construct a live transport")

        monkeypatch.setattr(live_module.LiveTransport, "__init__", explode)
        write_env(project, f"REDLINE_CALLE_API_KEY={FAKE_KEY}\n")
        run_diagnostics(start=project)


class TestDiagnosticsRespectTheirStartingPoint:
    """A regression guard for a bug the offline suite found.

    `run_diagnostics(start=X)` used to pass a None path through to the loader
    when no `.env` was found under X, and the loader reads None as "search from
    the current directory". So diagnostics for one project could silently load
    another project's credentials -- and report them as that project's own.
    """

    def test_a_project_without_an_env_file_finds_no_key(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Two sibling projects. One holds a credential and is the current
        # directory; the other is the one being asked about. Siblings rather
        # than parent and child, because walking up to a repository root is
        # deliberate behaviour that has to keep working.
        with_key = tmp_path / "project-a"
        without_key = tmp_path / "project-b"
        with_key.mkdir()
        without_key.mkdir()
        (with_key / ".git").mkdir()
        (without_key / ".git").mkdir()
        (with_key / ".env").write_text(
            f"REDLINE_CALLE_API_KEY={FAKE_KEY}\n", encoding="utf-8"
        )
        monkeypatch.chdir(with_key)

        diagnosis = run_diagnostics(start=without_key)
        assert diagnosis.dotenv_path is None
        assert status_of(diagnosis.checks, "api key") is CheckStatus.FAIL

    def test_the_environment_is_not_polluted_by_a_lookup(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.chdir(tmp_path)
        run_diagnostics(start=tmp_path)
        assert "REDLINE_CALLE_API_KEY" not in os.environ
