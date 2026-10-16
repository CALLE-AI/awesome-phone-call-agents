import html
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import streamlit as st
from dotenv import load_dotenv


# ============================================================
# PATH SETUP
# ============================================================

APP_DIR = Path(__file__).resolve().parent

if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))


# Load local environment variables for Streamlit as well.
load_dotenv(APP_DIR / ".env")


from call_store import load_calls, update_call
from retention_engine import (
    analyze_transcript_with_llm,
    load_config,
)


# ============================================================
# FILES
# ============================================================

COMPANY_CONFIG_FILE = APP_DIR / "company_config.json"
CUSTOMERS_FILE = APP_DIR / "customers.json"


# ============================================================
# PAGE CONFIG
# ============================================================

st.set_page_config(
    page_title="Customer Churn Rescue",
    page_icon="📞",
    layout="wide",
    initial_sidebar_state="collapsed",
)


# ============================================================
# CUSTOM CSS
# ============================================================

st.markdown(
    """
<style>
.stApp {
    background:
        radial-gradient(circle at 8% 0%, rgba(99,102,241,.16), transparent 30%),
        radial-gradient(circle at 92% 8%, rgba(14,165,233,.12), transparent 28%),
        #080d1a;
}

.block-container {
    max-width: 1420px;
    padding-top: 1.5rem;
    padding-bottom: 4rem;
}

.hero {
    text-align: center;
    padding: 2.2rem 1.5rem 1.9rem;
    margin-bottom: 1.4rem;
    border: 1px solid rgba(148,163,184,.16);
    border-radius: 24px;
    background: linear-gradient(135deg, rgba(15,23,42,.94), rgba(15,23,42,.68));
    box-shadow: 0 18px 45px rgba(0,0,0,.18);
}

.hero-icon {
    font-size: 2.5rem;
    margin-bottom: .5rem;
}

.hero-company {
    font-size: 2.2rem;
    font-weight: 850;
    letter-spacing: -.04em;
    line-height: 1.1;
}

.hero-product {
    margin-top: .45rem;
    font-size: 1.12rem;
    font-weight: 650;
    color: #cbd5e1;
}

.hero-subtitle {
    margin-top: .45rem;
    color: #94a3b8;
    font-size: .96rem;
}

.section-title {
    font-size: 1.28rem;
    font-weight: 800;
    margin-top: 1.5rem;
    margin-bottom: .3rem;
}

.section-caption {
    color: #94a3b8;
    font-size: .9rem;
    margin-bottom: .9rem;
}

[data-testid="stMetric"] {
    background: rgba(15,23,42,.76);
    border: 1px solid rgba(148,163,184,.15);
    border-radius: 17px;
    padding: 1rem 1.1rem;
    min-height: 108px;
}

[data-testid="stExpander"] {
    border: 1px solid rgba(148,163,184,.15);
    border-radius: 16px;
    background: rgba(15,23,42,.58);
    overflow: hidden;
    margin-bottom: .75rem;
}

.policy-card {
    box-sizing: border-box;
    min-height: 235px;
    padding: 1.05rem;
    border-radius: 15px;
    background: rgba(15,23,42,.65);
    border: 1px solid rgba(148,163,184,.12);
}

.policy-name {
    font-weight: 800;
    color: #f8fafc;
    font-size: 1rem;
}

.policy-description {
    color: #94a3b8;
    font-size: .84rem;
    line-height: 1.5;
    margin-top: .45rem;
}

.customer-card {
    padding: 1rem;
    border-radius: 15px;
    background: rgba(15,23,42,.60);
    border: 1px solid rgba(148,163,184,.13);
}

.badge {
    display: inline-block;
    padding: .34rem .72rem;
    border-radius: 999px;
    font-size: .74rem;
    font-weight: 800;
    letter-spacing: .02em;
}

.badge-success {
    color: #86efac;
    background: rgba(34,197,94,.13);
    border: 1px solid rgba(34,197,94,.25);
}

.badge-danger {
    color: #fca5a5;
    background: rgba(239,68,68,.13);
    border: 1px solid rgba(239,68,68,.25);
}

.badge-warning {
    color: #fcd34d;
    background: rgba(245,158,11,.13);
    border: 1px solid rgba(245,158,11,.25);
}

.badge-info {
    color: #93c5fd;
    background: rgba(59,130,246,.13);
    border: 1px solid rgba(59,130,246,.25);
}

.badge-neutral {
    color: #cbd5e1;
    background: rgba(148,163,184,.12);
    border: 1px solid rgba(148,163,184,.20);
}

.insight-card {
    padding: 1.1rem;
    border-radius: 15px;
    background: linear-gradient(135deg, rgba(30,41,59,.8), rgba(15,23,42,.7));
    border: 1px solid rgba(99,102,241,.22);
}

.insight-label {
    color: #94a3b8;
    font-size: .74rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .04em;
    margin-top: .65rem;
}

.insight-value {
    color: #e2e8f0;
    line-height: 1.5;
    margin-top: .15rem;
}

.info-card {
    box-sizing: border-box;
    padding: 1rem 1.1rem;
    border-radius: 15px;
    background: rgba(30,41,59,.48);
    border: 1px solid rgba(148,163,184,.13);
}

.transcript-agent {
    padding: .78rem .92rem;
    margin: .45rem 0;
    border-radius: 12px;
    background: rgba(59,130,246,.08);
    border: 1px solid rgba(59,130,246,.13);
}

.transcript-customer {
    padding: .78rem .92rem;
    margin: .45rem 0;
    border-radius: 12px;
    background: rgba(148,163,184,.07);
    border: 1px solid rgba(148,163,184,.10);
}

.footer-note {
    text-align: center;
    color: #64748b;
    font-size: .78rem;
    margin-top: 2rem;
}

.small-muted {
    color: #94a3b8;
    font-size: .82rem;
}
</style>
""",
    unsafe_allow_html=True,
)


