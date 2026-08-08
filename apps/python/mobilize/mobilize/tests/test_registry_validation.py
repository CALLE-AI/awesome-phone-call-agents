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


def test_duplicate_auto_generated_id_also_rejected(tmp_path):
    # Two rows both omitting "id" would otherwise both compute the same
    # auto-generated id from row position -- but that can't actually
    # collide since row_number is unique per row. This test instead proves
    # an explicit id colliding with a LATER auto-generated one is caught.
    path = _write_csv(tmp_path, (
        "id,name,phone,timezone\n"
        "p0002,Asha Rao,+15550101001,Asia/Kolkata\n"
        ",Karan Mehta,+15550101002,Asia/Kolkata\n"
    ))
    with pytest.raises(RegistryError, match="duplicate id"):
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
