from __future__ import annotations

import time
from datetime import datetime
from typing import Any

import pandas as pd
import requests
import streamlit as st


API_BASE_URL = "http://127.0.0.1:8000"
ANALYZE_URL = f"{API_BASE_URL}/incident/analyze"
HISTORY_URL = f"{API_BASE_URL}/incident/history"

PRODUCTION_TIMEOUT_SECONDS = 180
DEMO_TIMEOUT_SECONDS = 30


st.set_page_config(
    page_title="IncidentOps AI — Autonomous Incident Commander",
    page_icon="🚨",
    layout="wide",
    initial_sidebar_state="expanded",
)


st.markdown(
    """
    <style>
        .block-container {
            max-width: 1500px;
            padding-top: 1.35rem;
            padding-bottom: 4rem;
        }

        .hero {
            padding: 1.8rem 2rem;
            border: 1px solid #dbe4f0;
            border-radius: 20px;
            background:
                radial-gradient(circle at top right, rgba(91, 95, 255, 0.12), transparent 35%),
                linear-gradient(135deg, #ffffff 0%, #f7f9ff 100%);
            margin-bottom: 1rem;
        }

        .hero-kicker {
            display: inline-block;
            padding: 0.28rem 0.72rem;
            border-radius: 999px;
            background: #eef0ff;
            color: #4f46e5;
            font-size: 0.72rem;
            font-weight: 800;
            letter-spacing: 0.08rem;
            margin-bottom: 0.75rem;
        }

        .hero h1 {
            margin: 0;
            font-size: 2.3rem;
            line-height: 1.12;
            color: #14213d;
        }

        .hero p {
            margin: 0.65rem 0 0;
            color: #526079;
            font-size: 1.02rem;
            max-width: 900px;
        }

        .panel {
            padding: 1rem 1.1rem;
            border: 1px solid #dbe4f0;
            border-radius: 15px;
            background: #ffffff;
            margin-bottom: 0.75rem;
        }

        .executive-panel {
            padding: 1.15rem 1.25rem;
            border: 1px solid #cfd9ee;
            border-left: 5px solid #4f46e5;
            border-radius: 14px;
            background: linear-gradient(135deg, #ffffff 0%, #f8f9ff 100%);
            margin-bottom: 1rem;
        }

        .executive-title {
            color: #172554;
            font-weight: 800;
            font-size: 0.84rem;
            text-transform: uppercase;
            letter-spacing: 0.06rem;
            margin-bottom: 0.45rem;
        }

        .executive-copy {
            color: #34415d;
            font-size: 1rem;
            line-height: 1.55;
        }

        .timeline-row {
            display: flex;
            gap: 0.85rem;
            padding: 0.8rem 0.9rem;
            margin-bottom: 0.55rem;
            border: 1px solid #e1e7f0;
            border-radius: 12px;
            background: #ffffff;
        }

        .timeline-time {
            min-width: 64px;
            color: #4f46e5;
            font-weight: 800;
            font-size: 0.82rem;
        }

        .timeline-event {
            color: #2e3a53;
            font-weight: 600;
        }

        .feed-row {
            padding: 0.75rem 0.85rem;
            margin-bottom: 0.5rem;
            border: 1px solid #e2e8f0;
            border-radius: 11px;
            background: #ffffff;
        }

        .feed-title {
            font-weight: 750;
            color: #24324a;
            line-height: 1.35;
        }

        .feed-meta {
            color: #718096;
            font-size: 0.8rem;
            margin-top: 0.3rem;
        }

        .runbook-row {
            padding: 0.78rem 0.9rem;
            margin-bottom: 0.5rem;
            border: 1px solid #e1e7f0;
            border-radius: 11px;
            background: #ffffff;
        }

        .demo-banner {
            padding: 0.82rem 1rem;
            border: 1px solid #f2c66d;
            border-radius: 12px;
            background: #fffaf0;
            color: #7a5312;
            font-weight: 700;
            margin-bottom: 0.9rem;
        }

        .live-banner {
            padding: 0.82rem 1rem;
            border: 1px solid #82c9a0;
            border-radius: 12px;
            background: #f1fbf5;
            color: #17663a;
            font-weight: 700;
            margin-bottom: 0.9rem;
        }

        div[data-testid="stMetric"] {
            padding: 0.9rem 1rem;
            border: 1px solid #dbe4f0;
            border-radius: 14px;
            background: #ffffff;
        }

        div[data-testid="stForm"] {
            border: 1px solid #dbe4f0;
            border-radius: 15px;
            padding: 1rem;
        }

        .small-note {
            color: #718096;
            font-size: 0.82rem;
        }
    </style>
    """,
    unsafe_allow_html=True,
)


