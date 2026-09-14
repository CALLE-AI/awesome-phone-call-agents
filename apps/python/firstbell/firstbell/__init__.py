"""Phone the families whose absence notification went unanswered.

Offline by default. `--live` places real calls and says so.
"""

from .domain import AI_DISCLOSURE, RESULT_SCHEMA, FundingRate, ImpactSummary, build_task, summarise

__all__ = ["RESULT_SCHEMA", "AI_DISCLOSURE", "FundingRate", "ImpactSummary",
           "build_task", "summarise"]
