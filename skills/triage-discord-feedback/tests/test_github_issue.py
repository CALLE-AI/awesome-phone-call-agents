from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "github_issue.py"
MODULE_SPEC = importlib.util.spec_from_file_location("github_issue", SCRIPT_PATH)
assert MODULE_SPEC is not None
assert MODULE_SPEC.loader is not None
github_issue = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(github_issue)


def issue_spec(
    body: str,
    source_evidence_identifiers: list[str] | None = None,
    investigation_clues: list[str] | None = None,
    investigation_clues_sufficient: bool = True,
    insufficient_clues_confirmed_by_user: bool = False,
) -> dict[str, object]:
    value: dict[str, object] = {
        "title": "Callee replies are not reflected after an outbound call connects",
        "body": body,
        "labels": ["bug"],
        "confirmed_issue_ids": ["I1"],
        "expected_actor": "octocat",
        "expected_repository": "CALLE-AI/awesome-phone-call-agents",
        "investigation_clues": investigation_clues if investigation_clues is not None else [body],
        "investigation_clues_sufficient": investigation_clues_sufficient,
        "insufficient_clues_confirmed_by_user": insufficient_clues_confirmed_by_user,
        "approved_duplicate_issue_numbers": [],
        "approved_fingerprint": None,
        "semantic_duplicate_review_complete": True,
    }
    if source_evidence_identifiers is not None:
        value["source_evidence_identifiers"] = source_evidence_identifiers
    return value