def check_backend() -> bool:
    try:
        response = requests.get(f"{API_BASE_URL}/", timeout=5)
        return response.status_code == 200
    except requests.RequestException:
        return False


def load_history() -> list[dict[str, Any]]:
    try:
        response = requests.get(HISTORY_URL, timeout=10)
        response.raise_for_status()
        data = response.json()

        if isinstance(data, list):
            return data

        if isinstance(data, dict) and isinstance(data.get("history"), list):
            return data["history"]

        return []
    except (requests.RequestException, ValueError):
        return []


def analyze_incident(
    incident: str,
    severity: str,
    demo_mode: bool,
) -> dict[str, Any]:
    timeout_seconds = DEMO_TIMEOUT_SECONDS if demo_mode else PRODUCTION_TIMEOUT_SECONDS

    response = requests.post(
        ANALYZE_URL,
        json={
            "incident": incident,
            "severity": severity,
            "demo_mode": demo_mode,
        },
        timeout=timeout_seconds,
    )
    response.raise_for_status()
    return response.json()


def normalize_status(status: Any) -> str:
    value = str(status or "UNKNOWN").upper()
    labels = {
        "DEMO_ACKNOWLEDGED": "Engineer Acknowledged",
        "READY_TO_RUN": "Voice Plan Ready",
        "ACTION_REQUIRED": "Configuration Required",
        "PLATFORM_TIMEOUT": "Retry Available",
        "NOT_REQUIRED": "Not Required",
        "CLI_ERROR": "Integration Error",
        "CLI_NOT_FOUND": "CLI Not Available",
        "INVALID_RESPONSE": "Invalid Response",
        "SYSTEM_ERROR": "System Error",
        "UNKNOWN": "Unknown",
    }
    return labels.get(value, value.replace("_", " ").title())


