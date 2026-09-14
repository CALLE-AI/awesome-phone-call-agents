"""
dashboard.py
============
CallFollowUp - Streamlit dashboard.

Security & behaviour guarantees (Ray-56 review fixes)
------------------------------------------------------
Req 1  Preview is credential-free: CalleClient is never instantiated just to
       prepare or preview a call.
Req 2  Phone numbers must be exact E.164 before preview OR live call.
       Remote credential-bearing deployments require basic auth.
Req 3  No raw provider responses (st.json removed). Phone numbers are masked
       in history. Transcript text is sanitised. Generic error messages only.
Req 4  Mode (DRY RUN / LIVE) and terminal status are shown accurately.
Req 5  Ambiguous creation -> status UNKNOWN, workflow halts, no auto-retry.
Req 6  Closing the UI does not cancel an accepted call (shown in UI + README).
"""

import streamlit as st

from config import has_api_key, require_auth, APP_USERNAME, APP_PASSWORD
from models import FollowUp
from call_service import CallService, prepare_call, validate_e164
from storage import load_follow_ups, save_follow_up, update_follow_up


st.set_page_config(
    page_title="CallFollowUp",
    page_icon="📞",
    layout="wide",
    initial_sidebar_state="collapsed",
)


# =============================================================================
# Req 2 — Remote basic authentication
# =============================================================================
if require_auth():
    # Streamlit secrets take precedence over env vars; both are already loaded
    # by config.py via os.getenv.  Only show the login gate when auth is needed.
    if "authenticated" not in st.session_state:
        st.session_state.authenticated = False

    if not st.session_state.authenticated:
        st.title("🔒 CallFollowUp — Login Required")
        st.info(
            "This deployment carries live credentials and is accessible from "
            "a non-private network.  Please authenticate to continue."
        )
        with st.form("auth_form"):
            u = st.text_input("Username")
            p = st.text_input("Password", type="password")
            submitted = st.form_submit_button("Log in")

        if submitted:
            if u == APP_USERNAME and p == APP_PASSWORD:
                st.session_state.authenticated = True
                st.rerun()
            else:
                st.error("Invalid credentials.")

        st.stop()


# =============================================================================
# Styling (preserved from original)
# =============================================================================

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


# =============================================================================
# Session state
# =============================================================================

if "prepared_follow_up" not in st.session_state:
    st.session_state.prepared_follow_up = None

if "prepared_call" not in st.session_state:
    st.session_state.prepared_call = None


# =============================================================================
# Hero
# =============================================================================

st.markdown("""
<div class="hero">
    <div class="hero-title">📞 CallFollowUp</div>
    <div class="hero-subtitle">
        AI-powered business follow-ups that turn conversations into actionable next steps.
    </div>
</div>
""", unsafe_allow_html=True)


# =============================================================================
# Metrics (Req 4 — show actual mode)
# =============================================================================

history = load_follow_ups()

completed_calls = sum(
    1 for item in history
    if item.get("status") in {"completed", "success"}
)

# Determine actual mode label for the status metric.
_mode_label = "LIVE" if has_api_key() else "DRY RUN"
_mode_delta = "API key configured" if has_api_key() else "No API key — preview only"

col1, col2 = st.columns(2)

with col1:
    st.metric(
        "📞 Calls",
        str(completed_calls),
        "Completed"
    )

with col2:
    st.metric(
        "✨ Mode",
        _mode_label,
        _mode_delta,
    )

st.markdown("<br>", unsafe_allow_html=True)

st.metric(
    "📋 Follow-ups",
    str(len(history)),
    "Saved"
)


# =============================================================================
# Create follow-up form
# =============================================================================

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
        placeholder="E.164 format required, e.g. +91XXXXXXXXXX"
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


# =============================================================================
# Req 1 + Req 2 — Credential-free preview with strict E.164 validation
# =============================================================================