# ============================================================
# JSON LOADERS
# ============================================================

def load_json_file(
    path: Path,
    default: Any,
) -> Any:
    """Safely load a JSON file."""

    if not path.exists():
        return default

    try:
        with open(
            path,
            "r",
            encoding="utf-8",
        ) as file:
            return json.load(file)

    except (
        OSError,
        json.JSONDecodeError,
    ):
        return default


def load_company_config() -> Dict[str, Any]:
    """Load company configuration."""

    try:
        return load_config()
    except (
        OSError,
        json.JSONDecodeError,
    ):
        return load_json_file(
            COMPANY_CONFIG_FILE,
            {},
        )


def load_customers() -> List[Dict[str, Any]]:
    """Load the at-risk customer queue."""

    data = load_json_file(
        CUSTOMERS_FILE,
        [],
    )

    return data if isinstance(
        data,
        list,
    ) else []


# ============================================================
# CALL HELPERS
# ============================================================

def get_structured_result(
    call: Dict[str, Any],
) -> Dict[str, Any]:

    result = call.get(
        "structured_result"
    )

    return (
        result
        if isinstance(result, dict)
        else {}
    )


def get_call_id(
    call: Dict[str, Any],
) -> str:

    return str(
        call.get("id")
        or call.get("call_id")
        or call.get("record_id")
        or "Unknown"
    )


def get_customer_id(
    call: Dict[str, Any],
) -> str:

    metadata = call.get(
        "metadata",
        {},
    )

    if not isinstance(
        metadata,
        dict,
    ):
        metadata = {}

    return str(
        call.get("customer_id")
        or metadata.get("customer_id")
        or "Unknown"
    )


def get_customer_name(
    call: Dict[str, Any],
    customers: List[Dict[str, Any]],
) -> str:

    direct_name = call.get(
        "customer_name"
    )

    if direct_name:
        return str(
            direct_name
        )

    customer_id = get_customer_id(
        call
    )

    for customer in customers:

        if customer.get(
            "customer_id"
        ) == customer_id:

            return str(
                customer.get(
                    "name",
                    "Unknown",
                )
            )

    return "Unknown"


def get_call_phone(
    call: Dict[str, Any],
    customers: List[Dict[str, Any]],
) -> str:

    if call.get("phone"):
        return str(
            call["phone"]
        )

    recipients = call.get(
        "recipients",
        [],
    )

    if recipients:
        phones = recipients[0].get(
            "phones",
            [],
        )

        if phones:
            return str(
                phones[0]
            )

    customer_id = get_customer_id(
        call
    )

    for customer in customers:

        if customer.get(
            "customer_id"
        ) == customer_id:

            return str(
                customer.get(
                    "phone",
                    "Unknown",
                )
            )

    return "Unknown"


def mask_phone(
    phone: str,
) -> str:

    if not phone or phone == "Unknown":
        return "Unknown"

    phone = str(phone)

    if len(phone) <= 6:
        return "••••"

    return (
        f"{phone[:3]}"
        f"••••••"
        f"{phone[-3:]}"
    )


