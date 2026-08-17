import pytest

from pipeline.models import CallMetadata, SignalTag
from pipeline.scoring import REMOTE_ACCESS_SIGNAL_ID, score
from pipeline.signal_catalog import load_catalog

CATALOG = load_catalog()
METADATA = CallMetadata(number_dialed="REDACTED", duration_seconds=60, timestamp="now")


def make_tags(present_ids):
    all_ids = {sig["id"]: (sig["name"], cat) for cat, block in CATALOG["categories"].items() for sig in block["signals"]}
    return [
        SignalTag(id=sid, name=name, category=cat, present=sid in present_ids, quote="quote" if sid in present_ids else None)
        for sid, (name, cat) in all_ids.items()
    ]


def test_no_signals_is_likely_legitimate_with_zero_score():
    result = score(make_tags(set()), CATALOG, "transcript", METADATA)
    assert result.verdict == "likely_legitimate"
    assert result.score == 0
    assert result.warnings == []


def test_remote_access_critical_signal_forces_scam_and_emits_distinct_warning():
    assert REMOTE_ACCESS_SIGNAL_ID == "C1"
    with pytest.warns(UserWarning, match="remote-access/remote-desktop"):
        result = score(make_tags({"C1"}), CATALOG, "transcript", METADATA)
    assert result.verdict == "likely_scam"
    assert any("remote-access/remote-desktop" in w for w in result.warnings)


def test_other_critical_signal_forces_scam_with_generic_warning_not_remote_access():
    result = score(make_tags({"C2"}), CATALOG, "transcript", METADATA)
    assert result.verdict == "likely_scam"
    assert not any("remote-access/remote-desktop" in w for w in result.warnings)
    assert any("critical scam indicator" in w for w in result.warnings)


def test_two_high_signals_reach_scam_threshold_without_any_critical_hit():
    result = score(make_tags({"H1", "H2"}), CATALOG, "transcript", METADATA)  # 2 * 3 = 6
    assert result.verdict == "likely_scam"
    assert result.score == 6
    assert result.warnings == []


def test_one_high_signal_is_inconclusive():
    result = score(make_tags({"H1"}), CATALOG, "transcript", METADATA)  # 3
    assert result.verdict == "inconclusive"


def test_medium_signals_alone_stay_below_scam_threshold():
    result = score(make_tags({"M1", "M2"}), CATALOG, "transcript", METADATA)  # 2
    assert result.verdict == "likely_legitimate"
    assert result.score == 2


def test_triggered_signals_only_include_present_ones():
    result = score(make_tags({"H3"}), CATALOG, "transcript", METADATA)
    assert [t.id for t in result.triggered_signals] == ["H3"]


# --- outcome-aware scoring: a call that didn't produce real evidence must
# never fall through to likely_legitimate just because no signals fired ---


@pytest.mark.parametrize("bad_status", ["FAILED", "NO_ANSWER", "CANCELED", "DECLINED", "UNKNOWN"])
def test_non_completed_call_is_inconclusive_even_with_zero_tags(bad_status):
    metadata = CallMetadata(number_dialed="REDACTED", duration_seconds=0, timestamp="now", status=bad_status)
    result = score(make_tags(set()), CATALOG, "", metadata)
    assert result.verdict == "inconclusive"
    assert result.score == 0
    assert result.triggered_signals == []
    assert any("scoreable evidence" in w for w in result.warnings)


def test_empty_transcript_is_inconclusive_even_with_completed_status():
    metadata = CallMetadata(number_dialed="REDACTED", duration_seconds=90, timestamp="now", status="COMPLETED")
    result = score(make_tags(set()), CATALOG, "   ", metadata)  # whitespace-only
    assert result.verdict == "inconclusive"
    assert any("scoreable evidence" in w for w in result.warnings)


def test_completed_call_with_zero_tags_is_still_likely_legitimate():
    # Guards against over-correcting: a real, completed, clean call must
    # still be able to reach likely_legitimate — only missing evidence
    # should force inconclusive.
    metadata = CallMetadata(number_dialed="REDACTED", duration_seconds=90, timestamp="now", status="COMPLETED")
    result = score(make_tags(set()), CATALOG, "a real transcript", metadata)
    assert result.verdict == "likely_legitimate"