if submitted:

    if (
        not contact_name.strip()
        or not phone_number.strip()
        or not call_goal.strip()
    ):
        st.warning("Please fill in all fields.")

    elif not validate_e164(phone_number.strip()):
        st.warning(
            "📵 Invalid phone number format. "
            "Please use exact E.164 format: + followed by 1-15 digits, "
            "first digit after + cannot be 0. "
            "Example: +14155552671 or +919876543210. "
            "Spaces, hyphens, and parentheses are not accepted."
        )

    else:
        follow_up = FollowUp(
            contact_name=contact_name.strip(),
            phone_number=phone_number.strip(),
            call_goal=call_goal.strip(),
        )

        # Req 1: prepare_call() is a plain function — no CalleClient created.
        prepared = prepare_call(follow_up)

        st.session_state.prepared_follow_up = follow_up
        st.session_state.prepared_call = prepared

        st.success("✓ Call prepared successfully — DRY RUN (no call made, no credits used)")

        st.markdown("### Call Preview")

        # Show only safe preview fields — never raw provider data.
        col_a, col_b = st.columns(2)
        with col_a:
            st.write("**Contact:**", follow_up.contact_name)
            st.write("**Phone (masked):**", prepared["recipient_masked"])
        with col_b:
            st.write("**Mode:**", prepared["mode"].upper())
            st.write("**Status:**", "READY")

        st.write("**Goal:**", follow_up.call_goal)

        st.info(
            "📵 No phone call has been made. "
            "Your CALL-E credits are safe. "
            "Review the details above, then use the section below to start a live call."
        )


# =============================================================================
# Req 1 / Req 3 / Req 4 / Req 5 — Live CALL-E call section
# =============================================================================