def get_source(
    call: Dict[str, Any],
) -> str:

    return str(
        call.get(
            "source",
            "live",
        )
    )


def friendly_text(
    value: Any,
) -> str:

    if value is None:
        return "Unknown"

    text = str(
        value
    ).strip()

    if not text:
        return "Unknown"

    return (
        text
        .replace(
            "_",
            " ",
        )
        .replace(
            "-",
            " ",
        )
        .title()
    )


def is_completed(
    call: Dict[str, Any],
) -> bool:

    result = get_structured_result(
        call
    )

    return (
        str(
            call.get(
                "status",
                "",
            )
        ).lower()
        == "completed"
        and result.get(
            "call_completed"
        )
        is True
    )


def get_decision(
    call: Dict[str, Any],
) -> str:

    return str(
        get_structured_result(
            call
        ).get(
            "customer_decision",
            "unknown",
        )
    ).lower()


def needs_human(
    call: Dict[str, Any],
) -> bool:

    return bool(
        get_structured_result(
            call
        ).get(
            "human_follow_up_required",
            False,
        )
    )


def status_label(
    call: Dict[str, Any],
) -> str:

    status = str(
        call.get(
            "status",
            "unknown",
        )
    ).lower()

    failure_code = call.get(
        "failure_code"
    )

    if status == "completed":
        return "COMPLETED"

    if "no answer" in status:
        return "NO ANSWER"

    if status == "failed":

        if failure_code:
            return (
                f"FAILED • "
                f"{failure_code}"
            )

        return "FAILED"

    if status == "declined":
        return "DECLINED"

    return status.upper()


def status_badge(
    label: str,
) -> str:

    safe_label = html.escape(
        label
    )

    if label == "COMPLETED":

        return (
            '<span class="badge badge-success">'
            f"● {safe_label}"
            "</span>"
        )

    if label.startswith("FAILED"):

        return (
            '<span class="badge badge-danger">'
            f"● {safe_label}"
            "</span>"
        )

    if label == "NO ANSWER":

        return (
            '<span class="badge badge-warning">'
            f"● {safe_label}"
            "</span>"
        )

    return (
        '<span class="badge badge-neutral">'
        f"● {safe_label}"
        "</span>"
    )


def source_badge(
    source: str,
) -> str:

    if source == "synthetic_demo":

        return (
            '<span class="badge badge-info">'
            "SYNTHETIC DEMO"
            "</span>"
        )

    if source == "live":

        return (
            '<span class="badge badge-success">'
            "LIVE CALL-E"
            "</span>"
        )

    return (
        '<span class="badge badge-neutral">'
        f"{html.escape(source.upper())}"
        "</span>"
    )


# ============================================================
# OFFER HELPERS
# ============================================================

