"""How a run is presented: terminal, JSON, and a standalone HTML page."""

from __future__ import annotations

from redline.report.html import render_html, write_html
from redline.report.json_export import (
    SCHEMA_VERSION,
    report_to_dict,
    verification_to_dict,
    write_json,
)
from redline.report.terminal import print_report, print_scenario_detail

__all__ = [
    "SCHEMA_VERSION",
    "print_report",
    "print_scenario_detail",
    "render_html",
    "report_to_dict",
    "verification_to_dict",
    "write_html",
    "write_json",
]
