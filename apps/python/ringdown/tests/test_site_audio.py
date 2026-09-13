from __future__ import annotations

import json
from pathlib import Path

import pytest

from demo.audio import PANELS, VOICES, manifest
from tests.data import EXAMPLES

AUDIO = EXAMPLES.parents[3] / "docs" / "audio"
SPOKEN = ("speaker", "name", "text", "field")

pytestmark = pytest.mark.skipif(
    not AUDIO.exists(), reason="docs/ stays out of the upstream checkout"
)


def committed() -> dict:
    return json.loads((AUDIO / "manifest.json").read_text())


def said(scenarios: dict) -> dict:
    return {
        panel: [{key: turn[key] for key in SPOKEN} for turn in scenario["turns"]]
        for panel, scenario in scenarios["scenarios"].items()
    }


def test_the_audio_on_the_site_says_what_the_fake_server_says_today():
    assert said(committed()) == said(manifest())


def test_every_track_the_manifest_names_is_committed():
    for panel in PANELS:
        assert (AUDIO / committed()["scenarios"][panel]["file"]).exists()


def test_every_turn_but_the_silent_one_falls_inside_its_own_track():
    for scenario in committed()["scenarios"].values():
        spoken = [turn for turn in scenario["turns"] if turn["speaker"] != "silent"]
        assert spoken, "a scenario with nothing to play would render an empty player"
        assert all(turn["start"] < turn["end"] for turn in spoken)
        assert all(
            earlier["end"] <= later["start"] for earlier, later in zip(spoken, spoken[1:])
        )


def test_every_voice_the_manifest_needs_is_named():
    for scenario in committed()["scenarios"].values():
        for turn in scenario["turns"]:
            if turn["speaker"] != "silent":
                assert turn["name"] in VOICES
