import streamlit as st

from models import FollowUp
from call_service import CallService
from storage import load_follow_ups, save_follow_up, update_follow_up


st.set_page_config(
    page_title="CallFollowUp",
    page_icon="📞",
    layout="wide",
    initial_sidebar_state="collapsed",
)


# =========================
# Styling
# =========================

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

html, body, [class*="css"] {
    font-family: 'Inter', sans-serif;
}

.stApp {
    background:
        radial-gradient(circle at 10% 10%, rgba(244,114,182,.20), transparent 32%),
        radial-gradient(circle at 90% 15%, rgba(167,139,250,.22), transparent 34%),
        radial-gradient(circle at 50% 100%, rgba(236,72,153,.12), transparent 40%),
        linear-gradient(135deg, #fff1f8 0%, #f7f0ff 48%, #f1ecff 100%);
}

.block-container {
    max-width: 1100px;
    padding-top: 2rem;
    padding-bottom: 3rem;
}

.hero {
    padding: 2.4rem 2.5rem;
    border-radius: 28px;
    margin-bottom: 1.8rem;
    background: linear-gradient(
        135deg,
        rgba(255,255,255,.58),
        rgba(255,228,245,.42),
        rgba(237,233,254,.48)
    );
    border: 1px solid rgba(255,255,255,.75);
    box-shadow: 0 18px 45px rgba(126,34,106,.10);
    backdrop-filter: blur(14px);
}

.hero-title {
    font-size: 2.55rem;
    font-weight: 800;
    letter-spacing: -1.2px;
    margin-bottom: .45rem;
    background: linear-gradient(90deg,#be185d,#7c3aed);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.hero-subtitle {
    font-size: 1.05rem;
    line-height: 1.6;
    color: #6b5875;
}

.section-title {
    font-size: 1.35rem;
    font-weight: 750;
    color: #4a284f;
    margin-top: 1.8rem;
    margin-bottom: .9rem;
}

[data-testid="stMetric"] {
    padding: 1.25rem 1.35rem;
    border-radius: 20px;
    background: linear-gradient(
        135deg,
        rgba(255,255,255,.46),
        rgba(255,240,249,.30)
    );
    border: 1px solid rgba(255,255,255,.68);
    box-shadow: 0 10px 28px rgba(126,34,106,.08);
    backdrop-filter: blur(12px);
}

[data-testid="stMetricLabel"] {
    color: #725b78 !important;
    font-weight: 600 !important;
}

[data-testid="stMetricValue"] {
    color: #4a284f !important;
    font-weight: 800 !important;
}

[data-testid="stForm"] {
    padding: 1.5rem;
    border-radius: 22px;
    background: linear-gradient(
        135deg,
        rgba(255,255,255,.40),
        rgba(252,231,243,.28)
    );
    border: 1px solid rgba(255,255,255,.65);
    box-shadow: 0 12px 35px rgba(126,34,106,.07);
    backdrop-filter: blur(12px);
}

.stTextInput input,
.stTextArea textarea {
    border-radius: 13px !important;
    border: 1px solid rgba(190,24,93,.16) !important;
    background: rgba(255,255,255,.55) !important;
    color: #432a46 !important;
}

.stFormSubmitButton > button {
    width: 100%;
    min-height: 48px;
    border: none !important;
    border-radius: 14px !important;
    background: linear-gradient(90deg,#db2777,#9333ea) !important;
    color: white !important;
    font-weight: 700 !important;
    font-size: 1rem !important;
    box-shadow: 0 8px 20px rgba(147,51,234,.20);
}

.stButton > button {
    border-radius: 14px !important;
    font-weight: 700 !important;
}

[data-testid="stAlert"] {
    border-radius: 15px !important;
    backdrop-filter: blur(10px);
}

div[data-testid="stVerticalBlockBorderWrapper"] {
    border-radius: 18px !important;
    background: linear-gradient(
        135deg,
        rgba(255,255,255,.42),
        rgba(252,231,243,.25)
    ) !important;
    border: 1px solid rgba(255,255,255,.68) !important;
    box-shadow: 0 8px 24px rgba(126,34,106,.06);
    backdrop-filter: blur(10px);
    margin-bottom: .75rem;
}

.app-footer {
    text-align: center;
    color: #927f96;
    font-size: .88rem;
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(126,34,106,.10);
}
</style>
""", unsafe_allow_html=True)


# =========================
# Session state
# =========================

if "prepared_follow_up" not in st.session_state:
    st.session_state.prepared_follow_up = None

if "prepared_call" not in st.session_state:
    st.session_state.prepared_call = None


# =========================
# Hero
# =========================

st.markdown("""
<div class="hero">
    <div class="hero-title">📞 CallFollowUp</div>
    <div class="hero-subtitle">
        AI-powered business follow-ups that turn conversations into actionable next steps.
    </div>
</div>
""", unsafe_allow_html=True)


# =========================
# Metrics
# =========================

history = load_follow_ups()

completed_calls = sum(
    1 for item in history
    if item.get("status") in ["completed", "success"]
)

col1, col2 = st.columns(2)

with col1:
    st.metric(
        "📞 Calls",
        str(completed_calls),
        "Completed"
    )

with col2:
    st.metric(
        "✨ Status",
        "DRY RUN",
        "Safe mode"
    )

st.markdown("<br>", unsafe_allow_html=True)

st.metric(
    "📋 Follow-ups",
    str(len(history)),
    "Saved"
)


# =========================
# Create follow-up
# =========================

st.markdown(
    '<div class="section-title">Create a follow-up</div>',
    unsafe_allow_html=True
)

with st.form("follow_up_form"):

    contact_name = st.text_input(
        "Contact name",
        placeholder="e.g. Priya Sharma"
    )

    phone_number = st.text_input(
        "Phone number",
        placeholder="e.g. +91XXXXXXXXXX"
    )

    call_goal = st.text_area(
        "Call goal",
        placeholder="What should the AI accomplish during this follow-up?",
        height=130
    )

    submitted = st.form_submit_button(
        "📋 Prepare Call",
        use_container_width=True
    )


# =========================
# Prepare call
# =========================

if submitted:

    if (
        not contact_name.strip()
        or not phone_number.strip()
        or not call_goal.strip()
    ):

        st.warning("Please fill in all fields.")

    elif not phone_number.strip().startswith("+"):

        st.warning(
            "Please enter the phone number with country code, "
            "for example: +91XXXXXXXXXX"
        )

    else:

        follow_up = FollowUp(
            contact_name=contact_name.strip(),
            phone_number=phone_number.strip(),
            call_goal=call_goal.strip(),
        )

        service = CallService()
        prepared = service.prepare_call(follow_up)

        st.session_state.prepared_follow_up = follow_up
        st.session_state.prepared_call = prepared

        st.success("✓ Call prepared successfully — DRY RUN")

        st.markdown("### Call Preview")
        st.json(prepared)

        st.info(
            "📵 No phone call has been made. "
            "Your CALL-E credits are safe."
        )


# =========================
# Real call section
# =========================

if st.session_state.prepared_follow_up:

    st.markdown(
        '<div class="section-title">Ready for CALL-E?</div>',
        unsafe_allow_html=True
    )

    st.warning(
        "⚠️ This will make a real phone call and use one CALL-E credit."
    )

    confirm_real_call = st.checkbox(
        "I am ready to make a real CALL-E call"
    )

    if confirm_real_call:

        st.error(
            "📞 Real call enabled. "
            "Only continue if this is a number you control "
            "or have permission to call."
        )

        if st.button(
            "📞 Make Real CALL-E Call",
            use_container_width=True,
            type="primary",
        ):

            follow_up = st.session_state.prepared_follow_up

            try:
                service = CallService()

                with st.spinner("📞 CALL-E is starting the call..."):
                    call_response = service.create_call(follow_up)

                call_id = (
                    call_response.get("id")
                    or call_response.get("call_id")
                )

                if not call_id:
                    st.error("CALL-E did not return a call ID.")
                    st.json(call_response)
                    st.stop()

                follow_up.call_id = call_id
                follow_up.status = "calling"

                save_follow_up(follow_up)

                st.success(
                    f"📞 Call started successfully. Call ID: {call_id}"
                )

                with st.spinner(
                    "⏳ Waiting for the conversation to finish..."
                ):
                    try:
                        result = service.wait_for_result(call_id)

                    except Exception:
                        st.info(
                            "⏳ The waiting request timed out. "
                            "Checking CALL-E for the latest call status..."
                        )

                        result = service.get_call(call_id)

                        if not isinstance(result, dict):
                            st.error(
                                "❌ Could not retrieve the CALL-E call result."
                            )
                            st.stop()

                        if result.get("status") != "completed":
                            st.error(
                                "❌ CALL-E call did not complete. "
                                f"Status: {result.get('status')}"
                            )
                            st.json(result)
                            st.stop()

                st.success("✅ Call completed!")

                st.markdown("### 📋 CALL-E Result")
                st.json(result)

                if isinstance(result, dict):

                    result_data = result.get(
                        "structured_result",
                        result.get("result", result)
                    )

                    if isinstance(result_data, dict):

                        extracted = {
                            "outcome": result_data.get("outcome", ""),
                            "notes": result_data.get("notes", ""),
                            "next_action": result_data.get("next_action", ""),
                            "callback_at": result_data.get("callback_at", ""),
                        }

                        update_follow_up(
                            call_id,
                            extracted
                        )

                        st.markdown("### ✨ Follow-up Summary")

                        col1, col2 = st.columns(2)

                        with col1:
                            st.write(
                                "**Outcome:**",
                                extracted["outcome"]
                            )

                            st.write(
                                "**Next action:**",
                                extracted["next_action"]
                            )

                        with col2:
                            st.write(
                                "**Notes:**",
                                extracted["notes"]
                            )

                            st.write(
                                "**Callback:**",
                                extracted["callback_at"] or "None"
                            )

                        st.success(
                            "💾 Follow-up saved successfully."
                        )

                        st.session_state.prepared_follow_up = None
                        st.session_state.prepared_call = None

                        st.rerun()

                    else:
                        st.warning(
                            "The call completed, but CALL-E returned "
                            "an unexpected result format."
                        )

            except Exception as e:

                st.error(
                    f"❌ CALL-E call failed: {e}"
                )

# =========================
# Call History
# =========================

st.markdown(
    '<div class="section-title">Call History</div>',
    unsafe_allow_html=True
)

history = load_follow_ups()

if history:

    for item in reversed(history):

        with st.container(border=True):

            status = item.get("status", "pending").upper()

            st.markdown(
                f"**{item.get('contact_name', 'Unknown')}** — `{status}`"
            )

            st.write(
                f"📞 {item.get('phone_number', 'Not available')}"
            )

            st.write(
                f"🎯 {item.get('call_goal', 'Not available')}"
            )

            # Outcome
            st.write(
                f"✅ **Outcome:** "
                f"{item.get('outcome') or 'Not available yet'}"
            )

            # Notes
            st.write(
                f"📝 **Notes:** "
                f"{item.get('notes') or 'Not available yet'}"
            )

            # Next action
            st.write(
                f"➡️ **Next action:** "
                f"{item.get('next_action') or 'Not available yet'}"
            )

            # Callback
            st.write(
                f"📅 **Callback:** "
                f"{item.get('callback_at') or 'None'}"
            )

            # Transcript
            call_id = item.get("call_id")

            if call_id:

                if st.button(
                    "📄 View CALL-E Conversation",
                    key=f"transcript_{call_id}",
                    use_container_width=True,
                ):

                    try:

                        service = CallService()

                        with st.spinner(
                            "Loading CALL-E conversation..."
                        ):
                            call_data = service.get_call(call_id)

                        if not isinstance(call_data, dict):

                            st.error(
                                "Could not retrieve the CALL-E call."
                            )

                        else:

                            st.markdown("#### 📞 CALL-E Conversation")

                            st.write(
                                f"**Call status:** "
                                f"{call_data.get('status', 'Unknown').upper()}"
                            )

                            attempts = []

                            for recipient in call_data.get("recipients", []):
                                attempts.extend(recipient.get("attempts", []))

                            transcript = []

                            if attempts:

                                transcript = attempts[0].get(
                                    "transcript_turns",
                                    []
                                )

                            if transcript:

                                for turn in transcript:

                                    speaker = turn.get(
                                        "speaker",
                                        "unknown"
                                    )

                                    text = turn.get(
                                        "text",
                                        ""
                                    )

                                    if speaker == "bot":
                                        st.markdown(
                                            f"🤖 **CALL-E:** {text}"
                                        )

                                    else:
                                        st.markdown(
                                            f"👤 **Answering party:** {text}"
                                        )

                            else:

                                st.info(
                                    "No transcript was returned by CALL-E."
                                )

                    except Exception as e:

                        st.error(
                            f"Could not load conversation: {e}"
                        )

else:

    st.info("No follow-ups yet.")