class ValidateSpecTests(unittest.TestCase):
    def test_accepts_user_observable_behavior(self) -> None:
        result = github_issue.validate_spec(
            issue_spec(
                "The outbound call connected, but the callee's replies were not reflected "
                "in the conversation."
            )
        )

        self.assertEqual(result["confirmed_issue_ids"], ["I1"])

    def test_rejects_internal_diagnostics(self) -> None:
        bodies = [
            "VAD detected 53 speech-positive frames, but ASR produced no words.",
            "Internal call_id abcdef12abcdef34abcdef56abcdef78 had no transcript.",
            "Provider routing failed in an internal backend service.",
        ]

        for body in bodies:
            with self.subTest(body=body):
                with self.assertRaisesRegex(github_issue.UserError, "internal server diagnostics"):
                    github_issue.validate_spec(issue_spec(body))

    def test_accepts_identifier_from_source_feedback(self) -> None:
        call_id = "reporter-call-1234"

        result = github_issue.validate_spec(
            issue_spec(
                f"Reporter-supplied call ID: `{call_id}`",
                source_evidence_identifiers=[call_id],
            )
        )

        self.assertEqual(result["source_evidence_identifiers"], [call_id])

    def test_rejects_source_identifier_missing_from_body(self) -> None:
        with self.assertRaisesRegex(github_issue.UserError, "not present"):
            github_issue.validate_spec(
                issue_spec(
                    "The call connected, but the replies were not reflected.",
                    source_evidence_identifiers=["reporter-call-1234"],
                )
            )

    def test_rejects_unlisted_source_identifier(self) -> None:
        with self.assertRaisesRegex(github_issue.UserError, "internal server diagnostics"):
            github_issue.validate_spec(
                issue_spec(
                    "Reporter-supplied call ID: `reporter-call-1234`",
                    source_evidence_identifiers=[],
                )
            )

    def test_rejects_identifier_that_only_matches_a_prefix(self) -> None:
        with self.assertRaisesRegex(github_issue.UserError, "not present"):
            github_issue.validate_spec(
                issue_spec(
                    "Reporter-supplied call ID: `reporter-call-1234-extra`",
                    source_evidence_identifiers=["reporter-call-1234"],
                )
            )

    def test_rejects_account_identifier_even_when_listed(self) -> None:
        account_id = "reporter-account-1234"

        with self.assertRaisesRegex(github_issue.UserError, "internal server diagnostics"):
            github_issue.validate_spec(
                issue_spec(
                    f"Reporter-supplied account ID: `{account_id}`",
                    source_evidence_identifiers=[account_id],
                )
            )

    def test_requires_exactly_one_confirmed_issue_id(self) -> None:
        value = issue_spec("The outbound call failed before ringing.")
        value["confirmed_issue_ids"] = ["I1", "I2"]

        with self.assertRaisesRegex(github_issue.UserError, "exactly one ID"):
            github_issue.validate_spec(value)

    def test_rejects_sensitive_network_and_discord_values(self) -> None:
        stripe_key = "sk_" + "live_" + "abcdefghijklmnopqrstuvwxyz"
        github_token = "github_" + "pat_" + "abcdefghijklmnopqrstuvwxyz0123456789"
        calle_key = "calle_" + "abcdefghijklmnopqrstuvwxyz"
        bodies = [
            "Private host was 192.0.2.44.",
            "Private host was 2001:db8::1.",
            "Join https://discord.gg/private-example for logs.",
            "Cookie: secret-session-value",
            "Discord user ID: 123456789012345678",
            "Reporter handle: @private_user",
            "Legacy handle: private_user#1234",
            "Reporter profile: @private_user/profile",
            "Recording: https://files.example.test/private/recording.mp3",
            "Private recording URL: https://files.example.test/calls/session.mp3",
            f"API key: {stripe_key}",
            "Token: abcdefghijklmnopqrstuvwxyz",
            "Password=hunterhunter",
            f"CALL_E_API_KEY={calle_key}",
            "Token: `abcdefghijklmnopqrstuvwxyz`",
            f"CALL_E_API_KEY=`{calle_key}`",
            "Password: **hunterhunter**",
            f"`@call-e/core@{stripe_key}`",
            f"`@call-e/core@{github_token}`",
            "Phone: 415\u2011555\u20110123",
        ]

        for body in bodies:
            with self.subTest(body=body):
                with self.assertRaisesRegex(github_issue.UserError, "sensitive data"):
                    github_issue.validate_spec(issue_spec(body))

    def test_accepts_a_public_scoped_package_name(self) -> None:
        result = github_issue.validate_spec(
            issue_spec(
                "The public package `@call-e/core@0.3.6` returned a visible CLI error."
            )
        )

        self.assertEqual(result["confirmed_issue_ids"], ["I1"])

    def test_source_identifier_cannot_be_an_internal_diagnostic_word(self) -> None:
        with self.assertRaisesRegex(github_issue.UserError, "internal server diagnostics"):
            github_issue.validate_spec(
                issue_spec(
                    "Internal telemetry showed the call failed.",
                    source_evidence_identifiers=["telemetry"],
                )
            )

    def test_accepts_an_opaque_reporter_identifier_without_digits(self) -> None:
        run_id = "run-deadbeef"

        result = github_issue.validate_spec(
            issue_spec(
                f"Reporter-supplied run ID: `{run_id}`",
                source_evidence_identifiers=[run_id],
            )
        )

        self.assertEqual(result["source_evidence_identifiers"], [run_id])

    def test_rejects_sufficient_issue_without_investigation_clues(self) -> None:
        with self.assertRaisesRegex(github_issue.UserError, "must declare at least one clue"):
            github_issue.validate_spec(
                issue_spec("The outbound call failed before ringing.", investigation_clues=[])
            )

    def test_rejects_insufficient_clues_without_user_confirmation(self) -> None:
        with self.assertRaisesRegex(github_issue.UserError, "explicit confirmation"):
            github_issue.validate_spec(
                issue_spec(
                    "The outbound call failed before ringing.",
                    investigation_clues=["failed before ringing"],
                    investigation_clues_sufficient=False,
                )
            )

    def test_accepts_insufficient_clues_with_user_confirmation(self) -> None:
        result = github_issue.validate_spec(
            issue_spec(
                "The outbound call failed before ringing.",
                investigation_clues=["failed before ringing"],
                investigation_clues_sufficient=False,
                insufficient_clues_confirmed_by_user=True,
            )
        )

        self.assertFalse(result["investigation_clues_sufficient"])
        self.assertTrue(result["insufficient_clues_confirmed_by_user"])

    def test_rejects_investigation_clue_missing_from_body(self) -> None:
        with self.assertRaisesRegex(github_issue.UserError, "investigation_clues are not present"):
            github_issue.validate_spec(
                issue_spec(
                    "The outbound call failed before ringing.",
                    investigation_clues=["MCP run exact-id-123"],
                )
            )

    def test_rejects_waiver_when_clues_are_sufficient(self) -> None:
        with self.assertRaisesRegex(github_issue.UserError, "must be false"):
            github_issue.validate_spec(
                issue_spec(
                    "The outbound call failed before ringing.",
                    insufficient_clues_confirmed_by_user=True,
                )
            )


