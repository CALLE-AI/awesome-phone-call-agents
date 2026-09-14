from pathlib import Path

import pytest

from pipeline.signal_catalog import build_result_schema, load_catalog, tag_transcript, tag_transcript_llm

CATALOG = load_catalog()


def test_tag_transcript_llm_default_provider_is_actually_registered(monkeypatch):
    # tag_transcript_llm's own default provider used to be "anthropic", which
    # isn't registered in PROVIDERS (only "gemini" is) — calling it with no
    # explicit provider raised "Unknown LLM provider" rather than the
    # intended GEMINI_API_KEY error. Removing both env vars and expecting
    # the Gemini-specific error (not a registry-lookup failure) proves the
    # default now resolves to a provider that's actually wired in.
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        tag_transcript_llm("irrelevant transcript", CATALOG)


def test_load_catalog_has_expected_shape():
    assert set(CATALOG["categories"]) == {"critical", "high", "medium"}
    assert "likely_scam_min_score" in CATALOG["thresholds"]
    assert "inconclusive_min_score" in CATALOG["thresholds"]


def test_tag_transcript_matches_literal_example_phrases():
    transcript = "Caller: I need you to download AnyDesk right now."
    tags = {t.id: t for t in tag_transcript(transcript, CATALOG)}
    assert tags["C1"].present is True
    assert "AnyDesk" in tags["C1"].quote
    assert tags["C2"].present is False


def test_tag_transcript_misses_ad_libbed_real_speech():
    # Regression test documenting a known limitation (see docs/CONCEPT.md
    # Limitations): the keyword tagger does not generalize to natural
    # speech, confirmed against a real CALL-E test call transcript where a
    # scammer evaded naming their company and refused a verifiable callback
    # number without using any of the literal example phrases.
    transcript = (
        "Caller: I can't tell you that. I need you to tell me that information. "
        "They can use the one in the e-mail. Just tell them to call the number "
        "and have their card details ready."
    )
    tags = tag_transcript(transcript, CATALOG)
    assert all(t.present is False for t in tags)


def test_build_result_schema_marks_critical_and_high_fields_required():
    schema = build_result_schema(CATALOG)
    assert schema["properties"]["requested_remote_access_software"] == {"type": "boolean"}
    assert "requested_remote_access_software" in schema["required"]
    # Medium-tier fields are optional, not required
    assert "relied_on_fixed_script" in schema["properties"]
    assert "relied_on_fixed_script" not in schema["required"]


def test_default_catalog_path_resolves_next_to_the_app_root():
    from pipeline.signal_catalog import DEFAULT_CATALOG_PATH

    assert DEFAULT_CATALOG_PATH == Path(__file__).resolve().parent.parent / "signals.json"
    assert DEFAULT_CATALOG_PATH.exists()
