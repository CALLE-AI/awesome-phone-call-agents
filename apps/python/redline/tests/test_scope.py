"""Tests for the written authorisation that gates every real call.

Every number below is standards-reserved fiction, assembled from parts so this
file carries no literal a phone-number scanner would read as dialable.
"""

from __future__ import annotations

import subprocess
from datetime import date
from pathlib import Path

import pytest

from redline.scope import (
    SCOPE_FILENAME,
    Scope,
    ScopeError,
    Target,
    find_scope,
    load_scope,
)

FICTIONAL = "+" + "1415555" + "0142"
OTHER = "+" + "1415555" + "0177"
UK = "+" + "44770090" + "0123"

VALID = f"""
authorised_by: Dana Okafor, Head of Support Operations
contact: dana.okafor@example.com
expires: 2099-12-31
targets:
  - number: "{FICTIONAL}"
    owner: Test handset, support office
    note: Kept in the drawer.
  - number: "{UK}"
    owner: UK test SIM
"""


def write_scope(directory: Path, text: str) -> Path:
    path = directory / SCOPE_FILENAME
    path.write_text(text, encoding="utf-8")
    return path


class TestAValidScope:
    def test_it_loads(self, tmp_path: Path) -> None:
        scope = load_scope(write_scope(tmp_path, VALID))
        assert scope.authorised_by.startswith("Dana Okafor")
        assert scope.expires == date(2099, 12, 31)
        assert len(scope.targets) == 2

    def test_it_authorises_a_listed_number(self, tmp_path: Path) -> None:
        scope = load_scope(write_scope(tmp_path, VALID))
        target = scope.target_for(FICTIONAL)
        assert target is not None
        assert target.owner == "Test handset, support office"

    def test_it_tolerates_surrounding_whitespace_in_the_query(
        self, tmp_path: Path
    ) -> None:
        scope = load_scope(write_scope(tmp_path, VALID))
        assert scope.target_for(f"  {FICTIONAL} ") is not None

    def test_an_optional_note_is_kept(self, tmp_path: Path) -> None:
        scope = load_scope(write_scope(tmp_path, VALID))
        assert "drawer" in scope.target_for(FICTIONAL).note  # type: ignore[union-attr]

    def test_a_missing_note_is_empty_rather_than_absent(self, tmp_path: Path) -> None:
        scope = load_scope(write_scope(tmp_path, VALID))
        assert scope.target_for(UK).note == ""  # type: ignore[union-attr]


class TestMatchingIsExact:
    """The property the whole design rests on.

    A prefix allowlist is how one entry silently authorises a million phones,
    and "close enough" on a telephone number means somebody else's phone.
    """

    def test_an_unlisted_number_is_not_authorised(self, tmp_path: Path) -> None:
        scope = load_scope(write_scope(tmp_path, VALID))
        assert scope.target_for(OTHER) is None

    def test_a_prefix_of_a_listed_number_is_not_authorised(
        self, tmp_path: Path
    ) -> None:
        scope = load_scope(write_scope(tmp_path, VALID))
        assert scope.target_for(FICTIONAL[:8]) is None

    def test_a_listed_number_with_an_extra_digit_is_not_authorised(
        self, tmp_path: Path
    ) -> None:
        scope = load_scope(write_scope(tmp_path, VALID))
        assert scope.target_for(FICTIONAL + "9") is None

    def test_the_same_number_written_differently_is_not_authorised(
        self, tmp_path: Path
    ) -> None:
        # Deliberately not normalised. Reformatting a number to make it match
        # is a tool deciding it knows which phone you meant.
        scope = load_scope(write_scope(tmp_path, VALID))
        spaced = FICTIONAL[:2] + " " + FICTIONAL[2:5] + " " + FICTIONAL[5:]
        assert scope.target_for(spaced) is None


