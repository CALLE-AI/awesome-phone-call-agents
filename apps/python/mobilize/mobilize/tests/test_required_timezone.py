"""Proves real-call entry points require an explicit, valid recipient
timezone rather than silently defaulting to UTC -- a reviewer found that
both live entry points constructed every Candidate without one, meaning
calling-hour governance was checked against the wrong clock for every real
recipient."""

from __future__ import annotations

import pytest

from mobilize.transports.base import validate_timezone


def test_validate_timezone_accepts_real_iana_name():
    validate_timezone("Asia/Kolkata")  # must not raise
    validate_timezone("America/New_York")
    validate_timezone("UTC")


def test_validate_timezone_rejects_garbage():
    with pytest.raises(ValueError):
        validate_timezone("Not/A/RealZone")


def test_validate_timezone_rejects_empty_string():
    with pytest.raises(ValueError):
        validate_timezone("")


@pytest.mark.asyncio
async def test_cli_run_real_exits_on_timezone_count_mismatch(capsys, monkeypatch):
    from mobilize.app.cli import run_real

    monkeypatch.setenv("CALLE_API_KEY", "test_key")
    with pytest.raises(SystemExit):
        await run_real(
            phones=["+15550101234", "+15550105678"],
            timezones=["Asia/Kolkata"],  # only one, for two phones
            need_count=1,
            need_label="test",
        )
    captured = capsys.readouterr()
    assert "timezones" in captured.err.lower()


@pytest.mark.asyncio
async def test_cli_run_real_exits_on_invalid_timezone(capsys, monkeypatch):
    from mobilize.app.cli import run_real

    monkeypatch.setenv("CALLE_API_KEY", "test_key")
    with pytest.raises(SystemExit):
        await run_real(
            phones=["+15550101234"],
            timezones=["Not/A/RealZone"],
            need_count=1,
            need_label="test",
        )
    captured = capsys.readouterr()
    assert "timezone" in captured.err.lower()


@pytest.mark.asyncio
async def test_mcp_mobilize_real_errors_on_timezone_count_mismatch():
    from mobilize.mcp.server import mobilize_real

    result = await mobilize_real(
        need_label="test", phones=["+15550101234", "+15550105678"], timezones=["Asia/Kolkata"],
    )
    assert "error" in result


@pytest.mark.asyncio
async def test_mcp_mobilize_real_errors_on_invalid_timezone():
    from mobilize.mcp.server import mobilize_real

    result = await mobilize_real(
        need_label="test", phones=["+15550101234"], timezones=["Not/A/RealZone"],
    )
    assert "error" in result


@pytest.mark.asyncio
async def test_mcp_mobilize_real_preview_includes_timezones():
    from mobilize.mcp.server import mobilize_real

    result = await mobilize_real(
        need_label="test", phones=["+15550101234"], timezones=["Asia/Kolkata"],
    )
    assert result["preview"] is True
    assert result["would_call"] == [("+15550101234", "Asia/Kolkata")]
