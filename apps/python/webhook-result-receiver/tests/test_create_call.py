from __future__ import annotations

import io
import json
import sys
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

APP_DIR = Path(__file__).parents[1]
sys.path.insert(0, str(APP_DIR))
import create_call

(
    CalleAuthenticationError,
    CalleRateLimitError,
    CalleAPIError,
    CalleConnectionError,
    CalleTimeoutError,
) = create_call._sdk_exception_types()


PUBLIC_WEBHOOK_URL = "https://hooks.user-supplied-domain.com/calle/webhook"


def public_resolver(hostname: str) -> list[str]:
    if hostname != "hooks.user-supplied-domain.com":
        raise AssertionError(f"unexpected resolver hostname: {hostname}")
    return ["8.8.8.8", "2606:4700:4700::1111"]


class ForbiddenEnvironment:
    def get(self, key: str, default: object = None) -> object:
        raise AssertionError(f"preview read environment variable {key}")


class CreateCallTests(unittest.TestCase):
    def test_preview_masks_phone_without_reading_credentials_or_constructing_client(
        self,
    ):
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
                client_factory=lambda api_key: self.fail(
                    "preview constructed a client"
                ),
                resolver=lambda hostname: self.fail(
                    f"preview resolved webhook hostname {hostname}"
                ),
            )

        self.assertEqual(exit_code, 0)
        self.assertIn("Preview", output.getvalue())
        self.assertNotIn("+12025550100", output.getvalue())

    def test_execute_requires_opt_ins_public_webhook_and_api_key(self):
        def no_client(*, api_key: str) -> object:
            self.fail("invalid live request constructed a client")

        valid = [
            "--phone",
            "+12025550100",
            "--webhook-url",
            PUBLIC_WEBHOOK_URL,
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
            (
                valid + ["--confirm-authorized-recipient"],
                {"CALLE_API_KEY": "   "},
                "CALLE_API_KEY",
            ),
        ):
            with self.subTest(message=message), redirect_stderr(io.StringIO()) as error:
                self.assertEqual(
                    create_call.main(
                        argv,
                        environ=environ,
                        client_factory=no_client,
                        resolver=public_resolver,
                    ),
                    2,
                )
                self.assertIn(message, error.getvalue())

    def test_preview_rejects_non_e164_phones_and_unsafe_workflow_ids(self):
        valid = [
            "--phone",
            "+12025550100",
            "--webhook-url",
            PUBLIC_WEBHOOK_URL,
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

    def test_e164_validation_uses_ascii_digits_and_enforces_length_bounds(self):
        def preview(phone: str) -> int:
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                return create_call.main(
                    [
                        "--phone",
                        phone,
                        "--webhook-url",
                        PUBLIC_WEBHOOK_URL,
                        "--workflow-id",
                        "workflow_123",
                    ],
                    resolver=lambda hostname: self.fail(
                        f"preview resolved webhook hostname {hostname}"
                    ),
                )

        for phone in ("+12345678", "+123456789012345"):
            with self.subTest(phone=phone):
                self.assertEqual(preview(phone), 0)

        for phone in (
            "+1234567",
            "+1234567890123456",
            "+1٢٠٢٥٥٥٠١٠٠",
        ):
            with self.subTest(phone=phone):
                self.assertEqual(preview(phone), 2)

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
            f" {PUBLIC_WEBHOOK_URL}",
            f"{PUBLIC_WEBHOOK_URL} ",
            "https://user:pass@receiver.example/calle/webhook",
            "https://@receiver.example/calle/webhook",
            "https://:@receiver.example/calle/webhook",
            "https://receiver.example/calle/webhook?debug=true",
            "https://receiver.example/calle/webhook?",
            "https://receiver.example/calle/webhook#section",
            "https://receiver.example/calle/webhook#",
            "https://receiver.example/calle/webhook",
            "https://example.com/calle/webhook",
            "https://service.invalid/calle/webhook",
            "https://service.test/calle/webhook",
            "https://service.onion/calle/webhook",
            "https://service.internal/calle/webhook",
            "https://service.alt/calle/webhook",
            "https://resolver.arpa/calle/webhook",
            "https://router.home.arpa/calle/webhook",
            "https://127.0.0.1/calle/webhook",
            "https://224.0.0.1/calle/webhook",
            "https://[ff02::1]/calle/webhook",
            "https://[fec0::1]/calle/webhook",
            "https://127.1/calle/webhook",
            "https://2130706433/calle/webhook",
            "https://0x7f.0.0.1/calle/webhook",
            "https://0x7f000001/calle/webhook",
            "https://0177.0.0.1/calle/webhook",
            "https://localhost/calle/webhook",
            "https://localhost./calle/webhook",
            "https://service.localhost/calle/webhook",
            "https://Service.LocalHost./calle/webhook",
            "https://printer.local/calle/webhook",
            "https://Printer.Local./calle/webhook",
            "https://receiver.example:not-a-port/calle/webhook",
            "https://[not-a-valid-ipv6/calle/webhook",
            "https://bad_label.user-domain.com/calle/webhook",
            "https://-bad.user-domain.com/calle/webhook",
            "https://bad-.user-domain.com/calle/webhook",
            "https://\u212aooks.user-supplied-domain.com/calle/webhook",
            "https://hooks.user-supplied-domain.com..../calle/webhook",
            "https://hooks.user-supplied-domain.com/calle\\webhook",
            "https://hooks.user-supplied-domain.com/calle/ web hook",
            "https://hooks.user-supplied-domain.com",
            "https://hooks.user-supplied-domain.com/",
            "https://hooks.user-supplied-domain.com/other",
            "https://hooks.user-supplied-domain.com/calle/webhook/",
            "https://hooks.user-supplied-domain.com/calle/webhook;private",
            f"https://{'a' * 64}.user-domain.com/calle/webhook",
        ):
            with (
                self.subTest(webhook_url=webhook_url),
                redirect_stderr(io.StringIO()) as error,
            ):
                argv = [*base]
                argv[3] = webhook_url
                resolved: list[str] = []
                self.assertEqual(
                    create_call.main(
                        argv,
                        environ={"CALLE_API_KEY": "test-key"},
                        client_factory=lambda *, api_key: self.fail(
                            "unsafe URL constructed a client"
                        ),
                        resolver=lambda hostname, _resolved=resolved: (
                            _resolved.append(hostname) or ["8.8.8.8"]
                        ),
                    ),
                    2,
                )
                self.assertIn("public HTTPS", error.getvalue())
                self.assertEqual(resolved, [])

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
                self.close_calls = 0

            def close(self):
                self.close_calls += 1

        fake = FakeClient()
        output = io.StringIO()
        with redirect_stdout(output):
            exit_code = create_call.main(
                [
                    "--phone",
                    "+12025550100",
                    "--webhook-url",
                    PUBLIC_WEBHOOK_URL,
                    "--workflow-id",
                    "workflow_123",
                    "--execute",
                    "--confirm-authorized-recipient",
                ],
                environ={"CALLE_API_KEY": "test-key"},
                client_factory=lambda *, api_key: fake,
                resolver=public_resolver,
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(fake.close_calls, 1)
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
                "webhook_url": PUBLIC_WEBHOOK_URL,
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
            close_calls = 0

            class calls:
                @staticmethod
                def create(**kwargs: object) -> dict[str, str]:
                    return {"status": "queued"}

            def close(self):
                self.close_calls += 1

        fake = FakeClient()
        output = io.StringIO()
        error = io.StringIO()
        with redirect_stdout(output), redirect_stderr(error):
            exit_code = create_call.main(
                [
                    "--phone",
                    "+12025550100",
                    "--webhook-url",
                    PUBLIC_WEBHOOK_URL,
                    "--workflow-id",
                    "workflow_123",
                    "--execute",
                    "--confirm-authorized-recipient",
                ],
                environ={"CALLE_API_KEY": "test-key"},
                client_factory=lambda *, api_key: fake,
                resolver=public_resolver,
            )

        self.assertEqual(exit_code, 1)
        self.assertEqual(fake.close_calls, 1)
        self.assertEqual(output.getvalue(), "")
        self.assertIn("call_creation_outcome_unknown", error.getvalue())
        self.assertIn("identical intent", error.getvalue())

    def test_execute_rejects_malformed_provider_responses_without_printing(self):
        argv = [
            "--phone",
            "+12025550100",
            "--webhook-url",
            PUBLIC_WEBHOOK_URL,
            "--workflow-id",
            "workflow_123",
            "--execute",
            "--confirm-authorized-recipient",
        ]

        responses = (
            None,
            [],
            {"id": ""},
            {"id": "   "},
            {"id": 123},
            {"id": "call_demo_123"},
            {"id": "call_demo_123", "status": None},
            {"id": "call_demo_123", "status": {"private": "raw"}},
            {"id": "call_demo_123\nprivate-id", "status": "queued"},
            {"id": "call_demo_123", "status": "queued\nprivate-status"},
            {"id": "call_demo_123", "status": "private_future_status"},
        )
        for response in responses:

            class FakeClient:
                def __init__(self):
                    self.close_calls = 0

                class calls:
                    @staticmethod
                    def create(
                        *, _response: object = response, **kwargs: object
                    ) -> object:
                        return _response

                def close(self):
                    self.close_calls += 1

            fake = FakeClient()
            output = io.StringIO()
            error = io.StringIO()
            with (
                self.subTest(response=response),
                redirect_stdout(output),
                redirect_stderr(error),
            ):
                exit_code = create_call.main(
                    argv,
                    environ={"CALLE_API_KEY": "test-key"},
                    client_factory=lambda *, api_key, _fake=fake: _fake,
                    resolver=public_resolver,
                )

                self.assertEqual(exit_code, 1)
                self.assertEqual(fake.close_calls, 1)
                self.assertEqual(output.getvalue(), "")
                self.assertIn("call_creation_outcome_unknown", error.getvalue())
                self.assertIn("identical intent", error.getvalue())
                self.assertNotIn("private", error.getvalue())

    def test_execute_rejects_nonpublic_or_failed_dns_results_before_client(self):
        argv = [
            "--phone",
            "+12025550100",
            "--webhook-url",
            PUBLIC_WEBHOOK_URL,
            "--workflow-id",
            "workflow_123",
            "--execute",
            "--confirm-authorized-recipient",
        ]
        cases = {
            "private": ["10.23.45.67"],
            "loopback": ["127.0.0.1", "::1"],
            "link-local": ["169.254.20.30", "fe80::1"],
            "ipv4-multicast": ["224.0.0.1"],
            "ipv6-multicast": ["ff02::1"],
            "ipv6-site-local": ["fec0::1"],
            "mixed": ["8.8.8.8", "10.23.45.67"],
            "empty": [],
            "malformed": ["not-an-address"],
        }

        def no_client(*, api_key: str) -> object:
            self.fail("non-public DNS result constructed a client")

        for label, addresses in cases.items():
            resolved: list[str] = []

            def resolver(
                hostname: str,
                *,
                _addresses=addresses,
                _resolved=resolved,
            ):
                _resolved.append(hostname)
                return _addresses

            with self.subTest(label=label), redirect_stderr(io.StringIO()) as error:
                self.assertEqual(
                    create_call.main(
                        argv,
                        environ={"CALLE_API_KEY": "test-key"},
                        client_factory=no_client,
                        resolver=resolver,
                    ),
                    2,
                )
                self.assertIn("public HTTPS", error.getvalue())
                self.assertEqual(resolved, ["hooks.user-supplied-domain.com"])

        with redirect_stderr(io.StringIO()) as error:
            self.assertEqual(
                create_call.main(
                    argv,
                    environ={"CALLE_API_KEY": "test-key"},
                    client_factory=no_client,
                    resolver=lambda hostname: (_ for _ in ()).throw(
                        OSError("private DNS failure detail")
                    ),
                ),
                2,
            )
            self.assertIn("public HTTPS", error.getvalue())
            self.assertNotIn("private DNS failure detail", error.getvalue())

    def test_live_sdk_failures_are_private_and_close_every_constructed_client(self):
        failures = [
            (
                CalleTimeoutError("private timeout response"),
                "call_creation_outcome_unknown",
                "identical intent",
            ),
            (
                CalleConnectionError("private connection response"),
                "call_creation_outcome_unknown",
                "identical intent",
            ),
            (
                json.JSONDecodeError(
                    "private create JSON detail",
                    "private create response body",
                    0,
                ),
                "call_creation_outcome_unknown",
                "identical intent",
            ),
            (
                CalleAuthenticationError(
                    code="private_auth",
                    message="private authentication response",
                    status_code=401,
                    details={"raw": "private raw response"},
                ),
                "call_creation_authentication_failed",
                None,
            ),
            (
                CalleRateLimitError(
                    code="private_rate",
                    message="private rate response",
                    status_code=429,
                    details={"raw": "private raw response"},
                ),
                "call_creation_rate_limited",
                None,
            ),
            (
                CalleAPIError(
                    code="private_api",
                    message="private API response",
                    status_code=500,
                    details={"raw": "private raw response"},
                ),
                "call_creation_api_error",
                None,
            ),
            (
                RuntimeError("private unexpected response"),
                "call_creation_failed",
                None,
            ),
        ]
        argv = [
            "--phone",
            "+12025550100",
            "--webhook-url",
            PUBLIC_WEBHOOK_URL,
            "--workflow-id",
            "workflow_123",
            "--execute",
            "--confirm-authorized-recipient",
        ]

        for failure, expected_code, guidance in failures:

            class FailingCalls:
                @staticmethod
                def create(*, _failure=failure, **kwargs: object) -> object:
                    raise _failure

            class FakeClient:
                def __init__(self):
                    self.calls = FailingCalls()
                    self.close_calls = 0

                def close(self):
                    self.close_calls += 1

            fake = FakeClient()
            output = io.StringIO()
            error = io.StringIO()
            with (
                self.subTest(failure=type(failure).__name__),
                redirect_stdout(output),
                redirect_stderr(error),
            ):
                self.assertEqual(
                    create_call.main(
                        argv,
                        environ={"CALLE_API_KEY": "test-key"},
                        client_factory=lambda *, api_key, _fake=fake: _fake,
                        resolver=public_resolver,
                    ),
                    1,
                )

            rendered = output.getvalue() + error.getvalue()
            self.assertEqual(fake.close_calls, 1)
            self.assertEqual(output.getvalue(), "")
            self.assertIn(expected_code, error.getvalue())
            if guidance is not None:
                self.assertIn(guidance, error.getvalue())
            for private_value in (
                str(failure),
                "private raw response",
                "private create response body",
                "+12025550100",
                "test-key",
                "Traceback",
            ):
                self.assertNotIn(private_value, rendered)

    def test_default_client_factory_sets_ten_second_api_timeout(self):
        captured: dict[str, object] = {}

        class FakeCalleClient:
            def __init__(self, **kwargs: object):
                captured.update(kwargs)

        fake_module = types.SimpleNamespace(CalleClient=FakeCalleClient)
        with patch.dict(sys.modules, {"calle": fake_module}):
            client = create_call.default_client_factory(api_key="private-test-key")

        self.assertIsInstance(client, FakeCalleClient)
        self.assertEqual(
            captured,
            {"api_key": "private-test-key", "timeout": 10.0},
        )

    def test_client_close_failure_is_contained_without_hiding_known_success(self):
        class FakeClient:
            class Calls:
                @staticmethod
                def create(**kwargs: object) -> dict[str, str]:
                    return {"id": "call_demo_close_001", "status": "queued"}

            def __init__(self):
                self.calls = self.Calls()
                self.close_calls = 0

            def close(self):
                self.close_calls += 1
                raise RuntimeError("private client close failure")

        fake = FakeClient()
        output = io.StringIO()
        errors = io.StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            exit_code = create_call.main(
                [
                    "--phone",
                    "+12025550100",
                    "--webhook-url",
                    PUBLIC_WEBHOOK_URL,
                    "--workflow-id",
                    "workflow_123",
                    "--execute",
                    "--confirm-authorized-recipient",
                ],
                environ={"CALLE_API_KEY": "test-key"},
                client_factory=lambda *, api_key: fake,
                resolver=public_resolver,
            )

        assert exit_code == 0
        assert fake.close_calls == 1
        assert output.getvalue() == "call_id=call_demo_close_001 status=queued\n"
        assert "private client close failure" not in errors.getvalue()
        assert "Traceback" not in errors.getvalue()

    def test_create_failure_stays_primary_when_client_close_also_fails(self):
        creation_error = CalleAuthenticationError(
            code="private_auth",
            message="private primary create failure",
            status_code=401,
        )

        class FakeClient:
            class Calls:
                @staticmethod
                def create(**kwargs: object) -> object:
                    raise creation_error

            def __init__(self):
                self.calls = self.Calls()
                self.close_calls = 0

            def close(self):
                self.close_calls += 1
                raise RuntimeError("private secondary close failure")

        fake = FakeClient()
        output = io.StringIO()
        errors = io.StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            exit_code = create_call.main(
                [
                    "--phone",
                    "+12025550100",
                    "--webhook-url",
                    PUBLIC_WEBHOOK_URL,
                    "--workflow-id",
                    "workflow_123",
                    "--execute",
                    "--confirm-authorized-recipient",
                ],
                environ={"CALLE_API_KEY": "test-key"},
                client_factory=lambda *, api_key: fake,
                resolver=public_resolver,
            )

        rendered = output.getvalue() + errors.getvalue()
        assert exit_code == 1
        assert fake.close_calls == 1
        assert output.getvalue() == ""
        assert "call_creation_authentication_failed" in errors.getvalue()
        assert "private primary create failure" not in rendered
        assert "private secondary close failure" not in rendered

    def test_sdk_initialization_failure_is_private_and_does_not_construct_client(self):
        output = io.StringIO()
        errors = io.StringIO()
        with (
            patch.object(
                create_call,
                "_sdk_exception_types",
                side_effect=RuntimeError("private SDK import failure"),
            ),
            redirect_stdout(output),
            redirect_stderr(errors),
        ):
            exit_code = create_call.main(
                [
                    "--phone",
                    "+12025550100",
                    "--webhook-url",
                    PUBLIC_WEBHOOK_URL,
                    "--workflow-id",
                    "workflow_123",
                    "--execute",
                    "--confirm-authorized-recipient",
                ],
                environ={"CALLE_API_KEY": "test-key"},
                client_factory=lambda *, api_key: self.fail(
                    "SDK initialization failure constructed a client"
                ),
                resolver=public_resolver,
            )

        rendered = output.getvalue() + errors.getvalue()
        assert exit_code == 1
        assert output.getvalue() == ""
        assert "call_creation_failed" in errors.getvalue()
        assert "private SDK import failure" not in rendered
        assert "Traceback" not in rendered


if __name__ == "__main__":
    unittest.main()
