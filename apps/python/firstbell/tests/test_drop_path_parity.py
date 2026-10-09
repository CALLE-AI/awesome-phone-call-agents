"""The unattended path must obey the same rules as the attended one.

`DropSource` is the path a district runs from cron. `docs/consent-record.md` and the dialect
refusal both push a district towards dated consent records, and `DropSource`'s own docstring
calls the drop "the unattended path" that "removes the person". A district that follows both
pieces of advice at once was getting a nightly job that telephoned nobody and reported every
family as a consent refusal, because the register was parsed and thrown away.

The other half of the same gap: an empty directory raises, and an export whose overnight job
wrote the header row and then died returns cleanly with zero rows. The docstring commits to
the distinction it then fails to make for the case that looks like good news.
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))

from dispatch.sources import DropSource, SourceError  # noqa: E402
from dispatch.consent import load_register  # noqa: E402

HEADER = "id,phones,consent,consent_record,locale,region,student_name,absence_date\n"
ROW = ("S-1,+15550100301,,CR-2026-0401,en-US,US,Ada,2026-09-09\n")

REGISTER = {
    "records": [{
        "id": "CR-2026-0401",
        "student_id": "S-1",
        "channel": "voice",
        "purpose": "attendance",
        "given_at": "2026-08-01",
        "phones": ["+15550100301"],
    }]
}


def _drop(tmp_path: Path, body: str) -> Path:
    directory = tmp_path / "drop"
    directory.mkdir()
    (directory / "nightly.csv").write_text(body, encoding="utf-8")
    return directory


def test_the_drop_path_uses_a_consent_register_it_is_given(tmp_path):
    """Same file, same register, same answer as `--work-file` gives."""
    register = load_register(REGISTER, "register.json")
    source = DropSource(_drop(tmp_path, HEADER + ROW),
                        consent_register=register, today=date(2026, 9, 9))
    items = list(source.items())
    assert len(items) == 1, "the row was refused against a register that covers it"
    assert items[0].consent_record == "CR-2026-0401"


def test_the_drop_path_without_a_register_still_refuses_a_row_that_names_one(tmp_path):
    """The failure this must keep: no register, no call. It fails closed either way.

    The refusal rides on the item rather than raising, because one undocumented row must
    not stop the wave; the dispatcher declines to dial anything carrying one.
    """
    items = list(DropSource(_drop(tmp_path, HEADER + ROW)).items())
    assert len(items) == 1
    assert items[0].consent_refusal is not None, (
        "a row naming a record, with no register to check it against, was dialled")
    assert "CR-2026-0401" in items[0].consent_refusal


def test_a_header_only_export_is_refused_rather_than_reported_as_a_quiet_success(tmp_path):
    """The third failure mode, and the one that looks like good news.

    A stale export and a re-used one are both refused. A truncated one parsed to zero rows
    and returned cleanly, so a school day passed with nobody telephoned and a cron job that
    saw exit 0. `tools/adopt_call_records.py` already makes exactly this check in the tool
    that dials nothing.
    """
    source = DropSource(_drop(tmp_path, HEADER))
    with pytest.raises(SourceError) as raised:
        list(source.items())
    said = str(raised.value)
    assert "header" in said, "the refusal has to say what is wrong with the file"
    assert "nightly.csv" in said, "and which file it was"


def test_a_drop_that_is_refused_is_not_written_to_the_ledger(tmp_path):
    """Refusing must not strand tomorrow's corrected export under the same name."""
    directory = _drop(tmp_path, HEADER)
    source = DropSource(directory)
    with pytest.raises(SourceError):
        list(source.items())
    assert not (directory / DropSource.LEDGER).exists()
