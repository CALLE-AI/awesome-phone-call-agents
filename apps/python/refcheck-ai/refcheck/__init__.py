"""RefCheck — structured employment reference checks over CALL-E."""
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
    "build_result_schema",
    "build_reference_task",
    "compute_reference_score",
    "compute_candidate_score",
    "score_to_recommendation",
    "extract_transcript",
    "extract_duration_seconds",
    "extract_provider_call_id",
    "OUTCOME_TO_STATUS",
    "RATING_VALUES",
]
