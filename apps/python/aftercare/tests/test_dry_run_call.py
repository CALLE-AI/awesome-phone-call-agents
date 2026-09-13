from __future__ import annotations

from unittest.mock import patch

import pytest

from app.integrations.calle import place_call
from app.models.orm import Patient

FICTIONAL_PHONE = "+15555550100"


def _patient(*, consent: bool) -> Patient:
    return Patient(
        id=1,
        name="Demo Patient",
        phone=FICTIONAL_PHONE,
        consent_on_file=consent,
    )


def test_dry_run_place_call_does_not_construct_calle_client() -> None:
    with patch(
        "app.integrations.calle.CalleClient",
        side_effect=AssertionError("CalleClient must not be constructed"),
    ):
        result = place_call(
            _patient(consent=True),
            task="Ask how recovery is going.",
            result_schema={"type": "object", "properties": {}},
            dry_run=True,
            internal_call_id=1,
        )

    assert result.dry_run is True
    assert result.status == "dry_run"
    assert result.provider_call_id
    assert result.provider_call_id.startswith("dryrun_")


def test_live_place_call_without_consent_raises_before_client() -> None:
    with patch(
        "app.integrations.calle.CalleClient",
        side_effect=AssertionError("CalleClient must not be constructed"),
    ):
        with pytest.raises(ValueError, match="consent"):
            place_call(
                _patient(consent=False),
                task="Ask how recovery is going.",
                result_schema={"type": "object", "properties": {}},
                dry_run=False,
            )
