"""RefCheck — structured employment reference checks over CALL-E."""
from refcheck.phone import (
    DestinationError,
    assert_authorized,
    allowlist,
    mask,
    mask_all,
    normalize_e164,
)
from refcheck.schema import build_result_schema, RATING_VALUES
from refcheck.task import build_reference_task
from refcheck.scoring import (
    compute_reference_score,
    compute_candidate_score,
    score_to_recommendation,
)
from refcheck.results import (
    extract_transcript,
    extract_duration_seconds,
    extract_provider_call_id,
    OUTCOME_TO_STATUS,
)

__all__ = [
    "DestinationError",
    "OUTCOME_TO_STATUS",
    "RATING_VALUES",
    "allowlist",
    "assert_authorized",
    "build_reference_task",
    "build_result_schema",
    "compute_candidate_score",
    "compute_reference_score",
    "extract_duration_seconds",
    "extract_provider_call_id",
    "extract_transcript",
    "mask",
    "mask_all",
    "normalize_e164",
    "score_to_recommendation",
]
