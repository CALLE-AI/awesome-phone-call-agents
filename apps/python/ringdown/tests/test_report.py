from __future__ import annotations

from datetime import UTC, datetime

from ringdown.report import ladder_lines
from tests.data import LADDER


def test_the_ladder_shows_each_person_their_own_clock():
    moment = datetime(2026, 8, 9, 12, 0, tzinfo=UTC)

    lines = ladder_lines(LADDER, moment)

    assert "Alice Okafor" in lines[1] and lines[1].endswith("08:00 local")
    assert "Ben Mensah" in lines[2] and lines[2].endswith("13:00 local")
    assert "Carla Varga" in lines[3] and lines[3].endswith("14:00 local")
