from __future__ import annotations

import io
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path


APP_DIR = Path(__file__).parents[1]
sys.path.insert(0, str(APP_DIR))
import create_call  # noqa: E402


class ForbiddenEnvironment:
    def get(self, key: str, default: object = None) -> object:
        raise AssertionError(f"preview read environment variable {key}")


class CreateCallTests(unittest.TestCase):
    def test_preview_masks_phone_without_reading_credentials_or_constructing_client(self):
        output = io.StringIO()

        with redirect_stdout(output):
            exit_code = create_call.main(
                [
                    "--phone",
                    "+12025550100",
                    "--webhook-url",
                    "https://receiver.example/calle/webhook",
                    "--workflow-id",
                    "workflow_123",
                ],
                environ=ForbiddenEnvironment(),
                client_factory=lambda api_key: self.fail("preview constructed a client"),
            )

        self.assertEqual(exit_code, 0)
        self.assertIn("Preview", output.getvalue())
        self.assertNotIn("+12025550100", output.getvalue())

    def test_execute_requires_opt_ins_public_webhook_and_api_key(self):
        def no_client(_: str) -> object:
            self.fail("invalid live request constructed a client")

        valid = [
            "--phone",
            "+12025550100",
            "--webhook-url",
            "https://receiver.example/calle/webhook",
            "--workflow-id",
            "workflow_123",
            "--execute",
        ]
        unsafe_webhook = [
            "--phone",
            "+12025550100",
            "--webhook-url",
            "http://receiver.example/calle/webhook",
            "--workflow-id",
            "workflow_123",
            "--execute",
            "--confirm-authorized-recipient",
        ]
        for argv, environ, message in (
            (valid, {"CALLE_API_KEY": "test-key"}, "confirm"),
            (unsafe_webhook, {"CALLE_API_KEY": "test-key"}, "public HTTPS"),
            (valid + ["--confirm-authorized-recipient"], {}, "CALLE_API_KEY"),
        ):
            with self.subTest(message=message), redirect_stderr(io.StringIO()) as error:
                self.assertEqual(
                    create_call.main(argv, environ=environ, client_factory=no_client), 2
                )
                self.assertIn(message, error.getvalue())

    def test_preview_rejects_non_e164_phones_and_unsafe_workflow_ids(self):
        valid = [
            "--phone",
            "+12025550100",
            "--webhook-url",
            "https://receiver.example/calle/webhook",
            "--workflow-id",
            "workflow_123",
        ]
        cases = [
            (["--phone", "2025550100", *valid[2:]], "E.164"),
            ([*valid[:-1], "../../workflow"], "workflow-id"),
        ]
        for argv, message in cases:
            with (
                self.subTest(argv=argv),
                redirect_stdout(io.StringIO()),
                redirect_stderr(io.StringIO()) as error,
            ):
                self.assertEqual(create_call.main(argv), 2)
                self.assertIn(message, error.getvalue())

    def test_execute_rejects_private_or_decorated_webhook_urls(self):
        base = [
            "--phone",
            "+12025550100",
            "--webhook-url",
            "",
            "--workflow-id",
            "workflow_123",
            "--execute",
            "--confirm-authorized-recipient",
        ]
        for webhook_url in (
            "https://user:pass@receiver.example/calle/webhook",
            "https://receiver.example/calle/webhook?debug=true",
            "https://receiver.example/calle/webhook#section",
            "https://127.0.0.1/calle/webhook",
            "https://localhost/calle/webhook",
            "https://receiver.example:not-a-port/calle/webhook",
            "https://[not-a-valid-ipv6/calle/webhook",
        ):
            with self.subTest(webhook_url=webhook_url), redirect_stderr(io.StringIO()) as error:
                argv = [*base]
                argv[3] = webhook_url
                self.assertEqual(
                    create_call.main(
                        argv,
                        environ={"CALLE_API_KEY": "test-key"},
                        client_factory=lambda *, api_key: self.fail(
                            "unsafe URL constructed a client"
                        ),
                    ),
                    2,
                )
                self.assertIn("public HTTPS", error.getvalue())

    def test_execute_sends_the_exact_safe_call_request_and_prints_id_and_status(self):
        class FakeCalls:
            def __init__(self):
                self.created: dict[str, object] | None = None

            def create(self, **kwargs: object) -> dict[str, str]:
                self.created = kwargs
                return {"id": "call_demo_123", "status": "queued"}

        class FakeClient:
            def __init__(self):
                self.calls = FakeCalls()

        fake = FakeClient()
        output = io.StringIO()
        with redirect_stdout(output):
            exit_code = create_call.main(
                [
                    "--phone",
                    "+12025550100",
                    "--webhook-url",
                    "https://receiver.example/calle/webhook",
                    "--workflow-id",
                    "workflow_123",
                    "--execute",
                    "--confirm-authorized-recipient",
                ],
                environ={"CALLE_API_KEY": "test-key"},
                client_factory=lambda *, api_key: fake,
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(output.getvalue(), "call_id=call_demo_123 status=queued\n")
        self.assertEqual(
            fake.calls.created,
            {
                "task": "Call the recipient and ask whether they would like a human "
                "follow-up call. Record only yes, no, or unknown. Do not collect "
                "additional personal information or make commitments.",
                "result_schema": {
                    "type": "object",
                    "required": ["wants_human_callback"],
                    "properties": {
                        "wants_human_callback": {
                            "type": "string",
                            "enum": ["yes", "no", "unknown"],
                        }
                    },
                    "additionalProperties": False,
                },
                "metadata": {
                    "workflow": "webhook-result-receiver",
                    "workflow_id": "workflow_123",
                },
                "webhook_url": "https://receiver.example/calle/webhook",
                "recipient": {"phone": "+12025550100"},
                "idempotency_key": "webhook-result-receiver:"
                "cfe75f1332372c8f747bd3de3ced1fef",
            },
        )

    def test_idempotency_key_is_phone_free_stable_and_bound_to_material_intent(self):
        phone = "+12025550100"
        original = create_call.idempotency_key("workflow_123", phone)

        self.assertEqual(
            original,
            "webhook-result-receiver:cfe75f1332372c8f747bd3de3ced1fef",
        )
        self.assertNotIn(phone, original)
        self.assertEqual(original, create_call.idempotency_key("workflow_123", phone))
        self.assertNotEqual(
            original, create_call.idempotency_key("workflow_456", phone)
        )
        self.assertNotEqual(
            original, create_call.idempotency_key("workflow_123", "+12025550101")
        )
        self.assertNotEqual(
            original,
            create_call.idempotency_key(
                "workflow_123", phone, task="Ask a different question."
            ),
        )
        self.assertNotEqual(
            original,
            create_call.idempotency_key(
                "workflow_123",
                phone,
                result_schema={
                    "type": "object",
                    "required": ["wants_human_callback"],
                    "properties": {
                        "wants_human_callback": {"type": "string", "enum": ["yes"]}
                    },
                    "additionalProperties": False,
                },
            ),
        )
        self.assertEqual(
            create_call.build_call_request(
                phone, "https://one.example/calle/webhook", "workflow_123"
            )["idempotency_key"],
            create_call.build_call_request(
                phone, "https://two.example/calle/webhook", "workflow_123"
            )["idempotency_key"],
        )

    def test_execute_does_not_print_when_the_provider_response_lacks_a_call_id(self):
        class FakeClient:
            class calls:
                @staticmethod
                def create(**kwargs: object) -> dict[str, str]:
                    return {"status": "queued"}

        output = io.StringIO()
        error = io.StringIO()
        with redirect_stdout(output), redirect_stderr(error):
            exit_code = create_call.main(
                [
                    "--phone",
                    "+12025550100",
                    "--webhook-url",
                    "https://receiver.example/calle/webhook",
                    "--workflow-id",
                    "workflow_123",
                    "--execute",
                    "--confirm-authorized-recipient",
                ],
                environ={"CALLE_API_KEY": "test-key"},
                client_factory=lambda *, api_key: FakeClient(),
            )

        self.assertEqual(exit_code, 2)
        self.assertEqual(output.getvalue(), "")
        self.assertIn("call ID", error.getvalue())


if __name__ == "__main__":
    unittest.main()
