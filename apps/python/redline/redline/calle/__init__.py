"""The only part of REDLINE that knows what CALL-E looks like.

Everything else in the package speaks :mod:`redline.types`. Keeping the
platform's vocabulary behind this boundary lets the evaluator use one object
shape while retaining explicit static, replay, or live provenance.
"""

from __future__ import annotations

from redline.calle.models import (
    CalleParseError,
    call_record_from_payload,
    speaker_from_calle,
    unwrap_payload,
)
from redline.calle.schema_profile import (
    Issue,
    IssueLevel,
    SchemaReport,
    validate_result_schema,
)

__all__ = [
    "CalleParseError",
    "Issue",
    "IssueLevel",
    "SchemaReport",
    "call_record_from_payload",
    "speaker_from_calle",
    "unwrap_payload",
    "validate_result_schema",
]
