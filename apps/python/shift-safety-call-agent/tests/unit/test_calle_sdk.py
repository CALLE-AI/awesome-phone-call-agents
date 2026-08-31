"""Unit tests for lazy, non-connecting CALL-E SDK inspection."""

import os
import socket
import tomllib
import unittest
from importlib.metadata import PackageNotFoundError
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from shift_safety_call_agent.adapters.calle_sdk import (
    CALLE_DISTRIBUTION,
    SUPPORTED_CALLE_SDK_VERSION,
    CalleSdkInfo,
    UnsupportedCalleSdkVersionError,
    inspect_calle_sdk,
)
from shift_safety_call_agent.cli import main


class CalleSdkInspectionTests(unittest.TestCase):
    """Verify optional SDK inspection never requires credentials or a client."""

    def test_optional_dependency_is_pinned_to_audited_version(self) -> None:
        project = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))
        self.assertEqual(project["project"]["optional-dependencies"]["calle"], ["calle-ai==0.6.0"])

    def test_sdk_absence_is_safe_and_does_not_attempt_import(self) -> None:
        def missing_distribution(name: str) -> str:
            self.assertEqual(name, CALLE_DISTRIBUTION)
            raise PackageNotFoundError(name)

        def forbidden_import(name: str) -> object:
            raise AssertionError(f"unexpected import: {name}")

        info = inspect_calle_sdk(version_reader=missing_distribution, module_loader=forbidden_import)
        self.assertIs(info.installed, False)
        self.assertIsNone(info.version)
        self.assertIs(info.client_class_available, False)

    def test_version_mismatch_is_rejected_before_import(self) -> None:
        with self.assertRaisesRegex(UnsupportedCalleSdkVersionError, "not approved"):
            inspect_calle_sdk(
                version_reader=lambda name: "9.9.9",
                module_loader=lambda name: self.fail("mismatched SDK must not be imported"),
            )

    def test_matching_sdk_detection_does_not_construct_client(self) -> None:
        class ClientMustNotBeConstructed:
            def __new__(cls) -> object:
                raise AssertionError("client constructed")

        class FakeModule:
            CalleClient = ClientMustNotBeConstructed

        info = inspect_calle_sdk(
            version_reader=lambda name: SUPPORTED_CALLE_SDK_VERSION,
            module_loader=lambda name: FakeModule,
        )
        self.assertIs(info.installed, True)
        self.assertIs(info.client_class_available, True)

    def test_sdk_info_cli_reads_no_credentials_or_phone_and_uses_no_network(self) -> None:
        info = CalleSdkInfo(
            installed=True,
            distribution="calle-ai",
            version="0.6.0",
            import_name="calle",
            client_class_available=True,
        )
        output = StringIO()
        with (
            patch.object(os, "getenv", side_effect=AssertionError("environment read")),
            patch.object(socket.socket, "connect", side_effect=AssertionError("network attempted")),
        ):
            code = main(["calle-sdk-info"], output=output, sdk_inspector=lambda: info)
        rendered = output.getvalue()
        self.assertEqual(code, 0)
        self.assertIn("Installed: true", rendered)
        self.assertIn("Client instantiated: false", rendered)
        self.assertIn("API key loaded: false", rendered)
        self.assertIn("Phone number loaded: false", rendered)
        self.assertIn("Network attempted: false", rendered)


if __name__ == "__main__":
    unittest.main()