class TestWhatMakesItAnAuthorisation:
    @pytest.mark.parametrize("field", ["authorised_by", "contact"])
    def test_a_missing_signature_is_refused(self, tmp_path: Path, field: str) -> None:
        text = "\n".join(
            line for line in VALID.splitlines() if not line.startswith(f"{field}:")
        )
        with pytest.raises(ScopeError, match=field):
            load_scope(write_scope(tmp_path, text))

    def test_a_blank_signature_is_refused(self, tmp_path: Path) -> None:
        text = VALID.replace(
            "authorised_by: Dana Okafor, Head of Support Operations",
            'authorised_by: "   "',
        )
        with pytest.raises(ScopeError, match="authorised_by"):
            load_scope(write_scope(tmp_path, text))

    def test_a_missing_expiry_is_refused(self, tmp_path: Path) -> None:
        text = "\n".join(
            line for line in VALID.splitlines() if not line.startswith("expires:")
        )
        with pytest.raises(ScopeError, match="expires"):
            load_scope(write_scope(tmp_path, text))

    def test_there_is_no_way_to_write_no_expiry(self, tmp_path: Path) -> None:
        # The point of the field. Permission granted once in March is not
        # permission in November.
        text = VALID.replace("expires: 2099-12-31", "expires: never")
        with pytest.raises(ScopeError, match="YYYY-MM-DD"):
            load_scope(write_scope(tmp_path, text))

    def test_an_expired_authorisation_is_refused(self, tmp_path: Path) -> None:
        text = VALID.replace("expires: 2099-12-31", "expires: 2020-01-01")
        with pytest.raises(ScopeError, match="expired"):
            load_scope(write_scope(tmp_path, text))

    def test_the_expiry_day_itself_still_counts(self, tmp_path: Path) -> None:
        # Somebody who wrote 31 December meant to be covered on 31 December.
        text = VALID.replace("expires: 2099-12-31", "expires: 2026-06-30")
        scope = load_scope(write_scope(tmp_path, text), today=date(2026, 6, 30))
        assert scope.expires == date(2026, 6, 30)

    def test_the_day_after_does_not(self, tmp_path: Path) -> None:
        text = VALID.replace("expires: 2099-12-31", "expires: 2026-06-30")
        with pytest.raises(ScopeError, match="expired"):
            load_scope(write_scope(tmp_path, text), today=date(2026, 7, 1))


class TestWhatMakesATarget:
    def test_no_targets_is_refused(self, tmp_path: Path) -> None:
        text = VALID.split("targets:")[0] + "targets: []\n"
        with pytest.raises(ScopeError, match="targets"):
            load_scope(write_scope(tmp_path, text))

    @pytest.mark.parametrize(
        "number",
        [
            "415-555-0142",
            "+" + "1 415 555 0142",
            "00" + "14155550142",
            "not a number",
        ],
    )
    def test_a_number_that_is_not_strict_e164_is_refused(
        self, tmp_path: Path, number: str
    ) -> None:
        text = VALID.replace(FICTIONAL, number)
        with pytest.raises(ScopeError, match=r"E\.164"):
            load_scope(write_scope(tmp_path, text))

    def test_a_target_with_no_owner_is_refused(self, tmp_path: Path) -> None:
        text = "\n".join(
            line
            for line in VALID.splitlines()
            if "owner: Test handset, support office" not in line
        )
        with pytest.raises(ScopeError, match="owner"):
            load_scope(write_scope(tmp_path, text))

    def test_a_duplicated_number_is_refused(self, tmp_path: Path) -> None:
        text = VALID.replace(UK, FICTIONAL)
        with pytest.raises(ScopeError, match="twice"):
            load_scope(write_scope(tmp_path, text))

    def test_a_wildcard_is_not_a_number(self, tmp_path: Path) -> None:
        text = VALID.replace(FICTIONAL, "+" + "1415555*")
        with pytest.raises(ScopeError, match=r"E\.164"):
            load_scope(write_scope(tmp_path, text))

    def test_unicode_decimal_digits_are_not_e164(self, tmp_path: Path) -> None:
        text = VALID.replace(FICTIONAL, "+١٤١٥٥٥٥٠١٤٢")
        with pytest.raises(ScopeError, match=r"E\.164"):
            load_scope(write_scope(tmp_path, text))


class TestScopeFilePrivacy:
    def test_an_unignored_scope_inside_git_is_refused(self, tmp_path: Path) -> None:
        subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
        path = write_scope(tmp_path, VALID)
        with pytest.raises(ScopeError, match="not ignored"):
            load_scope(path)

    def test_an_ignored_scope_inside_git_is_allowed(self, tmp_path: Path) -> None:
        subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
        (tmp_path / ".gitignore").write_text(
            "redline.scope.yaml\n", encoding="utf-8"
        )
        assert load_scope(write_scope(tmp_path, VALID)).targets


