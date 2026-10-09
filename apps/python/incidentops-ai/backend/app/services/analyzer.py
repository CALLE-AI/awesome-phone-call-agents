from __future__ import annotations

import logging

from app.models.incident import IncidentResponse
from app.services.gemini_service import analyze_with_gemini


logger = logging.getLogger(__name__)


ALLOWED_SEVERITIES = {
    "critical",
    "high",
    "medium",
    "low",
}


def _normalize_severity(
    severity: str,
) -> str:
    """
    Normalize severity while preserving the previous fallback behavior.
    """

    normalized = severity.strip().lower()

    if normalized not in ALLOWED_SEVERITIES:
        logger.warning(
            "Unknown incident severity %r. "
            "Treating it as low severity.",
            severity,
        )
        return "low"

    return normalized


def _priority_from_severity(
    severity: str,
) -> str:
    """
    Deterministic operational guardrail.

    This preserves the original project behavior and prevents an LLM
    response from assigning a lower priority than the operator's
    reported severity.
    """

    mapping = {
        "critical": "P1",
        "high": "P2",
        "medium": "P3",
        "low": "P4",
    }

    return mapping[severity]


def _fallback_root_cause(
    incident: str,
) -> str:
    """
    Explainable rule-based root-cause hypothesis.
    """

    text = incident.lower()

    rules = [
        (
            (
                "database",
                "sql",
                "postgres",
                "mysql",
                "db server",
            ),
            "Database availability or connectivity failure",
        ),
        (
            (
                "payment",
                "checkout",
                "transaction",
            ),
            "Transaction-processing service disruption",
        ),
        (
            (
                "network",
                "latency",
                "dns",
                "connection",
                "timeout",
            ),
            "Network or connectivity degradation",
        ),
        (
            (
                "authentication",
                "login",
                "token",
                "permission",
                "access",
            ),
            "Authentication or access-control failure",
        ),
        (
            (
                "deploy",
                "deployment",
                "release",
                "rollback",
                "version",
            ),
            "Recent deployment or release regression",
        ),
        (
            (
                "disk",
                "storage",
                "space",
                "volume",
            ),
            "Storage capacity or I/O degradation",
        ),
        (
            (
                "cpu",
                "memory",
                "resource",
                "overload",
            ),
            "Compute resource saturation",
        ),
    ]

    for keywords, root_cause in rules:
        if any(
            keyword in text
            for keyword in keywords
        ):
            return root_cause

    return (
        "Service availability degradation; "
        "the exact root cause requires validation"
    )


def _fallback_business_impact(
    incident: str,
    severity: str,
) -> str:
    """
    Generate a conservative impact assessment without inventing
    unsupported numbers.
    """

    text = incident.lower()

    if any(
        keyword in text
        for keyword in (
            "payment",
            "checkout",
            "transaction",
        )
    ):
        area = (
            "Customer transactions may be blocked, "
            "creating service and revenue risk."
        )

    elif any(
        keyword in text
        for keyword in (
            "login",
            "authentication",
            "customer",
            "portal",
        )
    ):
        area = (
            "Customers may be unable to access "
            "the affected production service."
        )

    elif "production" in text:
        area = (
            "Production service availability "
            "and dependent business operations may be affected."
        )

    else:
        area = (
            "The affected service may experience "
            "reduced availability or performance."
        )

    severity_prefix = {
        "critical": "Critical impact.",
        "high": "High potential impact.",
        "medium": "Moderate potential impact.",
        "low": "Limited current impact.",
    }[severity]

    return f"{severity_prefix} {area}"


def _fallback_owner(
    root_cause: str,
) -> str:
    """
    Select an explainable responder team.
    """

    text = root_cause.lower()

    if (
        "database" in text
        or "transaction" in text
    ):
        return "Database / Platform Engineering"

    if (
        "network" in text
        or "connectivity" in text
    ):
        return "Network / Cloud Operations"

    if (
        "authentication" in text
        or "access-control" in text
    ):
        return "Identity and Security Engineering"

    if (
        "deployment" in text
        or "release" in text
    ):
        return "Application Engineering"

    if (
        "storage" in text
        or "compute" in text
    ):
        return "Infrastructure / Platform Engineering"

    return "Site Reliability Engineering"


def _fallback_analysis(
    incident: str,
    severity: str,
) -> IncidentResponse:
    """
    Original deterministic analyzer, expanded with backward-compatible
    operational fields.
    """

    priority = _priority_from_severity(severity)
    root_cause = _fallback_root_cause(incident)

    return IncidentResponse(
        summary=f"Incident detected: {incident.strip()}",
        priority=priority,
        root_cause=root_cause,
        business_impact=_fallback_business_impact(
            incident=incident,
            severity=severity,
        ),
        owner=_fallback_owner(root_cause),
        recommendation=[
            "Notify the appropriate on-call engineer.",
            "Review application, infrastructure, and service logs.",
            "Verify the health of affected cloud and platform resources.",
        ],
    )


def analyze_incident(
    incident: str,
    severity: str,
) -> IncidentResponse:
    """
    Analyze a production incident.

    Processing order:

    1. Normalize and validate the operator-reported severity.
    2. Attempt Gemini 2.5 Flash structured analysis.
    3. Apply a deterministic severity-to-priority guardrail.
    4. Return the existing IncidentResponse model.
    5. Fall back safely to rule-based analysis on any Gemini failure.

    The function signature remains unchanged, so routes, SQLite,
    CALL-E, and the Streamlit dashboard continue to work.
    """

    clean_incident = " ".join(incident.split()).strip()
    normalized_severity = _normalize_severity(severity)

    fallback = _fallback_analysis(
        incident=clean_incident,
        severity=normalized_severity,
    )

    gemini_analysis = analyze_with_gemini(
        incident=clean_incident,
        severity=normalized_severity,
    )

    if gemini_analysis is None:
        return fallback

    guarded_priority = _priority_from_severity(
        normalized_severity
    )

    if gemini_analysis.priority != guarded_priority:
        logger.info(
            "Gemini proposed priority %s, but the operator severity "
            "guardrail requires %s. The guardrail priority will be used.",
            gemini_analysis.priority,
            guarded_priority,
        )

    return IncidentResponse(
        summary=gemini_analysis.summary,
        priority=guarded_priority,
        root_cause=gemini_analysis.root_cause,
        business_impact=gemini_analysis.business_impact,
        owner=gemini_analysis.owner,
        recommendation=gemini_analysis.recommendation,
    )