class DuplicateMatchTests(unittest.TestCase):
    def test_searches_issue_comments(self) -> None:
        spec = issue_spec(
            "The run remained in `PREPARING` after the activity entry `run_call started`.",
            investigation_clues=["PREPARING", "run_call started"],
        )
        issues = [
            {
                "number": 142,
                "state": "open",
                "title": "API-triggered outbound calls time out and are not delivered",
                "body": "The API call timed out before delivery.",
                "html_url": "https://github.com/CALLE-AI/awesome-phone-call-agents/issues/142",
            }
        ]
        comments_by_issue = {
            142: [
                {
                    "body": "Three outbound runs remained in `PREPARING`. "
                    "The activity stream contained only `run_call started.`"
                }
            ]
        }

        matches = github_issue.duplicate_matches(
            spec,
            "unrelated-fingerprint",
            issues,
            comments_by_issue,
        )

        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["number"], 142)
        self.assertEqual(matches[0]["reason"], "shared technical evidence in comments")
        self.assertTrue(matches[0]["matched_in_comments"])
        self.assertEqual(matches[0]["shared_evidence"], ["preparing", "run_call started"])

    def test_searches_plain_prose_for_declared_investigation_clues(self) -> None:
        spec = issue_spec(
            "The CLI returned `unsupported_locale` for a documented locale.",
            investigation_clues=["unsupported_locale"],
        )
        issues = [
            {
                "number": 177,
                "state": "closed",
                "title": "CLI validation fails for a supported input",
                "body": "The visible error was unsupported_locale even though the input is documented.",
                "html_url": "https://github.com/CALLE-AI/awesome-phone-call-agents/issues/177",
            }
        ]

        matches = github_issue.duplicate_matches(
            spec,
            "unrelated-fingerprint",
            issues,
        )

        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["number"], 177)
        self.assertEqual(matches[0]["shared_evidence"], ["unsupported_locale"])

    def test_issue_scan_reports_an_exhausted_page_limit(self) -> None:
        args = type(
            "Args",
            (),
            {
                "api_base": "https://api.github.test",
                "repo": "example/repository",
                "max_pages": 1,
            },
        )()
        full_page = [
            {"number": number, "title": f"Issue {number}"}
            for number in range(1, 101)
        ]

        with mock.patch.object(github_issue, "api_request", return_value=full_page):
            issues, scan_complete = github_issue.list_issues(args)

        self.assertEqual(len(issues), 100)
        self.assertFalse(scan_complete)

    def test_label_scan_paginates(self) -> None:
        args = type(
            "Args",
            (),
            {
                "api_base": "https://api.github.test",
                "repo": "example/repository",
                "max_pages": 2,
            },
        )()
        full_page = [{"name": f"label-{number}"} for number in range(100)]

        with mock.patch.object(
            github_issue,
            "api_request",
            side_effect=[full_page, [{"name": "bug"}]],
        ):
            labels, scan_complete = github_issue.list_labels(args)

        self.assertEqual(len(labels), 101)
        self.assertTrue(scan_complete)
        self.assertEqual(labels[-1]["name"], "bug")

    def test_duplicate_override_must_match_reviewed_issue_numbers(self) -> None:
        matches = [{"number": 41}, {"number": 72}]

        github_issue.require_duplicate_approval(matches, [41, 72], True)

        with self.assertRaisesRegex(github_issue.UserError, "do not equal"):
            github_issue.require_duplicate_approval(matches, [41], True)

    def test_duplicate_override_is_rejected_when_matches_disappear(self) -> None:
        with self.assertRaisesRegex(github_issue.UserError, "stale"):
            github_issue.require_duplicate_approval([], [41], True)