class TestErrorsNeverPrintANumber:
    """A refusal is a log line, and a log line is an exposure too."""

    def test_the_duplicate_message_masks_the_number(self, tmp_path: Path) -> None:
        text = VALID.replace(UK, FICTIONAL)
        with pytest.raises(ScopeError) as caught:
            load_scope(write_scope(tmp_path, text))
        assert FICTIONAL not in str(caught.value)

    def test_the_missing_owner_message_masks_the_number(self, tmp_path: Path) -> None:
        text = "\n".join(
            line
            for line in VALID.splitlines()
            if "owner: Test handset, support office" not in line
        )
        with pytest.raises(ScopeError) as caught:
            load_scope(write_scope(tmp_path, text))
        assert FICTIONAL not in str(caught.value)


class TestFinding:
    def test_it_finds_a_file_beside_the_start(self, tmp_path: Path) -> None:
        write_scope(tmp_path, VALID)
        assert find_scope(tmp_path) == tmp_path / SCOPE_FILENAME

    def test_it_walks_upwards(self, tmp_path: Path) -> None:
        write_scope(tmp_path, VALID)
        nested = tmp_path / "a" / "b"
        nested.mkdir(parents=True)
        assert find_scope(nested) == tmp_path / SCOPE_FILENAME

    def test_it_stops_at_a_repository_boundary(self, tmp_path: Path) -> None:
        # Walking past the project boundary is how a tool picks up somebody
        # else's file and calls it consent.
        write_scope(tmp_path, VALID)
        project = tmp_path / "project"
        project.mkdir()
        (project / ".git").mkdir()
        assert find_scope(project) is None

    def test_it_returns_none_when_there_is_nothing(self, tmp_path: Path) -> None:
        (tmp_path / ".git").mkdir()
        assert find_scope(tmp_path) is None

    def test_a_missing_file_explains_what_to_do(self, tmp_path: Path) -> None:
        with pytest.raises(ScopeError, match="example"):
            load_scope(tmp_path / SCOPE_FILENAME)


class TestTheExampleThatShips:
    """The file a user copies has to be valid, and has to ring nothing."""

    EXAMPLE = Path(__file__).resolve().parent.parent / "redline.scope.example.yaml"

    def test_it_exists(self) -> None:
        assert self.EXAMPLE.is_file()

    def test_it_parses_as_a_scope(self, tmp_path: Path) -> None:
        copied = tmp_path / SCOPE_FILENAME
        copied.write_text(self.EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
        scope = load_scope(copied, today=date(2026, 9, 1))
        assert scope.targets

    #: The ranges standards bodies set aside so documentation can carry a
    #: number without ringing a phone. Written as digit patterns with no
    #: leading plus, so this file contains nothing a scanner reads as dialable.
    RESERVED = (
        r"1[2-9]\d{2}55501\d{2}",  # NANP documentation block, ATIS-0300115
        r"447700900\d{3}",  # Ofcom drama range, mobile
        r"44207946\d{4}",  # Ofcom drama range, London
        r"3399998\d{4}",  # ARCEP fiction range
        r"999\d+",  # ITU country code 999, unassigned
    )

    def test_every_example_number_is_standards_reserved(self, tmp_path: Path) -> None:
        # Copying the example and forgetting to edit it must not dial a
        # stranger. Checked here with the ranges themselves rather than with
        # the repository's scanner, because this suite has to keep passing
        # after the directory is lifted into a fork where that scanner does
        # not exist. The scanner checks the same file from the repository
        # side; the two agreeing is the point.
        import re

        pattern = re.compile("^(?:" + "|".join(self.RESERVED) + ")$")
        copied = tmp_path / SCOPE_FILENAME
        copied.write_text(self.EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
        scope = load_scope(copied, today=date(2026, 9, 1))
        unreserved = [
            target.masked
            for target in scope.targets
            if not pattern.match(target.number.lstrip("+"))
        ]
        assert unreserved == []

    def test_it_has_not_expired_before_the_hackathon_deadline(self) -> None:
        # A shipped example that fails validation on the day somebody tries it
        # teaches them the tool is broken.
        copied_text = self.EXAMPLE.read_text(encoding="utf-8")
        assert "expires: 2026-12-31" in copied_text


class TestTheDataclasses:
    def test_a_target_masks_its_own_number(self) -> None:
        target = Target(number=FICTIONAL, owner="Test handset")
        assert FICTIONAL not in target.masked

    def test_numbers_is_the_allowlist_the_transport_receives(self) -> None:
        scope = Scope(
            authorised_by="A",
            contact="b@example.com",
            expires=date(2099, 1, 1),
            targets=(Target(number=FICTIONAL, owner="x"),),
        )
        assert scope.numbers == (FICTIONAL,)
