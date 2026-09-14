"""Car import lead qualifier: one consent-first CALL-E call per inbound lead."""

from __future__ import annotations

from .locales import MARKETS, Market, resolve_market, supported_prefixes
from .models import Lead, LeadBatch, load_batch, mask_phone, parse_batch
from .routing import Decision, route_outcome
from .schema import build_result_schema
from .task import build_task

# `qualifier.runner` is imported on demand, not here: `python -m qualifier.runner`
# warns when the package already imported the module being executed.

__all__ = [
    "MARKETS",
    "Decision",
    "Lead",
    "LeadBatch",
    "Market",
    "build_result_schema",
    "build_task",
    "load_batch",
    "mask_phone",
    "parse_batch",
    "resolve_market",
    "route_outcome",
    "supported_prefixes",
]

__version__ = "0.1.0"