class CommandLineTests(unittest.TestCase):
    def test_prepare_accepts_documented_reporter_identifier(self) -> None:
        value = issue_spec(
            "Reporter-supplied call ID: `reporter-call-1234`",
            source_evidence_identifiers=["reporter-call-1234"],
            investigation_clues=["reporter-call-1234"],
        )

        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "prepare", "--input", "-"],
            input=json.dumps(value),
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        prepared = json.loads(result.stdout)
        self.assertEqual(
            prepared["expected_repository"],
            "CALLE-AI/awesome-phone-call-agents",
        )
        self.assertRegex(prepared["approval_fingerprint"], r"^[0-9a-f]{64}$")

    def test_prepare_rejects_repository_mismatch(self) -> None:
        value = issue_spec("The outbound call failed before ringing.")

        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_PATH),
                "--repo",
                "example/other-repository",
                "prepare",
                "--input",
                "-",
            ],
            input=json.dumps(value),
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("does not match expected_repository", result.stderr)

    def test_create_rejects_an_unapproved_fingerprint_before_network_access(self) -> None:
        value = issue_spec("The outbound call failed before ringing.")

        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "create", "--input", "-", "--yes"],
            input=json.dumps(value),
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("approved_fingerprint", result.stderr)

    def test_create_rejects_an_incomplete_semantic_duplicate_review(self) -> None:
        value = issue_spec("The outbound call failed before ringing.")
        value["semantic_duplicate_review_complete"] = False
        normalized = github_issue.validate_spec(value)
        value["approved_fingerprint"] = github_issue.approval_fingerprint(normalized)

        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "create", "--input", "-", "--yes"],
            input=json.dumps(value),
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("semantic duplicate review", result.stderr)

    def test_removed_api_base_option_is_rejected(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_PATH),
                "--api-base",
                "https://attacker.example",
                "whoami",
            ],
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("attacker.example", result.stderr)

    def test_api_request_rejects_an_untrusted_origin(self) -> None:
        with self.assertRaisesRegex(github_issue.UserError, "outside https://api.github.com"):
            github_issue.api_request("GET", "https://attacker.example/user")

    def test_approval_fingerprint_changes_with_publishable_content(self) -> None:
        original = github_issue.validate_spec(
            issue_spec("The outbound call failed before ringing.")
        )
        changed = dict(original)
        changed["body"] = "The outbound call failed after ringing."

        self.assertNotEqual(
            github_issue.approval_fingerprint(original),
            github_issue.approval_fingerprint(changed),
        )

    def test_create_uses_the_approved_payload_after_all_read_checks(self) -> None:
        value = issue_spec("The outbound call failed before ringing.")
        normalized = github_issue.validate_spec(value)
        value["approved_fingerprint"] = github_issue.approval_fingerprint(normalized)
        comment_scan = {
            "comment_scan_complete": True,
            "scanned_comment_issues": 0,
            "scanned_comments": 0,
        }
        created_issue = {
            "number": 321,
            "title": value["title"],
            "html_url": "https://github.com/example/repository/issues/321",
        }

        with mock.patch.object(
            sys,
            "argv",
            [str(SCRIPT_PATH), "create", "--input", "-", "--yes"],
        ), mock.patch.object(
            sys,
            "stdin",
            io.StringIO(json.dumps(value)),
        ), mock.patch.object(
            sys,
            "stdout",
            new_callable=io.StringIO,
        ) as stdout, mock.patch.object(
            github_issue,
            "list_issues",
            return_value=([], True),
        ), mock.patch.object(
            github_issue,
            "list_issue_comments",
            return_value=({}, comment_scan),
        ), mock.patch.object(
            github_issue,
            "list_labels",
            return_value=([{"name": "bug"}], True),
        ), mock.patch.object(
            github_issue,
            "authenticated_actor",
            return_value={
                "html_url": "https://github.com/octocat",
                "login": "octocat",
                "type": "User",
            },
        ), mock.patch.object(
            github_issue,
            "api_request",
            return_value=created_issue,
        ):
            return_code = github_issue.main()

        self.assertEqual(return_code, 0)
        result = json.loads(stdout.getvalue())
        self.assertTrue(result["created"])
        self.assertEqual(result["number"], 321)


if __name__ == "__main__":
    unittest.main()
