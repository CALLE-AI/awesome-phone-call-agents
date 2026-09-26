"""Exercise the real auth guard without loading databases, dotenv, or CALL-E."""

import ast
import os
from pathlib import Path
import secrets
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class AuthError(Exception):
    def __init__(self, status_code, **kwargs):
        self.status_code = status_code


def load_guard(environment):
    source = Path(__file__).resolve().parents[1] / "main.py"
    selected = []
    for node in ast.parse(source.read_text()).body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name)
            and target.id in {"OPERATOR_USERNAME", "OPERATOR_PASSWORD"}
            for target in node.targets
        ):
            selected.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name == "require_operator":
            selected.append(node)
    namespace = {
        "os": os,
        "secrets": secrets,
        "HTTPException": AuthError,
        "HTTPBasicCredentials": SimpleNamespace,
        "Depends": lambda _: None,
        "security": None,
    }
    with patch.dict(os.environ, environment, clear=True):
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), "exec"), namespace)
    return namespace["require_operator"]


class OperatorAuthTests(unittest.TestCase):
    def test_missing_blank_and_public_demo_passwords_fail_closed(self):
        for password in (None, "", "   ", "demo-password"):
            for demo_mode in ("true", "false"):
                with self.subTest(password=password, demo_mode=demo_mode):
                    env = {"CLINICCALL_DEMO_MODE": demo_mode}
                    if password is not None:
                        env["CLINICCALL_OPERATOR_PASSWORD"] = password
                    guard = load_guard(env)
                    with self.assertRaises(AuthError) as error:
                        guard(SimpleNamespace(username="demo", password=password or ""))
                    self.assertEqual(error.exception.status_code, 503)

    def test_explicit_private_password_is_required(self):
        guard = load_guard({"CLINICCALL_OPERATOR_PASSWORD": "synthetic-test-password"})
        for username, password in (("demo", "demo-password"), ("wrong", "synthetic-test-password")):
            with self.subTest(username=username):
                with self.assertRaises(AuthError) as error:
                    guard(SimpleNamespace(username=username, password=password))
                self.assertEqual(error.exception.status_code, 401)
        self.assertEqual(
            guard(SimpleNamespace(username="demo", password="synthetic-test-password")),
            "demo",
        )

    def test_frontend_has_no_build_time_operator_secret_or_storage(self):
        frontend = Path(__file__).resolve().parents[2] / "src" / "App.jsx"
        source = frontend.read_text(encoding="utf-8-sig")
        for forbidden in ("VITE_OPERATOR_PASSWORD", "demo-password", "localStorage", "sessionStorage"):
            self.assertNotIn(forbidden, source)
        self.assertIn('type="password"', source)
        self.assertIn("if (operatorAuthorization) loadAll();", source)


if __name__ == "__main__":
    unittest.main()
