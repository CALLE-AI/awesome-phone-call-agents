import os
import time
import streamlit as st

from calle_service import discover_job_from_business, USE_MOCK_CALLS
from safety import can_call_business, mask_phone_number
from result_validator import validate_job_result
from matching import calculate_match_score
from follow_up import can_follow_up_with_employer
from call_manager import (
    create_call_record,
    mark_call_started,
    mark_call_completed,
    mark_outcome_unknown,
    should_retry_call,
)
from database import (
    init_db,
    save_discovered_job,
    save_interest,
    save_call_record,
    get_call_logs,
    get_discovered_jobs,
    save_profile_sharing_consent,
    get_profile_sharing_consent,
    save_employer_followup,
    get_employer_followup,
    get_employer_followups,
    reset_demo_data,
)


st.set_page_config(
    page_title="JobRadar Voice",
    page_icon="📞",
    layout="centered",
)


st.markdown(
    """
    <style>
        .block-container {
            padding-top: 1.6rem;
            padding-bottom: 3rem;
            max-width: 960px;
        }

        .jr-hero {
            padding: 1.5rem 1.6rem;
            border: 1px solid rgba(128, 128, 128, 0.24);
            border-radius: 18px;
            margin-bottom: 1rem;
        }

        .jr-eyebrow {
            font-size: 0.78rem;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            opacity: 0.65;
            margin-bottom: 0.35rem;
        }

        .jr-title {
            font-size: 2.25rem;
            font-weight: 850;
            line-height: 1.12;
            margin-bottom: 0.5rem;
        }

        .jr-subtitle {
            font-size: 1.02rem;
            opacity: 0.82;
            margin: 0;
        }

        .jr-step {
            padding: 0.9rem 0.95rem;
            border: 1px solid rgba(128, 128, 128, 0.22);
            border-radius: 12px;
            min-height: 92px;
        }

        .jr-step-number {
            font-size: 0.74rem;
            font-weight: 800;
            opacity: 0.6;
        }

        .jr-step-title {
            font-size: 0.98rem;
            font-weight: 750;
            margin-top: 0.3rem;
        }

        .jr-note {
            padding: 0.85rem 1rem;
            border: 1px solid rgba(128, 128, 128, 0.22);
            border-radius: 12px;
            margin: 0.8rem 0 1.1rem 0;
        }
    </style>
    """,
    unsafe_allow_html=True,
)


init_db()

for key, default in {
    "interested_jobs": [],
    "discovered_results": [],
    "call_records": {},
    "consent_jobs": {},
    "employer_followups": {},
    "profile_ready": False,
}.items():
    if key not in st.session_state:
        st.session_state[key] = default


def show_call_status(status: str):
    if status == "completed":
        st.success("✅ Completed")
    elif status == "outcome_unknown":
        st.error("⚠️ Outcome Unknown — Retry Blocked")
    elif status == "in_progress":
        st.warning("📞 In Progress")
    else:
        st.info("🕓 Prepared")


def show_salary(salary_min, salary_max):
    if salary_min is None and salary_max is None:
        return "Not confirmed"

    if salary_min is None:
        return f"Up to ₹{salary_max:,.0f}"

    if salary_max is None:
        return f"From ₹{salary_min:,.0f}"

    if salary_min == salary_max:
        return f"₹{salary_min:,.0f}"

    return f"₹{salary_min:,.0f} – ₹{salary_max:,.0f}"


def reset_session_state():
    reset_demo_data()

    # Product / workflow state
    st.session_state.interested_jobs = []
    st.session_state.discovered_results = []
    st.session_state.call_records = {}
    st.session_state.consent_jobs = {}
    st.session_state.employer_followups = {}
    st.session_state.profile_ready = False

    # Candidate form state
    st.session_state.candidate_name = ""
    st.session_state.candidate_location = ""
    st.session_state.preferred_role_input = "Warehouse Assistant"
    st.session_state.skills_input = ""
    st.session_state.expected_salary_input = 15000
    st.session_state.shift_input = "Day"
    st.session_state.travel_distance_input = 10