def offer_map(
    offers: List[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:

    return {
        str(
            offer.get(
                "id",
                ""
            )
        ): offer
        for offer in offers
    }


def friendly_offer(
    offer_id: Any,
    offers: List[Dict[str, Any]],
) -> str:

    if not offer_id or str(
        offer_id
    ) in {
        "none",
        "unknown",
    }:

        return "No authorized offer"

    lookup = offer_map(
        offers
    )

    offer = lookup.get(
        str(offer_id)
    )

    if offer:

        return str(
            offer.get(
                "label",
                offer_id,
            )
        )

    return str(
        offer_id
    )


# ============================================================
# TRANSCRIPT
# ============================================================

def get_transcript(
    call: Dict[str, Any],
) -> List[Dict[str, str]]:
    """
    Support both synthetic top-level transcripts
    and nested CALL-E transcript_turns.
    """

    direct_transcript = call.get(
        "transcript"
    )

    if isinstance(
        direct_transcript,
        list,
    ):

        cleaned = []

        for turn in direct_transcript:

            if not isinstance(
                turn,
                dict,
            ):
                continue

            text = str(
                turn.get(
                    "text",
                    "",
                )
            ).strip()

            if not text:
                continue

            cleaned.append(
                {
                    "speaker": str(
                        turn.get(
                            "speaker",
                            "unknown",
                        )
                    ),
                    "text": text,
                }
            )

        if cleaned:
            return cleaned

    transcript = []

    for recipient in call.get(
        "recipients",
        [],
    ):

        for attempt in recipient.get(
            "attempts",
            [],
        ):

            for turn in attempt.get(
                "transcript_turns",
                [],
            ):

                if not isinstance(
                    turn,
                    dict,
                ):
                    continue

                text = str(
                    turn.get(
                        "text",
                        "",
                    )
                ).strip()

                if not text:
                    continue

                transcript.append(
                    {
                        "speaker": str(
                            turn.get(
                                "speaker",
                                "unknown",
                            )
                        ),
                        "text": text,
                    }
                )

    return transcript


def transcript_to_text(
    call: Dict[str, Any],
    company_name: str,
) -> str:

    lines = []

    for turn in get_transcript(
        call
    ):

        text = turn["text"].replace(
            "{company_name}",
            company_name,
        )

        lines.append(
            f'{turn["speaker"]}: {text}'
        )

    return "\n".join(
        lines
    )


# ============================================================
# ANALYTICS
# ============================================================

def calculate_metrics(
    customers: List[Dict[str, Any]],
    calls: List[Dict[str, Any]],
):
    """
    Calculate dashboard retention metrics dynamically.

    Retention Rate is defined for this project as:

        retained calls / total logged calls

    Every call record contributes to the denominator, including:
    completed calls, human escalations, failed attempts, and
    no-answer attempts.

    This keeps the dashboard aligned with the operational view
    of the entire retention-call workload.
    """

    at_risk = sum(
        1
        for customer in customers
        if customer.get(
            "churn_status"
        ) == "at_risk"
    )

    total_calls = len(calls)

    completed = [
        call
        for call in calls
        if is_completed(call)
    ]

    retained = [
        call
        for call in completed
        if get_decision(call) == "accepted"
    ]

    human = [
        call
        for call in calls
        if needs_human(call)
    ]

    retention_rate = (
        len(retained) / total_calls
        if total_calls
        else 0
    )

    return (
        at_risk,
        total_calls,
        len(completed),
        len(retained),
        retention_rate,
        len(human),
    )


def latest_call_for_customer(
    customer_id: str,
    calls: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:

    matches = [
        call
        for call in calls
        if get_customer_id(
            call
        ) == customer_id
    ]

    return (
        matches[-1]
        if matches
        else None
    )


def reason_counts(
    calls: List[Dict[str, Any]],
) -> Dict[str, int]:

    counts: Dict[str, int] = {}

    for call in calls:

        if not is_completed(call):
            continue

        reason = str(
            get_structured_result(
                call
            ).get(
                "primary_reason",
                "unknown",
            )
        ).lower()

        if reason == "unknown":
            continue

        counts[reason] = (
            counts.get(
                reason,
                0,
            )
            + 1
        )

    return counts


# ============================================================
# LOAD APPLICATION DATA
# ============================================================

config = load_company_config()

company = config.get(
    "company",
    {},
)

product = config.get(
    "product",
    {},
)

policy = config.get(
    "retention_policy",
    {},
)

offers = policy.get(
    "offers",
    [],
)

customers = load_customers()

# ONE SOURCE OF TRUTH FOR CALL RESULTS
calls = load_calls()

company_name = str(
    company.get(
        "name",
        "Subscription Company",
    )
)

company_description = str(
    company.get(
        "description",
        "",
    )
)

product_name = str(
    product.get(
        "name",
        "Subscription Service",
    )
)

business_type = str(
    company.get(
        "business_type",
        "Subscription business",
    )
)

currency = str(
    company.get(
        "currency",
        "USD",
    )
)


# ============================================================
# HERO
# ============================================================

safe_company = html.escape(
    company_name
)

safe_product = html.escape(
    product_name
)

st.markdown(
    f'<div class="hero">'
    f'<div class="hero-icon">📞</div>'
    f'<div class="hero-company">{safe_company} Retention Center</div>'
    f'<div class="hero-product">Customer Churn Rescue</div>'
    f'<div class="hero-subtitle">AI-powered customer retention with CALL-E</div>'
    f'</div>',
    unsafe_allow_html=True,
)

if company_description:

    st.markdown(
        f'<div class="small-muted" style="text-align:center;margin-bottom:1rem;">'
        f'{html.escape(company_description)}'
        f'</div>',
        unsafe_allow_html=True,
    )


# ============================================================
# OVERVIEW
# ============================================================

st.markdown(
    '<div class="section-title">Retention Overview</div>',
    unsafe_allow_html=True,
)

st.markdown(
    f'<div class="section-caption">'
    f'{html.escape(company_name)} • '
    f'{html.escape(business_type)} • '
    f'{html.escape(product_name)}'
    f'</div>',
    unsafe_allow_html=True,
)

(
    at_risk,
    total_calls,
    completed_calls,
    retained_calls,
    retention_rate,
    human_followup,
) = calculate_metrics(
    customers,
    calls,
)

m1, m2, m3, m4, m5, m6 = st.columns(6)

m1.metric(
    "At-Risk Customers",
    at_risk,
)

m2.metric(
    "Calls Logged",
    total_calls,
)

m3.metric(
    "Completed",
    completed_calls,
)

m4.metric(
    "Retained",
    retained_calls,
)

m5.metric(
    "Retention Rate",
    f"{retention_rate:.0%}",
)

m6.metric(
    "Human Follow-up",
    human_followup,
)


# ============================================================
# CUSTOMER QUEUE
# ============================================================

st.markdown(
    '<div class="section-title">Customer Queue</div>',
    unsafe_allow_html=True,
)

st.markdown(
    f'<div class="section-caption">'
    f'Customers currently identified by '
    f'{html.escape(company_name)} as being at risk of cancellation.'
    f'</div>',
    unsafe_allow_html=True,
)

if not customers:

    st.info(
        "No customer records are present in customers.json."
    )

else:

    for customer in customers:

        customer_id = str(
            customer.get(
                "customer_id",
                "Unknown",
            )
        )

        customer_name = str(
            customer.get(
                "name",
                "Unknown",
            )
        )

        plan = str(
            customer.get(
                "plan",
                "unknown",
            )
        )

        tenure = customer.get(
            "tenure_months",
            "?",
        )

        churn_status = friendly_text(
            customer.get(
                "churn_status",
                "unknown",
            )
        )

        latest_call = latest_call_for_customer(
            customer_id,
            calls,
        )

        with st.expander(
            f"{customer_name}  •  "
            f"{plan.title()}  •  "
            f"{tenure} months"
        ):

            left, right = st.columns(
                [2, 1]
            )

            with left:

                st.markdown(
                    f"### {customer_name}"
                )

                st.write(
                    f"**Customer ID:** `{customer_id}`"
                )

                st.write(
                    f"**Plan:** {plan.title()}"
                )

                st.write(
                    f"**Tenure:** {tenure} months"
                )

                st.write(
                    f"**Status:** {churn_status}"
                )

                st.write(
                    f"**Trigger:** "
                    f"{friendly_text(customer.get('trigger', 'unknown'))}"
                )

            with right:

                st.markdown(
                    "#### Latest Call"
                )

                if latest_call is None:

                    st.info(
                        "No call recorded yet."
                    )

                else:

                    label = status_label(
                        latest_call
                    )

                    st.markdown(
                        status_badge(label),
                        unsafe_allow_html=True,
                    )

                    result = get_structured_result(
                        latest_call
                    )

                    st.write(
                        f"**Reason:** "
                        f"{friendly_text(result.get('primary_reason'))}"
                    )

                    st.write(
                        f"**Decision:** "
                        f"{friendly_text(result.get('customer_decision'))}"
                    )


# ============================================================
# ACTIVE RETENTION POLICY
# ============================================================

st.markdown(
    '<div class="section-title">Active Retention Policy</div>',
    unsafe_allow_html=True,
)

st.markdown(
    '<div class="section-caption">'
    "These are the retention actions currently authorized by the company. "
    "The customer's conversation determines which action is relevant."
    "</div>",
    unsafe_allow_html=True,
)

if offers:

    columns = st.columns(
        min(
            len(offers),
            3,
        )
    )

    for index, offer in enumerate(
        offers
    ):

        with columns[
            index % len(columns)
        ]:

            label = html.escape(
                str(
                    offer.get(
                        "label",
                        offer.get(
                            "id",
                            "Offer",
                        ),
                    )
                )
            )

            description = html.escape(
                str(
                    offer.get(
                        "description",
                        "",
                    )
                )
            )

            plans = html.escape(
                ", ".join(
                    map(
                        str,
                        offer.get(
                            "plan_in",
                            [],
                        ),
                    )
                )
            )

            reasons = html.escape(
                ", ".join(
                    map(
                        str,
                        offer.get(
                            "reasons",
                            [],
                        ),
                    )
                )
            )

            minimum_tenure = html.escape(
                str(
                    offer.get(
                        "min_tenure_months",
                        0,
                    )
                )
            )

            st.markdown(
                f'<div class="policy-card">'
                f'<div class="policy-name">{label}</div>'
                f'<div class="policy-description">{description}</div>'
                f'<div style="margin-top:1rem;line-height:1.8;">'
                f'<strong>Plans:</strong> {plans}<br>'
                f'<strong>Minimum tenure:</strong> {minimum_tenure} months<br>'
                f'<strong>Reasons:</strong> {reasons}'
                f'</div>'
                f'</div>',
                unsafe_allow_html=True,
            )

else:

    st.info(
        "No retention offers are configured."
    )


# ============================================================
# OBSERVED CHURN REASONS
# ============================================================

st.markdown(
    '<div class="section-title">Observed Churn Reasons</div>',
    unsafe_allow_html=True,
)

counts = reason_counts(
    calls
)

if counts:

    sorted_counts = sorted(
        counts.items(),
        key=lambda item: item[1],
        reverse=True,
    )

    reason_columns = st.columns(
        min(
            len(sorted_counts),
            5,
        )
    )

    for index, (
        reason,
        count,
    ) in enumerate(
        sorted_counts
    ):

        reason_columns[
            index % len(reason_columns)
        ].metric(
            friendly_text(reason),
            count,
        )

else:

    st.info(
        "No completed call results with identified churn reasons yet."
    )


# ============================================================
# CALL RESULTS
# ============================================================

st.markdown(
    '<div class="section-title">Call Results</div>',
    unsafe_allow_html=True,
)

st.markdown(
    '<div class="section-caption">'
    "Single source of truth: "
    "<code>data/calls.json</code>. "
    "Every record is clearly identified as synthetic or live."
    "</div>",
    unsafe_allow_html=True,
)

if not calls:

    st.warning(
        "No call results have been stored yet."
    )

else:

    for call in reversed(
        calls
    ):

        call_id = get_call_id(
            call
        )

        source = get_source(
            call
        )

        label = status_label(
            call
        )

        customer_id = get_customer_id(
            call
        )

        customer_name = get_customer_name(
            call,
            customers,
        )

        structured = get_structured_result(
            call
        )

        reason = structured.get(
            "primary_reason",
            "unknown",
        )

        decision = structured.get(
            "customer_decision",
            "unknown",
        )

        offer_id = structured.get(
            "offer_presented",
            "none",
        )

        offer_label = friendly_offer(
            offer_id,
            offers,
        )

        source_label = (
            "Synthetic demonstration"
            if source == "synthetic_demo"
            else "Actual CALL-E execution"
            if source == "live"
            else friendly_text(source)
        )

        with st.expander(
            f"{customer_name}  •  "
            f"{friendly_text(reason)}  •  "
            f"{label}  •  "
            f"{source_label}"
        ):

            st.markdown(
                f"{source_badge(source)} "
                f"{status_badge(label)}",
                unsafe_allow_html=True,
            )

            st.write("")

            # ------------------------------------------------
            # CALL INFORMATION
            # ------------------------------------------------

            info_left, info_right = st.columns(2)

            with info_left:

                st.write(
                    "**Call ID**"
                )

                st.code(
                    call_id,
                    language=None,
                )

                st.write(
                    "**Customer**"
                )

                st.write(
                    customer_name
                )

                st.write(
                    "**Customer ID**"
                )

                st.write(
                    customer_id
                )

            with info_right:

                st.write(
                    "**Phone**"
                )

                st.write(
                    mask_phone(
                        get_call_phone(
                            call,
                            customers,
                        )
                    )
                )

                st.write(
                    "**CALL-E Status**"
                )

                st.write(
                    str(
                        call.get(
                            "status",
                            "unknown",
                        )
                    ).upper()
                )

                provider_id = None

                recipients = call.get(
                    "recipients",
                    [],
                )

                if recipients:

                    attempts = recipients[
                        0
                    ].get(
                        "attempts",
                        [],
                    )

                    if attempts:

                        provider_id = attempts[
                            0
                        ].get(
                            "provider_call_id"
                        )

                if provider_id:

                    st.write(
                        "**Provider Call ID**"
                    )

                    st.code(
                        provider_id,
                        language=None,
                    )


            # ------------------------------------------------
            # FAILURE INFORMATION
            # ------------------------------------------------

            if (
                label.startswith("FAILED")
                or label == "NO ANSWER"
            ):

                st.markdown(
                    "### Call Status Details"
                )

                failure_code = call.get(
                    "failure_code"
                )

                failure_message = call.get(
                    "failure_message"
                )

                if failure_code:

                    st.write(
                        f"**Failure code:** `{failure_code}`"
                    )

                if failure_message:

                    st.write(
                        f"**Failure message:** "
                        f"{failure_message}"
                    )

                st.warning(
                    "This call did not establish a completed "
                    "customer conversation. It must not be interpreted "
                    "as a customer retention decision."
                )


            # ------------------------------------------------
            # CALL-E SUMMARY
            # ------------------------------------------------

            st.markdown(
                "### CALL-E Summary"
            )

            summary = call.get(
                "summary"
            )

            if summary:

                st.write(
                    summary
                )

            else:

                st.info(
                    "No summary available."
                )


            # ------------------------------------------------
            # RETENTION RESULT
            # ------------------------------------------------

            st.markdown(
                "### Retention Result"
            )

            if structured:

                r1, r2, r3 = st.columns(3)

                r1.metric(
                    "Churn Risk",
                    friendly_text(
                        structured.get(
                            "churn_risk",
                            "unknown",
                        )
                    ),
                )

                r2.metric(
                    "Primary Reason",
                    friendly_text(
                        reason
                    ),
                )

                r3.metric(
                    "Customer Decision",
                    friendly_text(
                        decision
                    ),
                )

                r1, r2, r3 = st.columns(3)

                r1.metric(
                    "Recoverable",
                    friendly_text(
                        structured.get(
                            "recoverable",
                            "unknown",
                        )
                    ),
                )

                r2.metric(
                    "Offer Presented",
                    offer_label,
                )

                r3.metric(
                    "Human Follow-up",
                    (
                        "YES"
                        if structured.get(
                            "human_follow_up_required",
                            False,
                        )
                        else "NO"
                    ),
                )

                recommended_id = structured.get(
                    "recommended_offer",
                    "none",
                )

                recommended_label = friendly_offer(
                    recommended_id,
                    offers,
                )

                eligibility = structured.get(
                    "offer_eligibility",
                    "unknown",
                )

                st.markdown(
                    "#### Policy Result"
                )

                p1, p2 = st.columns(2)

                p1.write(
                    f"**Recommended action:** "
                    f"{recommended_label}"
                )

                p2.write(
                    f"**Eligibility:** "
                    f"{friendly_text(eligibility)}"
                )

                evidence = structured.get(
                    "evidence",
                    [],
                )

                if evidence:

                    st.markdown(
                        "#### Evidence"
                    )

                    for item in evidence:

                        st.write(
                            f"• {item}"
                        )

                else:

                    st.write(
                        "No evidence available."
                    )

            else:

                st.info(
                    "No structured retention result was returned."
                )


            # ------------------------------------------------
            # CONVERSATION
            # ------------------------------------------------

            st.markdown(
                "### Conversation"
            )

            transcript = get_transcript(
                call
            )

            if transcript:

                for turn in transcript:

                    speaker = turn[
                        "speaker"
                    ]

                    text = turn[
                        "text"
                    ].replace(
                        "{company_name}",
                        company_name,
                    )

                    if speaker.lower() in {
                        "call-e",
                        "bot",
                        "assistant",
                        "agent",
                    }:

                        st.markdown(
                            f'<div class="transcript-agent">'
                            f'<strong>🤖 CALL-E</strong><br>'
                            f'{html.escape(text)}'
                            f'</div>',
                            unsafe_allow_html=True,
                        )

                    else:

                        st.markdown(
                            f'<div class="transcript-customer">'
                            f'<strong>👤 Customer</strong><br>'
                            f'{html.escape(text)}'
                            f'</div>',
                            unsafe_allow_html=True,
                        )

            else:

                if label.startswith(
                    "FAILED"
                ) or label == "NO ANSWER":

                    st.warning(
                        "No transcript was captured because "
                        "the call did not reach a conversation."
                    )

                else:

                    st.info(
                        "No transcript available."
                    )


            # ------------------------------------------------
            # AI POST-CALL ANALYSIS
            # ------------------------------------------------

            st.markdown(
                "### 🧠 AI Post-Call Analysis"
            )

            existing_analysis = call.get(
                "llm_analysis"
            )

            if existing_analysis:

                analysis_data = existing_analysis.get(
                    "analysis",
                    existing_analysis,
                )

                if isinstance(
                    analysis_data,
                    dict,
                ):

                    st.markdown(
                        '<div class="insight-card">',
                        unsafe_allow_html=True,
                    )

                    fields = [
                        (
                            "Customer pain point",
                            "customer_pain_point",
                        ),
                        (
                            "Communication tone",
                            "communication_tone",
                        ),
                        (
                            "Retention opportunity",
                            "retention_opportunity",
                        ),
                        (
                            "Unresolved issue",
                            "unresolved_issue",
                        ),
                        (
                            "Summary",
                            "concise_summary",
                        ),
                    ]

                    for label_text, key in fields:

                        value = analysis_data.get(
                            key
                        )

                        if value:

                            st.markdown(
                                f'<div class="insight-label">'
                                f'{html.escape(label_text)}'
                                f'</div>'
                                f'<div class="insight-value">'
                                f'{html.escape(str(value))}'
                                f'</div>',
                                unsafe_allow_html=True,
                            )

                    st.markdown(
                        "</div>",
                        unsafe_allow_html=True,
                    )

                    model_name = existing_analysis.get(
                        "model"
                    )

                    if model_name:

                        st.caption(
                            f"Model: {model_name}"
                        )

                else:

                    st.json(
                        existing_analysis
                    )

            else:

                if transcript:

                    st.write(
                        "Use the optional post-call AI analyst "
                        "to extract deeper insights from this conversation."
                    )

                    button_key = (
                        f"llm_{call_id}"
                    )

                    if st.button(
                        "🧠 Generate AI Insight",
                        key=button_key,
                    ):

                        transcript_text = (
                            transcript_to_text(
                                call,
                                company_name,
                            )
                        )

                        with st.spinner(
                            "Analyzing completed conversation..."
                        ):

                            analysis = (
                                analyze_transcript_with_llm(
                                    transcript_text
                                )
                            )

                        if analysis.get(
                            "enabled"
                        ):

                            saved = update_call(
                                call_id,
                                {
                                    "llm_analysis": analysis,
                                },
                            )

                            if saved:

                                st.success(
                                    "AI insight generated and saved to data/calls.json."
                                )

                                st.rerun()

                            else:

                                st.warning(
                                    "AI analysis succeeded, but the call record "
                                    "could not be updated."
                                )

                                st.json(
                                    analysis
                                )

                        else:

                            st.error(
                                "AI analysis could not be generated."
                            )

                            st.write(
                                analysis.get(
                                    "reason",
                                    "Unknown error.",
                                )
                            )

                else:

                    st.info(
                        "AI analysis is unavailable because this call "
                        "has no completed transcript."
                    )


# ============================================================
# LIVE CALL INSTRUCTIONS
# ============================================================

st.divider()

st.markdown(
    '<div class="section-title">Run a Real CALL-E Call</div>',
    unsafe_allow_html=True,
)

st.markdown(
    '<div class="info-card">'
    '<strong>1. Activate your virtual environment</strong><br><br>'
    '<code>.venv\\Scripts\\Activate.ps1</code><br><br>'
    '<strong>2. Choose an authorized customer from customers.json</strong><br><br>'
    '<strong>3. Run the live-call command</strong><br><br>'
    '<code>python run_live_call.py --customer-id C1001</code><br><br>'
    '<strong>4. Confirm the REAL CALL-E call when prompted</strong><br><br>'
    '<strong>5. After CALL-E finishes, refresh this dashboard</strong><br><br>'
    'The result is saved to <code>data/calls.json</code>.'
    '</div>',
    unsafe_allow_html=True,
)


# ============================================================
# CURRENT COMPANY CONFIGURATION
# ============================================================

st.divider()

with st.expander(
    "⚙ Current Company Configuration"
):

    c1, c2 = st.columns(2)

    with c1:

        st.write(
            "**Company:**",
            company_name,
        )

        st.write(
            "**Business type:**",
            business_type,
        )

        st.write(
            "**Product:**",
            product_name,
        )

    with c2:

        st.write(
            "**Currency:**",
            currency,
        )

        st.write(
            "**Configured plans:**"
        )

        for plan in config.get(
            "plans",
            [],
        ):

            st.write(
                f"• {plan.get('name', plan.get('id', 'Unnamed'))}"
            )


# ============================================================
# REFRESH
# ============================================================

st.divider()

if st.button(
    "🔄 Refresh Dashboard",
    use_container_width=True,
):

    st.rerun()


# ============================================================
# FOOTER
# ============================================================

st.markdown(
    '<div class="footer-note">'
    'Customer Churn Rescue • Policy-bounded retention • CALL-E'
    '</div>',
    unsafe_allow_html=True,
)