if st.session_state.prepared_follow_up:

    st.markdown(
        '<div class="section-title">Ready for CALL-E?</div>',
        unsafe_allow_html=True
    )

    if not has_api_key():
        st.error(
            "⚙️ No CALLE_API_KEY found. "
            "Add your API key to .env or Streamlit Secrets to make live calls."
        )
        st.stop()

    st.warning(
        "⚠️ This will make a real phone call and use one CALL-E credit."
    )

    confirm_real_call = st.checkbox(
        "I am ready to make a real CALL-E call"
    )

    # Req 6 — closing notice shown alongside the confirm checkbox.
    st.caption(
        "ℹ️ Note: Closing, refreshing, or disconnecting from this UI does NOT cancel "
        "a call that has already been accepted by CALL-E. "
        "Accepted calls continue according to the CALL-E provider-side lifecycle."
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

            # Final E.164 guard before live call (Req 2).
            if not validate_e164(follow_up.phone_number):
                st.error(
                    "❌ The stored phone number is not valid E.164. "
                    "Please restart and re-enter the number."
                )
                st.stop()

            try:
                # Req 1 — CalleClient is only created here, at live-call time.
                service = CallService()
            except RuntimeError as e:
                st.error(f"⚙️ Configuration error: {e}")
                st.stop()

            # =================================================================
            # Req 4 — Show CREATING status while submitting.
            # =================================================================
            with st.spinner("📞 CALL-E is submitting the call... (CREATING)"):
                call_response = service.create_call(follow_up)

            # =================================================================
            # Req 5 — UNKNOWN on ambiguous creation.
            # =================================================================
            if call_response.get("status") == "UNKNOWN":
                st.error(
                    "⚠️ **UNKNOWN — Ambiguous call creation**\n\n"
                    + call_response.get("error", "The call outcome is unknown.")
                    + "\n\n"
                    "**Do not retry.** The call may have already been accepted "
                    "by the provider. Please check your CALL-E dashboard to "
                    "confirm whether a call was created before attempting again."
                )
                # Record the UNKNOWN state in history so the user can track it.
                follow_up.status = "unknown"
                save_follow_up(follow_up)
                st.stop()

            call_id = call_response.get("id")

            if not call_id:
                # Defensive: create_call should always return id or UNKNOWN,
                # but handle this path safely.
                st.error(
                    "❌ The provider did not return a call ID. "
                    "The call outcome is unknown. "
                    "Check your CALL-E dashboard before retrying."
                )
                follow_up.status = "unknown"
                save_follow_up(follow_up)
                st.stop()

            # Definitive acceptance — start tracking the call.
            follow_up.call_id = call_id
            follow_up.status = "calling"
            save_follow_up(follow_up)

            # Req 4 — Show CALLING status.
            st.success("📞 Call accepted by CALL-E. Status: CALLING")

            with st.spinner(
                "⏳ Waiting for the conversation to finish... (CALLING)"
            ):
                result = service.wait_for_result(call_id)

            terminal_status = result.get("status", "UNKNOWN").upper()

            # =================================================================
            # Req 4 + Req 5 — Show real terminal status; handle UNKNOWN.
            # =================================================================
            if terminal_status == "UNKNOWN":
                st.warning(
                    "⏳ **UNKNOWN — Call status could not be confirmed**\n\n"
                    "The call was accepted but its final status could not be "
                    "retrieved (e.g. the poll timed out). "
                    "Check your CALL-E dashboard for the real outcome. "
                    "The record has been saved with status UNKNOWN."
                )
                update_follow_up(call_id, result)
                st.stop()

            elif terminal_status in {"FAILED", "CANCELLED", "CANCELED"}:
                st.error(
                    f"❌ Call ended with status: **{terminal_status}**. "
                    "No follow-up data was captured."
                )
                update_follow_up(call_id, result)
                st.stop()

            # Req 4 — Confirmed COMPLETED.
            st.success(f"✅ Call completed! Status: {terminal_status}")

            # =================================================================
            # Req 3 — Never display raw provider result. Show safe fields only.
            # =================================================================
            extracted = {
                "outcome": result.get("outcome", ""),
                "notes": result.get("notes", ""),
                "next_action": result.get("next_action", ""),
                "callback_at": result.get("callback_at", ""),
            }

            update_follow_up(call_id, result)

            st.markdown("### ✨ Follow-up Summary")

            col1, col2 = st.columns(2)

            with col1:
                st.write("**Outcome:**", extracted["outcome"] or "—")
                st.write("**Next action:**", extracted["next_action"] or "—")

            with col2:
                st.write("**Notes:**", extracted["notes"] or "—")
                st.write("**Callback:**", extracted["callback_at"] or "None")

            st.success("💾 Follow-up saved successfully.")

            st.session_state.prepared_follow_up = None
            st.session_state.prepared_call = None

            st.rerun()


# =============================================================================
# Req 3 / Req 4 — Call History (masked phones, masked transcript, real status)
# =============================================================================

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

            # Req 3 — phone_number in storage is already masked.
            st.write(
                f"📞 {item.get('phone_number', 'Not available')}"
            )

            st.write(
                f"🎯 {item.get('call_goal', 'Not available')}"
            )

            st.write(
                f"✅ **Outcome:** "
                f"{item.get('outcome') or 'Not available yet'}"
            )

            st.write(
                f"📝 **Notes:** "
                f"{item.get('notes') or 'Not available yet'}"
            )

            st.write(
                f"➡️ **Next action:** "
                f"{item.get('next_action') or 'Not available yet'}"
            )

            st.write(
                f"📅 **Callback:** "
                f"{item.get('callback_at') or 'None'}"
            )

            # Transcript viewer — only for records that have a call_id.
            call_id = item.get("call_id")

            if call_id:

                if st.button(
                    "📄 View CALL-E Conversation",
                    key=f"transcript_{call_id}",
                    use_container_width=True,
                ):

                    try:
                        service = CallService()
                    except RuntimeError:
                        st.error(
                            "⚙️ CALLE_API_KEY is not configured. "
                            "Cannot fetch transcript."
                        )
                        continue

                    with st.spinner("Loading CALL-E conversation..."):
                        # get_transcript() returns sanitised turns.
                        transcript = service.get_transcript(call_id)

                    if not transcript:
                        st.info("No transcript was returned by CALL-E.")
                    else:
                        st.markdown("#### 📞 CALL-E Conversation")

                        for turn in transcript:
                            speaker = turn.get("speaker", "unknown")
                            text = turn.get("text", "")

                            if speaker == "bot":
                                st.markdown(f"🤖 **CALL-E:** {text}")
                            else:
                                st.markdown(f"👤 **Answering party:** {text}")

else:

    st.info("No follow-ups yet.")


# =============================================================================
# Footer
# =============================================================================

st.markdown(
    '<div class="app-footer">CallFollowUp · Built for the CALL-E Hackathon</div>',
    unsafe_allow_html=True,
)
