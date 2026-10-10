from zoneinfo import ZoneInfo

import pandas as pd
import streamlit as st

from app import DRY_RUN, process_appointment

from models.appointment import AppointmentStatus
from services.calendar_service import (
    get_confirmcall_appointments,
    reset_demo_appointments,
)


DISPLAY_TIMEZONE = ZoneInfo("Africa/Lagos")


st.set_page_config(
    page_title="ConfirmCall",
    page_icon="☎️",
    layout="wide",
)

if "last_action" not in st.session_state:
    st.session_state["last_action"] = (
        "No dashboard action has been run in this session."
    )

if DRY_RUN:
    st.warning(
        "🟡 DEMO MODE — CALL-E outcomes are simulated. "
        "Google Calendar reads and writebacks are real."
    )
else:
    st.success(
        "🟢 LIVE MODE — ConfirmCall will place real CALL-E calls."
    )

st.title("☎️ ConfirmCall")
st.subheader("AI Appointment Confirmation Agent")

st.caption(
    f"Last action: {st.session_state['last_action']}"
)

st.info(
    "Google Calendar → CALL-E Voice Agent → "
    "Structured Decision → Calendar Writeback"
)

appointments = get_confirmcall_appointments(hours=48)


confirmed_count = sum(
    1
    for appointment in appointments
    if appointment.status == AppointmentStatus.CONFIRMED
)

cancelled_count = sum(
    1
    for appointment in appointments
    if appointment.status == AppointmentStatus.CANCELLED
)

needs_action_count = sum(
    1
    for appointment in appointments
    if appointment.status
    in {
        AppointmentStatus.RESCHEDULE_REQUESTED,
        AppointmentStatus.NEEDS_HUMAN,
        AppointmentStatus.NO_ANSWER,
    }
)

pending_count = sum(
    1
    for appointment in appointments
    if appointment.status == AppointmentStatus.PENDING
)

processed_count = (
    confirmed_count
    + cancelled_count
    + needs_action_count
)

# Demo estimate only.
AVERAGE_APPOINTMENT_VALUE = 100

estimated_revenue_protected = (
    confirmed_count * AVERAGE_APPOINTMENT_VALUE
)

confirmation_rate = (
    (confirmed_count / processed_count) * 100
    if processed_count
    else 0
)


col1, col2, col3, col4, col5 = st.columns(5)

col1.metric(
    "Appointments",
    len(appointments),
)

col2.metric(
    "Confirmed",
    confirmed_count,
)

col3.metric(
    "Cancelled",
    cancelled_count,
)

col4.metric(
    "Pending",
    pending_count,
)

col5.metric(
    "Needs Action",
    needs_action_count,
)

st.subheader("Business Impact")

impact1, impact2, impact3 = st.columns(3)

impact1.metric(
    "Appointments Protected",
    confirmed_count,
)

impact2.metric(
    "Estimated Revenue Protected",
    f"${estimated_revenue_protected:,}",
)

impact3.metric(
    "Confirmation Rate",
    f"{confirmation_rate:.0f}%",
)

st.caption(
    "Revenue protected is a demo estimate based on "
    f"${AVERAGE_APPOINTMENT_VALUE} average appointment value."
)

st.divider()

st.subheader("Upcoming Appointments")


STATUS_LABELS = {
    AppointmentStatus.PENDING: "⏳ Pending",
    AppointmentStatus.CONFIRMED: "✅ Confirmed",
    AppointmentStatus.CANCELLED: "❌ Cancelled",
    AppointmentStatus.RESCHEDULE_REQUESTED: "🟡 Reschedule Requested",
    AppointmentStatus.NO_ANSWER: "⚪ No Answer",
    AppointmentStatus.NEEDS_HUMAN: "🔴 Needs Human",
}


rows = []

for appointment in appointments:

    local_time = appointment.start_time.astimezone(
        DISPLAY_TIMEZONE
    )

    rows.append(
        {
            "Customer": appointment.customer_name,
            "Service": appointment.service_name,
            "Date": local_time.strftime("%b %d, %Y"),
            "Time": local_time.strftime("%I:%M %p"),
            "Status": STATUS_LABELS.get(
                appointment.status,
                appointment.status.value,
            ),
            "Requested Time": (
                appointment.requested_time
                or "-"
            ),
        }
    )


if rows:
    dataframe = pd.DataFrame(rows)

    st.dataframe(
        dataframe,
        width="stretch",
        hide_index=True,
    )

else:
    st.info(
        "No ConfirmCall appointments found "
        "in the next 48 hours."
    )

st.divider()

st.subheader("Automation Audit")

st.caption(
    "Call IDs provide traceability between appointment outcomes "
    "and the voice-agent execution that produced them."
)

audit_rows = []

for appointment in appointments:
    audit_rows.append(
        {
            "Customer": appointment.customer_name,
            "Service": appointment.service_name,
            "Status": appointment.status.value,
            "Requested Time": (
                appointment.requested_time or "-"
            ),
            "Call ID": (
                appointment.call_id or "-"
            ),
        }
    )

if audit_rows:
    audit_df = pd.DataFrame(audit_rows)

    st.dataframe(
        audit_df,
        width="stretch",
        hide_index=True,
    )    


st.divider()


left, right = st.columns(2)

with left:

    st.subheader("How It Works")

    st.write(
        "ConfirmCall reads upcoming Google Calendar appointments, "
        "processes customer confirmation outcomes, applies a structured "
        "decision, and writes the result back to Google Calendar."
    )


with right:

    st.subheader("Current Demo Status")

    st.write(
        "Google Calendar, the decision engine, writeback, "
        "and dashboard are live. CALL-E planning has been "
        "successfully validated with a supported US number. "
        "The final live phone call is pending recipient availability."
    )


st.divider()

st.subheader("Demo Controls")

st.write(
    "Reset the demo appointments to pending, then run "
    "ConfirmCall to process them."
)

reset_col, run_col = st.columns(2)


with reset_col:

    if st.button(
        "🔄 Reset Demo",
        width="stretch",
    ):

        with st.spinner(
            "Resetting demo appointments..."
        ):

            count = reset_demo_appointments()

        st.session_state["last_action"] = (
            f"Reset {count} demo appointment(s) to pending."
        )

        st.rerun()


with run_col:


    if st.button(
        "☎️ Run ConfirmCall",
        type="primary",
        width="stretch",
    ):

        pending = [
            appointment
            for appointment in appointments
            if appointment.status == AppointmentStatus.PENDING
        ]

        if not pending:

            st.info(
                "There are no pending appointments to process."
            )

        else:

            progress = st.progress(0)
            status_box = st.empty()

            total = len(pending)

            successful = 0
            failed = 0

            for index, appointment in enumerate(
                pending,
                start=1,
            ):

                status_box.info(
                    f"Processing "
                    f"{appointment.customer_name} — "
                    f"{appointment.service_name}"
                )

                result = process_appointment(
                    appointment
                )

                if result and result.get("success"):
                    successful += 1
                else:
                    failed += 1

                progress.progress(
                    index / total
                )

            if failed == 0:

                st.session_state["last_action"] = (
                    f"Processed {successful} appointment(s) "
                    "successfully."
                )

            else:

                st.session_state["last_action"] = (
                    f"Processed {successful} successfully. "
                    f"{failed} require human review."
                )

            st.rerun()