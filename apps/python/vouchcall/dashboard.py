import streamlit as st
import plotly.graph_objects as go
import store
from config import DIMENSIONS

store.init_db()

st.set_page_config(page_title="VouchCall", page_icon="📞", layout="wide")
st.title("VouchCall — Reference Check Dashboard")
st.caption("Three references. Three phone calls. One clear picture.")

candidates = store.get_all_candidates()
if not candidates:
    st.warning("No candidates found. Run `python seed_data.py` to add demo data.")
    st.stop()

selected = st.selectbox(
    "Select candidate",
    candidates,
    format_func=lambda c: f"{c['name']} — {c['role_title']}",
)

calls = store.get_calls_for_candidate(selected["id"])
analysis = store.get_analysis(selected["id"])

if not calls:
    st.info("No reference calls completed yet.")
    st.stop()

QUALITY_DISPLAY = {
    "verified": ("Verified", "🟢"),
    "partial": ("Partial", "🟡"),
    "insufficient": ("Insufficient", "🔴"),
    "no_consent": ("Declined Consent", "⚫"),
    "wrong_person": ("Wrong Person", "🔴"),
}

col1, col2, col3 = st.columns(3)
verified = [c for c in calls if c.get("quality_status") == "verified"]
col1.metric("Verified References", f"{len(verified)}/{len(calls)}")

if analysis:
    rec_display = {
        "strong_hire": "Strong Hire ✅",
        "hire": "Hire 👍",
        "lean_hire": "Lean Hire 🤔",
        "lean_no": "Lean No 👎",
        "no_hire": "No Hire ❌",
    }
    col2.metric("Recommendation", rec_display.get(analysis.get("hire_recommendation"), "Pending"))
    col3.metric("Confidence", f"{analysis.get('confidence_score', 0)}%")

non_verified = [c for c in calls if c.get("quality_status") and c.get("quality_status") != "verified"]
if non_verified:
    with st.expander(f"⚠️ {len(non_verified)} reference(s) excluded from analysis"):
        for call in non_verified:
            qs = call.get("quality_status", "unknown")
            label, icon = QUALITY_DISPLAY.get(qs, (qs, "⚪"))
            st.markdown(f"{icon} **{call.get('ref_name', '?')}** — {label}: {call.get('summary', '')}")

st.subheader("Score Comparison")

dimensions = DIMENSIONS
dim_labels = [d.replace("_", " ").title() for d in dimensions]

fig = go.Figure()
for call in verified:
    scores = [call.get(f"{d}_score", 0) for d in dimensions]
    scores_closed = scores + [scores[0]]
    labels_closed = dim_labels + [dim_labels[0]]
    fig.add_trace(go.Scatterpolar(
        r=scores_closed,
        theta=labels_closed,
        fill="toself",
        name=f"{call.get('ref_name', '?')} ({call.get('ref_relation', '?')})",
        opacity=0.6,
    ))

fig.update_layout(
    polar=dict(radialaxis=dict(visible=True, range=[0, 10])),
    height=450,
    margin=dict(l=60, r=60, t=40, b=40),
)
st.plotly_chart(fig, use_container_width=True)

st.subheader("Per-Reference Details")
for call in calls:
    qs = call.get("quality_status", "")
    qs_label, qs_icon = QUALITY_DISPLAY.get(qs, ("", ""))

    if qs == "verified":
        rec_emoji = {
            "strong_yes": "🟢", "yes": "🟢", "neutral": "🟡", "hesitant": "🟠", "no": "🔴"
        }.get(call.get("overall_recommendation", ""), "⚪")
        header = f"{rec_emoji} {call.get('ref_name', '?')} — {call.get('ref_relation', '?')} — {call.get('overall_recommendation', 'N/A')}"
    else:
        header = f"{qs_icon} {call.get('ref_name', '?')} — {call.get('ref_relation', '?')} — {qs_label}"

    with st.expander(header):
        if qs != "verified":
            st.warning(f"This reference was not included in the analysis: {qs_label}")
            st.write(f"**Summary:** {call.get('summary', 'N/A')}")
            continue

        cols = st.columns(5)
        for i, (dim, label) in enumerate(zip(dimensions, dim_labels)):
            score = call.get(f"{dim}_score", 0)
            cols[i].metric(label, f"{score}/10")

        st.write(f"**Summary:** {call.get('summary', 'N/A')}")

        strengths = call.get("strengths", [])
        if strengths:
            st.write(f"**Strengths:** {', '.join(strengths)}")

        growth = call.get("growth_areas", [])
        if growth:
            st.write(f"**Growth areas:** {', '.join(growth)}")

        quotes = call.get("key_quotes", [])
        if quotes:
            st.write("**Key quotes:**")
            for q in quotes:
                st.markdown(f"> *\"{q}\"*")

if analysis:
    st.subheader("Cross-Reference Analysis")
    if len(verified) < len(calls):
        st.info(f"Analysis based on {len(verified)} verified reference(s) out of {len(calls)} total.")
    st.write(analysis.get("overall_summary", ""))

    discs = analysis.get("discrepancies", [])
    if discs:
        st.subheader("Discrepancies Found")
        for d in discs:
            severity_color = {"minor": "🟡", "notable": "🟠", "major": "🔴"}.get(
                d.get("severity", ""), "⚪"
            )
            st.markdown(f"{severity_color} **{d.get('dimension', '?')}** — {d.get('detail', '')}")
    else:
        st.success("No significant discrepancies found across references.")

st.divider()
st.caption("VouchCall — AI-powered reference checking. Built with CALL-E.")