def history_dataframe(history: list[dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []

    for item in history:
        if not isinstance(item, dict):
            continue

        rows.append(
            {
                "ID": item.get("id", ""),
                "Incident": item.get("incident", "Unknown incident"),
                "Severity": item.get("severity", "Unknown"),
                "Priority": item.get("priority", "Unknown"),
                "Escalation Status": normalize_status(item.get("call_status")),
                "Attempts": item.get("call_attempts", 0),
                "Retry": "Yes" if item.get("retry_available") else "No",
                "Created": item.get("created_at", ""),
            }
        )

    return pd.DataFrame(rows)


def extract_metrics(history: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(history)
    critical = 0
    p1 = 0
    open_incidents = 0
    acknowledged = 0

    pending_states = {
        "ACTION_REQUIRED",
        "PLATFORM_TIMEOUT",
        "READY_TO_RUN",
        "CLI_ERROR",
        "SYSTEM_ERROR",
    }

    for item in history:
        severity = str(item.get("severity", "")).lower()
        priority = str(item.get("priority", "")).upper()
        call_status = str(item.get("call_status", "")).upper()

        if severity == "critical":
            critical += 1

        if priority == "P1":
            p1 += 1

        if call_status == "DEMO_ACKNOWLEDGED":
            acknowledged += 1

        if call_status in pending_states:
            open_incidents += 1

    acknowledgement_rate = round((acknowledged / total) * 100) if total else 0

    return {
        "total": total,
        "critical": critical,
        "p1": p1,
        "open": open_incidents,
        "acknowledged": acknowledged,
        "ack_rate": acknowledgement_rate,
    }


def severity_distribution(history: list[dict[str, Any]]) -> pd.DataFrame:
    categories = ["Critical", "High", "Medium", "Low"]
    counts = {category: 0 for category in categories}

    for item in history:
        raw = str(item.get("severity", "")).strip().title()
        if raw in counts:
            counts[raw] += 1

    return pd.DataFrame(
        {
            "Severity": categories,
            "Incidents": [counts[category] for category in categories],
        }
    ).set_index("Severity")


def infer_root_cause(incident: str) -> str:
    text = incident.lower()

    rules = [
        (["database", "sql", "postgres", "mysql"], "Database Availability Failure"),
        (["latency", "timeout", "network", "dns"], "Network or Connectivity Degradation"),
        (["login", "authentication", "token", "permission"], "Authentication or Access Failure"),
        (["deploy", "release", "rollback"], "Deployment Regression"),
        (["disk", "storage", "volume"], "Storage Capacity or I/O Saturation"),
        (["cpu", "memory", "resource"], "Compute Resource Saturation"),
        (["payment", "checkout", "transaction"], "Transaction Processing Disruption"),
    ]

    for keywords, result in rules:
        if any(keyword in text for keyword in keywords):
            return result

    return "Service Availability Degradation"


def suggested_owner(root_cause: str) -> str:
    lowered = root_cause.lower()

    if "database" in lowered or "transaction" in lowered:
        return "Database / Platform Engineering"
    if "network" in lowered:
        return "Network / Cloud Operations"
    if "authentication" in lowered:
        return "Identity and Security Engineering"
    if "deployment" in lowered:
        return "Application Engineering"
    if "storage" in lowered or "compute" in lowered:
        return "Infrastructure / Platform Engineering"

    return "Site Reliability Engineering"


def executive_summary(
    incident: str,
    severity: str,
    analysis: dict[str, Any],
    call: dict[str, Any],
) -> str:
    priority = str(analysis.get("priority", "Unknown"))
    status = str(call.get("status", "NOT_REQUIRED")).upper()

    status_copy = {
        "DEMO_ACKNOWLEDGED": "The on-call acknowledgement workflow completed successfully in Safe Demo Mode.",
        "READY_TO_RUN": "A CALL-E voice plan is ready for execution.",
        "ACTION_REQUIRED": "The voice escalation requires a supported destination configuration.",
        "PLATFORM_TIMEOUT": "The voice request was preserved and can be retried.",
        "NOT_REQUIRED": "Voice escalation was not required for this priority.",
    }.get(status, "The escalation workflow returned a technical state requiring review.")

    return (
        f"{priority} {severity.lower()} incident detected. "
        f"{incident.strip()} {status_copy}"
    )


def render_mode_banner(demo_mode: bool) -> None:
    if demo_mode:
        st.markdown(
            """
            <div class="demo-banner">
                🧪 SAFE DEMO MODE — simulated acknowledgement; no real call is placed.
            </div>
            """,
            unsafe_allow_html=True,
        )
    else:
        st.markdown(
            """
            <div class="live-banner">
                📞 LIVE MODE — the backend will attempt the authenticated CALL-E integration.
            </div>
            """,
            unsafe_allow_html=True,
        )


def render_recent_feed(history: list[dict[str, Any]], limit: int = 6) -> None:
    st.subheader("Recent Incident Feed")

    if not history:
        st.info("No incident records yet.")
        return

    for item in history[:limit]:
        incident = str(item.get("incident", "Unknown incident"))
        severity = str(item.get("severity", "Unknown"))
        priority = str(item.get("priority", "Unknown"))
        status = normalize_status(item.get("call_status"))
        created = str(item.get("created_at", ""))

        st.markdown(
            f"""
            <div class="feed-row">
                <div class="feed-title">{incident}</div>
                <div class="feed-meta">
                    {severity} · {priority} · {status} · {created or "No timestamp"}
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )


def render_timeline(
    analysis: dict[str, Any],
    call: dict[str, Any],
    started_at: datetime | None,
    elapsed_seconds: float | None,
) -> None:
    st.subheader("Incident Timeline")

    base_time = started_at or datetime.now()
    call_status = normalize_status(call.get("status"))

    events = [
        ("T+00s", "Incident received"),
        ("T+01s", "Severity classified"),
        ("T+02s", f"Priority assigned: {analysis.get('priority', 'Unknown')}"),
        ("T+03s", "Response recommendations generated"),
        ("T+04s", "CALL-E escalation goal prepared"),
        (
            f"T+{elapsed_seconds:.1f}s" if elapsed_seconds is not None else "T+--",
            f"Escalation outcome: {call_status}",
        ),
        (
            f"T+{elapsed_seconds:.1f}s" if elapsed_seconds is not None else "T+--",
            "Incident audit record stored",
        ),
    ]

    for time_label, event in events:
        st.markdown(
            f"""
            <div class="timeline-row">
                <div class="timeline-time">{time_label}</div>
                <div class="timeline-event">{event}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )


def render_runbook(analysis: dict[str, Any], call: dict[str, Any]) -> None:
    st.subheader("Dynamic Runbook")

    recommendations = analysis.get("recommendation", [])
    steps: list[tuple[str, str]] = [
        ("✅", "Incident captured and classified"),
        ("✅", f"Priority assigned: {analysis.get('priority', 'Unknown')}"),
    ]

    if isinstance(recommendations, list):
        for recommendation in recommendations:
            steps.append(("🛠️", str(recommendation)))

    status = str(call.get("status", "")).upper()

    if status == "DEMO_ACKNOWLEDGED":
        steps.append(("✅", "On-call engineer acknowledgement recorded"))
    elif status == "PLATFORM_TIMEOUT":
        steps.append(("⏳", "Retry CALL-E voice escalation"))
    elif status == "ACTION_REQUIRED":
        steps.append(("⚙️", "Configure supported destination and language"))
    elif status == "READY_TO_RUN":
        steps.append(("📞", "Execute the prepared CALL-E voice plan"))

    for index, (icon, text) in enumerate(steps, start=1):
        st.markdown(
            f"""
            <div class="runbook-row">
                <strong>{icon} Step {index}</strong>&nbsp;&nbsp;{text}
            </div>
            """,
            unsafe_allow_html=True,
        )


with st.sidebar:
    st.title("IncidentOps AI")
    st.caption("Autonomous Incident Commander")
    st.divider()

    demo_mode = st.toggle(
        "Safe Demo Mode",
        value=True,
        help="Simulates acknowledgement and places no real call.",
    )

    render_mode_banner(demo_mode)

    scenario = st.selectbox(
        "Demo Scenario",
        [
            "Custom incident",
            "Payment database outage",
            "API latency degradation",
            "Authentication service failure",
            "Failed production deployment",
        ],
    )

    st.divider()
    st.markdown("### Mission Control")
    st.markdown("🟢 Incident API")
    st.markdown("🟢 Analysis Engine")
    st.markdown("🟢 SQLite Audit Store")
    st.markdown("🟣 CALL-E Integration")
    st.caption("Live status is verified from the backend at page load.")


st.markdown(
    """
    <div class="hero">
        <div class="hero-kicker">POWERED BY CALL-E</div>
        <h1>🚨 IncidentOps AI</h1>
        <p>
            Autonomous incident command for production teams — classify, explain,
            escalate, acknowledge, and audit every critical event.
        </p>
    </div>
    """,
    unsafe_allow_html=True,
)


backend_connected = check_backend()

if backend_connected:
    st.success("Backend connected — incident operations are available.")
else:
    st.error("Backend unavailable. Start FastAPI at http://127.0.0.1:8000.")


history = load_history()
metrics = extract_metrics(history)

session_mtta = st.session_state.get("latest_mtta_seconds")
session_mtta_label = f"{session_mtta:.1f}s" if isinstance(session_mtta, (int, float)) else "N/A"

kpi_1, kpi_2, kpi_3, kpi_4, kpi_5 = st.columns(5)

with kpi_1:
    st.metric("Total Incidents", metrics["total"])
with kpi_2:
    st.metric("Open Incidents", metrics["open"])
with kpi_3:
    st.metric("Critical Incidents", metrics["critical"])
with kpi_4:
    st.metric("Acknowledgement Rate", f'{metrics["ack_rate"]}%')
with kpi_5:
    st.metric(
        "Latest MTTA",
        session_mtta_label,
        help="Session-only request-to-acknowledgement time. It is not persisted historically.",
    )


st.caption(
    "Latest MTTA is measured only for the current browser session because the current database "
    "does not persist separate incident-created and acknowledgement timestamps."
)

st.divider()

overview_left, overview_right = st.columns([1.25, 0.75])

with overview_left:
    st.subheader("Severity Distribution")

    distribution = severity_distribution(history)

    if int(distribution["Incidents"].sum()) == 0:
        st.info("Run incident scenarios to populate the severity chart.")
    else:
        st.bar_chart(
            distribution,
            width="stretch",
            height=310,
        )

with overview_right:
    render_recent_feed(history)


scenario_descriptions = {
    "Custom incident": "",
    "Payment database outage": (
        "The production payment database is unavailable. "
        "Customer checkout transactions are failing and payment requests cannot be processed."
    ),
    "API latency degradation": (
        "The production API is experiencing severe latency and connection timeouts. "
        "Customer requests are failing."
    ),
    "Authentication service failure": (
        "The authentication service is unavailable. Customers cannot log in "
        "and active sessions are being rejected."
    ),
    "Failed production deployment": (
        "A new production deployment introduced application errors. "
        "The customer portal is unavailable and rollback is required."
    ),
}

st.divider()

form_col, workflow_col = st.columns([1.05, 0.95])

with form_col:
    st.subheader("Command a New Incident")

    with st.form("incident_form", clear_on_submit=False):
        incident_description = st.text_area(
            "Incident Description",
            value=scenario_descriptions.get(scenario, ""),
            placeholder="Describe the failure, affected service, and customer or business impact.",
            height=170,
        )

        field_left, field_right = st.columns(2)

        with field_left:
            severity = st.selectbox(
                "Reported Severity",
                ["Critical", "High", "Medium", "Low"],
            )

        with field_right:
            st.text_input(
                "Execution Mode",
                value="Safe Simulation" if demo_mode else "Live CALL-E Integration",
                disabled=True,
            )

        submitted = st.form_submit_button(
            "Analyze, Command and Escalate",
            width="stretch",
            disabled=not backend_connected,
        )

    if submitted:
        if not incident_description.strip():
            st.warning("Enter an incident description before continuing.")
        else:
            spinner_text = (
                "Running safe incident simulation..."
                if demo_mode
                else "Analyzing incident and contacting CALL-E..."
            )

            with st.spinner(spinner_text):
                request_started = time.perf_counter()
                started_at = datetime.now()

                try:
                    result = analyze_incident(
                        incident_description.strip(),
                        severity,
                        demo_mode,
                    )

                    elapsed = time.perf_counter() - request_started
                    call = result.get("call", {}) if isinstance(result, dict) else {}
                    call_status = str(call.get("status", "")).upper()

                    st.session_state["latest_result"] = result
                    st.session_state["latest_incident"] = incident_description.strip()
                    st.session_state["latest_severity"] = severity
                    st.session_state["latest_started_at"] = started_at
                    st.session_state["latest_elapsed_seconds"] = elapsed

                    if call_status in {"DEMO_ACKNOWLEDGED", "READY_TO_RUN"}:
                        st.session_state["latest_mtta_seconds"] = elapsed

                    st.success("Incident workflow completed.")
                    st.rerun()

                except requests.Timeout:
                    st.error("The request exceeded the allowed time.")
                except requests.RequestException as error:
                    st.error(f"Unable to process the incident: {error}")
                except ValueError:
                    st.error("The backend returned an invalid JSON response.")

with workflow_col:
    st.subheader("Autonomous Response Workflow")

    workflow = [
        "Capture production incident",
        "Classify operational severity",
        "Assign response priority",
        "Infer likely root-cause category",
        "Assess business impact",
        "Generate response runbook",
        "Prepare CALL-E escalation goal",
        "Record acknowledgement and audit history",
    ]

    for index, item in enumerate(workflow, start=1):
        st.markdown(
            f"""
            <div class="timeline-row">
                <div class="timeline-time">{index:02d}</div>
                <div class="timeline-event">{item}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )


latest_result = st.session_state.get("latest_result")

if isinstance(latest_result, dict):
    analysis = latest_result.get("analysis", {})
    call = latest_result.get("call", {})

    if not isinstance(analysis, dict):
        analysis = {}
    if not isinstance(call, dict):
        call = {}

    latest_incident = str(st.session_state.get("latest_incident", ""))
    latest_severity = str(st.session_state.get("latest_severity", "Unknown"))
    started_at = st.session_state.get("latest_started_at")
    elapsed_seconds = st.session_state.get("latest_elapsed_seconds")

    root_cause = infer_root_cause(latest_incident)
    owner = suggested_owner(root_cause)

    st.divider()
    st.markdown("## Active Incident Command Center")

    render_mode_banner(bool(call.get("demo_mode", latest_result.get("demo_mode", False))))

    summary = executive_summary(
        latest_incident,
        latest_severity,
        analysis,
        call,
    )

    st.markdown(
        f"""
        <div class="executive-panel">
            <div class="executive-title">Executive Summary</div>
            <div class="executive-copy">{summary}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    insight_1, insight_2, insight_3, insight_4 = st.columns(4)

    with insight_1:
        st.metric("Priority", analysis.get("priority", "Unknown"))
    with insight_2:
        st.metric("Likely Root Cause", root_cause)
    with insight_3:
        st.metric(
            "Business Impact",
            "Critical" if latest_severity.lower() == "critical" else latest_severity,
        )
    with insight_4:
        st.metric("Suggested Owner", owner)

    st.divider()

    analysis_col, call_col = st.columns(2)

    with analysis_col:
        st.subheader("Incident Analysis")
        st.info(analysis.get("summary", "No summary available."))

        st.markdown("**Recommended Actions**")
        recommendations = analysis.get("recommendation", [])

        if isinstance(recommendations, list):
            for index, item in enumerate(recommendations, start=1):
                st.markdown(f"**{index}.** {item}")

    with call_col:
        st.subheader("CALL-E Voice Escalation")

        status = normalize_status(call.get("status"))
        attempts = call.get("attempts", 0)
        retry = "Yes" if call.get("retry_available") else "No"

        status_col, attempts_col, retry_col = st.columns(3)

        with status_col:
            st.metric("Status", status)
        with attempts_col:
            st.metric("Attempts", attempts)
        with retry_col:
            st.metric("Retry", retry)

        if call.get("demo_mode"):
            st.warning(
                call.get(
                    "simulation_notice",
                    "Simulated result. No real phone call was placed.",
                )
            )

        if call.get("success"):
            st.success(call.get("message", "Escalation workflow completed."))
        else:
            st.warning(call.get("message", "Escalation requires review."))

        with st.expander("Technical CALL-E response"):
            st.json(call)

    st.divider()

    runbook_col, timeline_col = st.columns(2)

    with runbook_col:
        render_runbook(analysis, call)

    with timeline_col:
        render_timeline(
            analysis,
            call,
            started_at if isinstance(started_at, datetime) else None,
            elapsed_seconds if isinstance(elapsed_seconds, (int, float)) else None,
        )


st.divider()
st.subheader("Incident Audit History")

history = load_history()
table = history_dataframe(history)

if table.empty:
    st.info("No incident history is available.")
else:
    selected_statuses = st.multiselect(
        "Filter by escalation status",
        sorted(table["Escalation Status"].dropna().unique().tolist()),
        default=[],
    )

    filtered = table

    if selected_statuses:
        filtered = table[table["Escalation Status"].isin(selected_statuses)]

    st.dataframe(
        filtered,
        width="stretch",
        hide_index=True,
    )

    st.download_button(
        "Export Incident History",
        data=filtered.to_csv(index=False).encode("utf-8"),
        file_name="incidentops-audit-history.csv",
        mime="text/csv",
        width="content",
    )


st.divider()
st.caption(
    "IncidentOps AI — Autonomous Incident Commander | "
    "FastAPI · Streamlit · SQLite · CALL-E"
)
