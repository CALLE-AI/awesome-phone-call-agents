from __future__ import annotations

import pytest

from kept.money import AmountParseError, format_minor, parse_amount_to_minor


@pytest.mark.parametrize(
    ("text", "expected_minor"),
    [
        ("1250", 125_000),
        ("1250.00", 125_000),
        ("1,250.00", 125_000),
        ("$1,250.50", 125_050),
        ("  980  ", 98_000),
        ("0.05", 5),
    ],
)
def test_parses_written_and_spoken_amounts(text: str, expected_minor: int) -> None:
    assert parse_amount_to_minor(text) == expected_minor


@pytest.mark.parametrize(
    "text",
    ["", "   ", "most of it", "1,25,000.00", "-500", "1250.005", "next Friday"],
)
def test_refuses_anything_it_cannot_read_exactly(text: str) -> None:
    with pytest.raises(AmountParseError):
        parse_amount_to_minor(text)


def test_indian_grouping_is_rejected_rather_than_guessed() -> None:
    """1,25,000 could be 125000 or 1250. Guessing would create a wrong debt."""
    with pytest.raises(AmountParseError):
        parse_amount_to_minor("1,25,000")


def test_formats_minor_units_with_thousands_separators() -> None:
    assert format_minor(480_000, "USD") == "USD 4,800.00"
    assert format_minor(5, "USD") == "USD 0.05"