mode_label = "DEMO MODE" if USE_MOCK_CALLS else "LIVE CALL-E MODE"
mode_icon = "🧪" if USE_MOCK_CALLS else "📞"


with st.sidebar:
    st.subheader("JobRadar Controls")

    st.write(f"**{mode_icon} {mode_label}**")

    if USE_MOCK_CALLS:
        st.caption("Safe local simulation. No CALL-E phone credits are used.")
    else:
        st.warning(
            "Live mode can place a real phone call and consume CALL-E credits."
        )

    st.divider()

    st.caption(
        "Reset clears the current search, form fields, jobs, matches, consent, "
        "follow-up records, and local call history."
    )

    if st.button("Reset Search", use_container_width=True):
        reset_session_state()
        st.success("Search reset.")
        st.rerun()


st.markdown(
    """
    <div class="jr-hero">
        <div class="jr-eyebrow">AI-Powered Local Job Discovery</div>
        <div class="jr-title">📞 JobRadar Voice</div>
        <p class="jr-subtitle">
            Find local job opportunities that may never appear on traditional
            job portals by calling approved businesses and converting verified
            conversations into structured job matches.
        </p>
    </div>
    """,
    unsafe_allow_html=True,
)


step1, step2, step3 = st.columns(3)

with step1:
    st.markdown(
        """
        <div class="jr-step">
            <div class="jr-step-number">STEP 1</div>
            <div class="jr-step-title">👤 Create Profile</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

with step2:
    st.markdown(
        """
        <div class="jr-step">
            <div class="jr-step-number">STEP 2</div>
            <div class="jr-step-title">📞 Discover Hidden Jobs</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

with step3:
    st.markdown(
        """
        <div class="jr-step">
            <div class="jr-step-number">STEP 3</div>
            <div class="jr-step-title">🎯 Match & Follow Up</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


if USE_MOCK_CALLS:
    st.info(
        "🧪 Demo mode is active — responses are simulated locally. "
        "No real phone call will be placed."
    )
else:
    st.warning(
        "📞 Live CALL-E mode is active — use only an authorized test number. "
        "Running the call may consume credits."
    )

st.caption(
    "Safety by design: approved businesses only • AI disclosure • masked phone "
    "numbers • retry protection • no automatic candidate profile sharing"
)


with st.expander("Why this product matters"):
    st.write(
        "Many local employers hire through walk-ins, referrals, and phone calls "
        "instead of publishing every opening online. JobRadar Voice turns that "
        "offline hiring signal into a structured, consent-aware job discovery flow."
    )
    st.write(
        "**Product loop:** Candidate intent → approved business outreach → "
        "verified hiring signal → match score → candidate consent → employer follow-up."
    )


st.subheader("1. Create Your Job Profile")

# Defaults are initialized once so Reset Search can clear/reseed them safely.
for key, default in {
    "candidate_name": "",
    "candidate_location": "",
    "preferred_role_input": "Warehouse Assistant",
    "skills_input": "",
    "expected_salary_input": 15000,
    "shift_input": "Day",
    "travel_distance_input": 10,
}.items():
    if key not in st.session_state:
        st.session_state[key] = default

name = st.text_input("Your Name", key="candidate_name", placeholder="Example: Adil")

location = st.text_input(
    "Your Location",
    key="candidate_location",
    placeholder="Example: Vadodara",
)

preferred_role = st.selectbox(
    "Preferred Job Role",
    [
        "Warehouse Assistant",
        "Retail Associate",
        "Reception / Office Assistant",
    ],
    key="preferred_role_input",
)

skills = st.text_input(
    "Your Skills",
    key="skills_input",
    placeholder="Example: Packing, Inventory, Excel",
)

expected_salary = st.number_input(
    "Minimum Expected Monthly Salary",
    min_value=0,
    step=1000,
    key="expected_salary_input",
)

shift = st.selectbox(
    "Preferred Shift",
    ["Day", "Night", "Any"],
    key="shift_input",
)

travel_distance = st.slider(
    "Maximum Travel Distance",
    min_value=1,
    max_value=30,
    key="travel_distance_input",
)

if st.button("Find Hidden Jobs", use_container_width=True):
    if not name.strip() or not location.strip():
        st.warning("Please enter your name and location.")
    else:
        # Start a fresh visible search journey.
        # Results are intentionally hidden until the AI call completes.
        st.session_state.profile_ready = True
        st.session_state.discovered_results = []
        st.session_state.call_records = {}
        st.success("Search profile ready.")
        st.write(
            f"Looking for **{preferred_role}** opportunities around "
            f"**{location}** within **{travel_distance} km**."
        )


st.divider()
st.subheader("2. Relevant Approved Employers")


# Keep real phone numbers out of source code.
# In live mode set JOBRADAR_TEST_PHONE in .env, for example:
# JOBRADAR_TEST_PHONE=+91XXXXXXXXXX
live_test_phone = os.getenv("JOBRADAR_TEST_PHONE", "").strip()

if USE_MOCK_CALLS:
    business_phone = "+910000000001"
    business_location = "Test Location"
else:
    business_phone = live_test_phone
    business_location = "Authorized Test Location"


businesses = [
    {
        "name": "Metro Warehouse",
        "category": "Logistics",
        "location": business_location,
        "phone": business_phone,
        "authorized": True,
        "do_not_call": False,
    }
]


if not USE_MOCK_CALLS and not live_test_phone:
    st.error(
        "Live mode is active, but JOBRADAR_TEST_PHONE is missing from .env. "
        "No live call can be placed until an authorized E.164 test number is configured."
    )


# IMPORTANT:
# Do not restore old completed calls into the active search session.
# A new Find Hidden Jobs action starts a fresh call session.
# SQLite history remains available only in the Technical Audit section.


for business in businesses:
    with st.container(border=True):
        left, right = st.columns([3, 1])

        with left:
            st.write(f"### {business['name']}")
            st.caption(
                f"{business['category']} • {business['location']}"
            )

        with right:
            if business["phone"]:
                st.caption(mask_phone_number(business["phone"]))
            else:
                st.caption("Phone not configured")

        allowed, reason = can_call_business(business)

        if allowed:
            st.success("Approved for outreach")
        else:
            st.warning(reason)


prepare_disabled = bool(
    (not st.session_state.profile_ready)
    or (not USE_MOCK_CALLS and not live_test_phone)
)

if not st.session_state.profile_ready:
    st.info("Fill your profile and click Find Hidden Jobs. Then you can call approved employers with AI.")

st.divider()
st.subheader("3. AI Employer Call")

if USE_MOCK_CALLS:
    st.caption(
        "Demo mode: the call flow is simulated and no CALL-E credits are used."
    )
else:
    st.caption(
        "Live mode: clicking the button below places one real CALL-E call "
        "to the authorized test employer."
    )

run_label = (
    "Call Employers With AI — Demo"
    if USE_MOCK_CALLS
    else "Call Employer With CALL-E"
)
if not USE_MOCK_CALLS:
    st.warning(
        "Live CALL-E mode is active. Verification will place one real authorized test call."
    )

if st.button(
    run_label,
    use_container_width=True,
    disabled=prepare_disabled,
):
    for business in businesses:
        allowed, reason = can_call_business(business)

        if not allowed:
            st.warning(f"{business['name']} skipped: {reason}")
            continue

        if business["name"] not in st.session_state.call_records:
            st.session_state.call_records[business["name"]] = (
                create_call_record(business)
            )
            save_call_record(
                st.session_state.call_records[business["name"]]
            )

        call_record = st.session_state.call_records[business["name"]]
        can_retry, retry_reason = should_retry_call(call_record)

        if not can_retry:
            if (
                USE_MOCK_CALLS
                and call_record.get("status") == "completed"
            ):
                already_loaded = any(
                    existing.get("business_name") == business["name"]
                    for existing in st.session_state.discovered_results
                )

                if not already_loaded:
                    restored_result = discover_job_from_business(
                        business_name=business["name"],
                        phone_number=business["phone"],
                        candidate_role=preferred_role,
                    )
                    restored_result["_business_meta"] = business
                    restored_result["_call_record"] = call_record
                    st.session_state.discovered_results.append(
                        restored_result
                    )

                st.info(
                    f"{business['name']}: previous completed demo result loaded."
                )
                continue

            st.info(
                f"{business['name']} not called again: {retry_reason}"
            )

            if not USE_MOCK_CALLS and call_record.get("status") == "completed":
                st.caption(
                    "This employer was already called in the current search. "
                    "Click Find Hidden Jobs again to start a fresh search session."
                )
            continue

        call_record = mark_call_started(call_record)
        st.session_state.call_records[business["name"]] = call_record
        save_call_record(call_record)

        call_progress = st.empty()

        if USE_MOCK_CALLS:
            call_progress.info(
                f"🧪 Simulating AI call to {business['name']}..."
            )
        else:
            call_progress.warning(
                f"📞 CALL-E is calling {business['name']}..."
            )

        time.sleep(0.4)
        call_progress.info("🤖 AI introduction → asking permission to continue")
        time.sleep(0.4)
        call_progress.info("🔎 Checking current hiring status and job details")
        time.sleep(0.4)

        try:
            result = discover_job_from_business(
                business_name=business["name"],
                phone_number=business["phone"],
                candidate_role=preferred_role,
            )

            call_progress.success(
                f"✅ AI call completed for {business['name']}. "
                "Hiring information received — verified details are now shown below."
            )

        except Exception as error:
            call_record = mark_outcome_unknown(call_record)
            st.session_state.call_records[business["name"]] = call_record
            save_call_record(call_record)

            st.error(
                f"{business['name']} call outcome is unknown. "
                "Automatic retry has been blocked."
            )
            st.caption(str(error))
            continue

        is_valid, validation_errors = validate_job_result(result)

        if not is_valid:
            call_record = mark_outcome_unknown(call_record)
            st.session_state.call_records[business["name"]] = call_record
            save_call_record(call_record)

            st.error(
                f"Invalid call result for {business['name']}: "
                f"{', '.join(validation_errors)}"
            )
            continue

        call_record = mark_call_completed(call_record)
        st.session_state.call_records[business["name"]] = call_record
        save_call_record(call_record)

        result["_business_meta"] = business
        result["_call_record"] = call_record

        already_added = any(
            existing.get("business_name") == result.get("business_name")
            for existing in st.session_state.discovered_results
        )

        if not already_added:
            st.session_state.discovered_results.append(result)

        save_discovered_job(result)


if st.session_state.discovered_results:
    st.divider()
    st.subheader("4. Verified Hiring Signals")

    total_calls = len(st.session_state.discovered_results)

    hiring_now_count = sum(
        1
        for result in st.session_state.discovered_results
        if result.get("hiring_status") == "hiring_now"
    )

    hiring_soon_count = sum(
        1
        for result in st.session_state.discovered_results
        if result.get("hiring_status") == "hiring_soon"
    )

    active_openings = sum(
        result.get("number_of_openings") or 0
        for result in st.session_state.discovered_results
        if result.get("hiring_status")
        in {"hiring_now", "hiring_soon"}
    )

    metric1, metric2, metric3, metric4 = st.columns(4)

    metric1.metric("Businesses Checked", total_calls)
    metric2.metric("Hiring Now", hiring_now_count)
    metric3.metric("Hiring Soon", hiring_soon_count)
    metric4.metric("Openings Found", active_openings)

    for result in st.session_state.discovered_results:
        required_skills = result.get("skills_required", [])
        hiring_status = result.get("hiring_status", "unclear")
        job_title = result.get("job_title")
        salary_min = result.get("salary_min")
        salary_max = result.get("salary_max")

        with st.container(border=True):
            business_name = result.get(
                "business_name",
                "Business",
            )

            if hiring_status == "hiring_now":
                status_label = "🟢 Hiring Now"
            elif hiring_status == "hiring_soon":
                status_label = "🟡 Hiring Soon"
            elif hiring_status == "not_hiring":
                status_label = "⚪ Not Hiring"
            else:
                status_label = "⚠️ Unclear"

            st.write(f"### {business_name}")
            st.write(f"**{status_label}**")

            if job_title:
                c1, c2 = st.columns(2)

                with c1:
                    st.write(f"**Role:** {job_title}")
                    st.write(
                        f"**Openings:** "
                        f"{result.get('number_of_openings') or 'Not confirmed'}"
                    )
                    st.write(
                        f"**Salary:** "
                        f"{show_salary(salary_min, salary_max)}"
                    )

                with c2:
                    st.write(
                        f"**Shift:** "
                        f"{result.get('shift') or 'Not confirmed'}"
                    )
                    st.write(
                        "**Skills:** "
                        + (
                            ", ".join(required_skills)
                            if required_skills
                            else "Not confirmed"
                        )
                    )
                    st.write(
                        f"**Joining:** "
                        f"{result.get('joining_timeline') or 'Not confirmed'}"
                    )
            else:
                st.caption(
                    result.get(
                        "call_summary",
                        "No active role was confirmed.",
                    )
                )

            verification_status = result.get(
                "verification_status",
                "unverified",
            )

            st.write(
                f"**Verification:** {verification_status}"
            )

            if verification_status == "verified":
                st.success("Verified from the call result.")
            elif verification_status == "partially_verified":
                st.warning(
                    "Some job details are still missing and were not invented."
                )

            with st.expander("View call evidence & safety details"):
                permission = result.get("permission_to_continue")

                if permission is True:
                    permission_text = "Yes"
                elif permission is False:
                    permission_text = "No"
                else:
                    permission_text = "Unclear"

                st.write(
                    "**Permission to Continue:**",
                    permission_text,
                )
                st.write(
                    "**Candidate Referrals Allowed:**",
                    result.get(
                        "candidate_referrals_allowed",
                        "unclear",
                    ),
                )
                st.write(
                    "**Future Follow-up Allowed:**",
                    "Yes"
                    if result.get("future_follow_up_allowed")
                    else "No",
                )
                st.write(
                    "**Follow-up Required:**",
                    "Yes"
                    if result.get("follow_up_required")
                    else "No",
                )

                missing_information = result.get(
                    "missing_information",
                    [],
                )

                st.write(
                    "**Missing Information:**",
                    ", ".join(missing_information)
                    if missing_information
                    else "None",
                )

                st.write(
                    "**AI Call Summary:**",
                    result.get(
                        "call_summary",
                        "No call summary available.",
                    ),
                )

                transcript = result.get("call_transcript", [])
                if transcript:
                    st.markdown("**Full Live Call Transcript**")
                    for turn in transcript:
                        speaker = str(turn.get("speaker", "unknown")).lower()
                        label = "🤖 JobRadar AI" if speaker in {"bot", "assistant", "agent", "ai"} else "👤 Employer"
                        st.write(f"**{label}:** {turn.get('text', '')}")
                else:
                    st.caption("No live transcript was returned by CALL-E for this call.")

                call_record = result.get("_call_record", {})

                if call_record:
                    st.write(
                        "**Call Status:**",
                        call_record.get("status", "unknown"),
                    )
                    st.write(
                        "**Call Attempts:**",
                        call_record.get("attempt", 0),
                    )


    st.divider()
    st.subheader("5. Best Matches for You")

    candidate_skills = {
        skill.strip().lower()
        for skill in skills.split(",")
        if skill.strip()
    }

    matchable_results = [
        result
        for result in st.session_state.discovered_results
        if result.get("permission_to_continue") is True
        and result.get("hiring_status")
        in {"hiring_now", "hiring_soon"}
        and result.get("job_title")
    ]

    scored_results = []

    for result in matchable_results:
        score, reasons, match_label = calculate_match_score(
            result=result,
            preferred_role=preferred_role,
            candidate_skills=candidate_skills,
            expected_salary=expected_salary,
            preferred_shift=shift,
        )

        scored_results.append(
            (score, reasons, match_label, result)
        )

    scored_results.sort(
        key=lambda item: item[0],
        reverse=True,
    )

    if not scored_results:
        st.info(
            "No active or upcoming verified job matches found."
        )

    for score, reasons, match_label, result in scored_results:
        business = result.get("_business_meta", {})
        job_title = result.get("job_title")
        salary_min = result.get("salary_min")
        salary_max = result.get("salary_max")
        job_shift = result.get("shift")
        result_skills = result.get("skills_required", [])

        business_name = result.get(
            "business_name",
            business.get("name", "Unknown Business"),
        )

        with st.container(border=True):
            top_left, top_right = st.columns([3, 1])

            with top_left:
                st.write(
                    f"### {job_title or 'Job details not confirmed'}"
                )
                st.caption(business_name)

            with top_right:
                st.metric("Match", f"{score}%")

            st.write(f"**{match_label}**")
            st.write(
                f"**Salary:** {show_salary(salary_min, salary_max)}"
            )
            st.write(
                f"**Shift:** {job_shift or 'Not confirmed'}"
            )
            st.write(
                "**Required Skills:** "
                + (
                    ", ".join(result_skills)
                    if result_skills
                    else "Not confirmed"
                )
            )

            st.write("**Why it matches**")

            if reasons:
                for reason in reasons:
                    st.write(f"✅ {reason}")
            else:
                st.write("No strong match reason found.")

            job_key = (
                f"{business_name} - "
                f"{job_title or 'Unconfirmed Role'}"
            )

            if st.button(
                f"I'm Interested — {business_name}",
                key=f"interest_{business_name}",
                use_container_width=True,
            ):
                if job_key not in st.session_state.interested_jobs:
                    st.session_state.interested_jobs.append(job_key)

                save_interest(
                    name,
                    business_name,
                    job_title or "Unconfirmed Role",
                )

                st.session_state.consent_jobs[job_key] = True
                st.success(
                    "Saved. Your profile will not be shared until you explicitly approve it."
                )

            if st.session_state.consent_jobs.get(job_key):
                st.warning(
                    "Before any employer follow-up, choose whether "
                    "JobRadar may share your profile for this opportunity."
                )

                consent = st.radio(
                    "Share your profile with this employer?",
                    [
                        "Not decided",
                        "Yes, share my profile",
                        "No, do not share",
                    ],
                    key=f"consent_{business_name}",
                )

                if st.button(
                    f"Confirm Profile-Sharing Choice",
                    key=f"confirm_consent_{business_name}",
                    use_container_width=True,
                ):
                    if consent == "Not decided":
                        st.warning(
                            "Please choose Yes or No before confirming."
                        )
                    elif consent == "Yes, share my profile":
                        save_profile_sharing_consent(
                            name,
                            business_name,
                            job_title or "Unconfirmed Role",
                            "approved",
                        )
                        st.success(
                            "Profile sharing approved."
                        )
                    else:
                        save_profile_sharing_consent(
                            name,
                            business_name,
                            job_title or "Unconfirmed Role",
                            "declined",
                        )
                        st.info(
                            "Profile will not be shared with this employer."
                        )

                saved_consent = get_profile_sharing_consent(
                    name,
                    business_name,
                    job_title or "Unconfirmed Role",
                )

                if saved_consent == "approved":
                    st.success(
                        "✅ Candidate consent: Approved for profile sharing"
                    )
                elif saved_consent == "declined":
                    st.info(
                        "🔒 Candidate consent: Profile sharing declined"
                    )
                else:
                    st.caption(
                        "Candidate consent: Pending"
                    )

                follow_up_allowed, follow_up_reason = (
                    can_follow_up_with_employer(
                        job_result=result,
                        candidate_consent=saved_consent,
                    )
                )

                if follow_up_allowed:
                    st.success(
                        "📞 Employer follow-up: Eligible"
                    )

                    followup_key = (
                        f"{business_name} - "
                        f"{job_title or 'Unconfirmed Role'}"
                    )

                    if st.button(
                        f"Record Demo Follow-Up — {business_name}",
                        key=f"contact_employer_{business_name}",
                        use_container_width=True,
                    ):
                        followup_status = "completed"

                        st.session_state.employer_followups[
                            followup_key
                        ] = {
                            "status": followup_status,
                            "business_name": business_name,
                            "job_title": (
                                job_title
                                or "Unconfirmed Role"
                            ),
                        }

                        save_employer_followup(
                            candidate_name=name,
                            business_name=business_name,
                            job_title=(
                                job_title
                                or "Unconfirmed Role"
                            ),
                            status=followup_status,
                        )

                    saved_followup_status = get_employer_followup(
                        candidate_name=name,
                        business_name=business_name,
                        job_title=(
                            job_title
                            or "Unconfirmed Role"
                        ),
                    )

                    if saved_followup_status:
                        st.session_state.employer_followups[
                            followup_key
                        ] = {
                            "status": saved_followup_status,
                            "business_name": business_name,
                            "job_title": (
                                job_title
                                or "Unconfirmed Role"
                            ),
                        }

                    followup_record = (
                        st.session_state.employer_followups.get(
                            followup_key
                        )
                    )

                    if followup_record:
                        st.success(
                            "✅ Follow-up action saved."
                        )

                else:
                    st.caption(
                        f"Employer follow-up: Blocked — "
                        f"{follow_up_reason}"
                    )

else:
    if st.session_state.profile_ready:
        if USE_MOCK_CALLS:
            st.info(
                "Click “Call Employers With AI — Demo” to generate hiring results."
            )
        else:
            st.info(
                "Click “Call Employer With CALL-E” to place the authorized call. "
                "Hiring details will appear only after the call result is received."
            )


if st.session_state.interested_jobs:
    st.divider()
    st.subheader("6. Your Selected Opportunities")

    for job in st.session_state.interested_jobs:
        st.write(f"✅ {job}")


st.divider()

with st.expander("Technical Audit & Safety Details"):
    st.caption(
        "Reviewer/debug view: persisted call state, retry protection, "
        "saved follow-ups, and stored job records."
    )

    st.write(
        "**Safety controls:** authorized outreach, phone masking, "
        "explicit candidate consent, retry blocking after unknown outcomes, "
        "and no invented missing job information."
    )

    saved_followups = get_employer_followups()

    if saved_followups:
        st.write("### Employer Follow-Up Actions")

        for followup in saved_followups:
            with st.container(border=True):
                st.write(
                    f"**Candidate:** {followup[0] or 'Unknown'}"
                )
                st.write(
                    f"**Business:** {followup[1]}"
                )
                st.write(
                    f"**Role:** {followup[2]}"
                )
                st.write(
                    f"**Status:** {followup[3]}"
                )

    if st.session_state.call_records:
        st.write("### Call Execution Status")

        for business_name, call_record in (
            st.session_state.call_records.items()
        ):
            with st.container(border=True):
                st.write(
                    f"**Business:** {business_name}"
                )
                show_call_status(
                    call_record.get("status", "prepared")
                )
                st.write(
                    f"**Attempts:** "
                    f"{call_record.get('attempt', 0)}"
                )
                st.write(
                    f"**Phone:** "
                    f"{call_record.get('masked_phone', 'Unknown')}"
                )

                can_retry, retry_reason = should_retry_call(
                    call_record
                )

                st.write(
                    "**Automatic Retry:** "
                    + (
                        "Allowed"
                        if can_retry
                        else "Blocked"
                    )
                )
                st.caption(retry_reason)

    saved_call_logs = get_call_logs()

    if saved_call_logs:
        st.write("### Persisted Call History")

        for log in saved_call_logs:
            with st.container(border=True):
                st.write(
                    f"**Business:** {log[0]}"
                )
                st.write(
                    f"**Phone:** {log[1] or 'Unknown'}"
                )
                show_call_status(
                    log[2] or "prepared"
                )
                st.write(
                    f"**Attempts:** {log[3] or 0}"
                )
                st.write(
                    f"**Outcome:** "
                    f"{log[4] or 'No additional outcome recorded'}"
                )

    saved_jobs = get_discovered_jobs()

    if saved_jobs:
        st.write("### Persisted Job Records")

        for job in saved_jobs:
            with st.container(border=True):
                st.write(
                    f"**Business:** {job[0]}"
                )
                st.write(
                    f"**Role:** "
                    f"{job[1] or 'Not confirmed'}"
                )
                st.write(
                    f"**Hiring Status:** {job[2]}"
                )
                st.write(
                    f"**Verification:** {job[6]}"
                )
    else:
        st.info("No persisted job records yet.")


st.caption(
    "JobRadar Voice prototype • CALL-E-powered phone discovery in live mode • "
    "mock mode available for safe product demos"
)
