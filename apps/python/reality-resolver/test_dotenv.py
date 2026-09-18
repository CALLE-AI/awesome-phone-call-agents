"""Tests for client.load_dotenv - the stdlib-only .env loader.

Every test here passes an explicit env_path (tmp_path-based) to
load_dotenv, never the default (a .env file in this app's own
directory). A developer running this test suite may have a real .env
with a real CALLE_API_KEY sitting there once they follow the README's
setup instructions; a test that reads or writes that real file would
risk clobbering real local credentials, so this suite never touches it.
"""

from __future__ import annotations

import os

from client import load_dotenv


def test_load_dotenv_sets_unset_env_var(tmp_path) -> None:
    os.environ.pop("CGC_TEST_DOTENV_VAR", None)
    env_file = tmp_path / ".env"
    env_file.write_text("CGC_TEST_DOTENV_VAR=from_dotenv\n", encoding="utf-8")
    try:
        load_dotenv(env_file)
        assert os.environ["CGC_TEST_DOTENV_VAR"] == "from_dotenv"
    finally:
        os.environ.pop("CGC_TEST_DOTENV_VAR", None)


def test_load_dotenv_never_overwrites_existing_env_var(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("CGC_TEST_DOTENV_VAR", "real_env_value")
    env_file = tmp_path / ".env"
    env_file.write_text("CGC_TEST_DOTENV_VAR=from_dotenv\n", encoding="utf-8")

    load_dotenv(env_file)

    assert os.environ["CGC_TEST_DOTENV_VAR"] == "real_env_value"


def test_load_dotenv_missing_file_is_a_no_op(tmp_path) -> None:
    load_dotenv(tmp_path / "does_not_exist.env")  # must not raise


def test_load_dotenv_skips_blank_lines_and_comments(tmp_path) -> None:
    os.environ.pop("CGC_TEST_DOTENV_VAR", None)
    env_file = tmp_path / ".env"
    env_file.write_text("# a comment\n\nCGC_TEST_DOTENV_VAR=value\n", encoding="utf-8")
    try:
        load_dotenv(env_file)
        assert os.environ["CGC_TEST_DOTENV_VAR"] == "value"
    finally:
        os.environ.pop("CGC_TEST_DOTENV_VAR", None)


def test_load_dotenv_ignores_lines_without_equals_sign(tmp_path) -> None:
    os.environ.pop("CGC_TEST_DOTENV_VAR", None)
    env_file = tmp_path / ".env"
    env_file.write_text("NOT_A_VALID_LINE\nCGC_TEST_DOTENV_VAR=value\n", encoding="utf-8")
    try:
        load_dotenv(env_file)
        assert os.environ["CGC_TEST_DOTENV_VAR"] == "value"
        assert "NOT_A_VALID_LINE" not in os.environ
    finally:
        os.environ.pop("CGC_TEST_DOTENV_VAR", None)
