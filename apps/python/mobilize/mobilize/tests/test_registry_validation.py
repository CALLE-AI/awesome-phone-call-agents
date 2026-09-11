from __future__ import annotations

import pytest

from mobilize.core.registry import RegistryError, load_registry_csv


def _write_csv(tmp_path, content: str):
    path = tmp_path / "registry.csv"
    path.write_text(content)
    return path


def test_invalid_phone_rejected_at_load_time(tmp_path):
    path = _write_csv(tmp_path, "name,phone,timezone\nAsha Rao,not-a-phone,Asia/Kolkata\n")
    with pytest.raises(RegistryError, match="E.164"):
        load_registry_csv(path)


def test_valid_e164_phone_accepted(tmp_path):
    path = _write_csv(tmp_path, "name,phone,timezone\nAsha Rao,+15550101001,Asia/Kolkata\n")
    registry = load_registry_csv(path)
    assert len(registry) == 1


def test_duplicate_id_rejected_not_silently_overwritten(tmp_path):
    path = _write_csv(tmp_path, (
        "id,name,phone,timezone\n"
        "p1,Asha Rao,+15550101001,Asia/Kolkata\n"
        "p1,Karan Mehta,+15550101002,Asia/Kolkata\n"
    ))
    with pytest.raises(RegistryError, match="duplicate id"):
        load_registry_csv(path)


def test_auto_generated_id_is_phone_derived_not_row_position(tmp_path):
    """The auto-generated id must be stable across row reordering -- a
    row-number-based id would silently reassign one person's do-not-call/
    cooldown history to whoever occupies that row after a re-upload."""
    from mobilize.core.validation import stable_id_from_phone

    path = _write_csv(tmp_path, "name,phone,timezone\nAsha Rao,+15550101001,Asia/Kolkata\n")
    registry = load_registry_csv(path)
    person = registry.all()[0]
    assert person.id == stable_id_from_phone("+15550101001")


def test_duplicate_phone_across_different_explicit_ids_is_rejected(tmp_path):
    """Two rows with different explicit ids but the SAME phone number (a
    copy-paste duplicate) must still be caught -- otherwise the same real
    person is dispatched to twice under two different candidate ids."""
    path = _write_csv(tmp_path, (
        "id,name,phone,timezone\n"
        "p1,Asha Rao,+15550101001,Asia/Kolkata\n"
        "p2,Asha (duplicate entry),+15550101001,Asia/Kolkata\n"
    ))
    with pytest.raises(RegistryError, match="already used in row"):
        load_registry_csv(path)


def test_invalid_timezone_rejected_at_load_time(tmp_path):
    path = _write_csv(tmp_path, "name,phone,timezone\nAsha Rao,+15550101001,Not/A/RealZone\n")
    with pytest.raises(RegistryError, match="IANA"):
        load_registry_csv(path)


def test_region_and_locale_optional_columns_flow_through(tmp_path):
    path = _write_csv(tmp_path, (
        "name,phone,timezone,region,locale\n"
        "Asha Rao,+15550101001,Asia/Kolkata,IN,en-IN\n"
    ))
    registry = load_registry_csv(path)
    candidate = registry.candidates()[0]
    assert candidate.region == "IN"
    assert candidate.locale == "en-IN"


def test_region_and_locale_default_to_none_when_omitted(tmp_path):
    path = _write_csv(tmp_path, "name,phone,timezone\nAsha Rao,+15550101001,Asia/Kolkata\n")
    registry = load_registry_csv(path)
    candidate = registry.candidates()[0]
    assert candidate.region is None
    assert candidate.locale is None
