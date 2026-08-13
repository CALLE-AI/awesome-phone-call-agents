import os
from dotenv import load_dotenv

from call_prompt import build_job_discovery_prompt
from live_result_parser import parse_hiring_result

load_dotenv(override=True)

USE_MOCK_CALLS = os.getenv(
    "USE_MOCK_CALLS",
    "true"
).lower() == "true"

CALLE_API_KEY = os.getenv(
    "CALLE_API_KEY",
    ""
).strip()


def _read_call_value(call, key, default=None):
    if isinstance(call, dict):
        return call.get(key, default)

    return getattr(call, key, default)


def discover_job_from_business(
    business_name: str,
    phone_number: str,
    candidate_role: str = "Local Job Opportunity"
) -> dict:

    if USE_MOCK_CALLS:
        return _run_mock_call(
            business_name=business_name,
            phone_number=phone_number
        )

    return _run_real_calle_call(
        business_name=business_name,
        phone_number=phone_number,
        candidate_role=candidate_role
    )


def _run_real_calle_call(
    business_name: str,
    phone_number: str,
    candidate_role: str
) -> dict:

    if not CALLE_API_KEY:
        raise RuntimeError("CALLE_API_KEY is missing.")

    if not phone_number.startswith("+"):
        raise RuntimeError(
            "A valid E.164 phone number is required."
        )

    try:
        from calle import CalleClient
    except ImportError as error:
        raise RuntimeError(
            "calle-ai package is not installed."
        ) from error

    call_prompt = build_job_discovery_prompt(
        business_name=business_name,
        candidate_role=candidate_role
    )

    # Final live JobRadar call prompt.
    # Uses the same SDK path that already worked in official_live_test.py.
    task = (
        f"Call {phone_number}. "
        f"This is an authorized test call for JobRadar Voice. "

        f"IMPORTANT LANGUAGE FLOW: "
        f"First introduce yourself in simple neutral English: "
        f"'Hello, this is JobRadar Voice AI assistant.' "
        f"Immediately ask: "
        f"'Which language would you prefer for this conversation, English or Hindi?' "
        f"Wait for the recipient's answer before asking anything else. "
        f"If they choose English, conduct the entire remaining conversation in English. "
        f"If they choose Hindi, conduct the entire remaining conversation in natural Hindi. "
        f"If they explicitly ask for Hinglish, use natural Hinglish. "
        f"Do not switch languages later unless the recipient asks you to. "

        f"After the language is chosen, ask for permission to continue for about one minute. "
        f"If permission is denied, thank them and end the call. "

        f"If permission is given, ask whether they are CURRENTLY hiring for {candidate_role}. "
        f"Do not assume that they are hiring. "
        f"If they say they are not hiring, clearly confirm 'not currently hiring', "
        f"ask whether JobRadar may contact them again for future hiring, then end politely. "

        f"If they ARE currently hiring, ask every hiring question below ONE BY ONE. "
        f"Wait for the recipient's answer after every question. "
        f"Never answer a question on the recipient's behalf. "
        f"Never infer a missing answer from the task text. "

        f"Ask: "
        f"1. Exactly how many openings are available right now? "
        f"2. What is the exact monthly salary, or salary range? "
        f"3. What is the shift: day, night, rotational, or something else? "
        f"4. What experience is required? "
        f"5. What skills are required? "
        f"6. When should the candidate join? "
        f"7. May JobRadar refer suitable candidates for this role? "
        f"8. May JobRadar contact you again for future hiring? "

        f"IMPORTANT ACCURACY RULES: "
        f"Use only facts spoken by the recipient during this call. "
        f"Do not invent openings, salary, shift, skills, experience, or joining timeline. "
        f"If an answer is missing or unclear, ask once again politely. "
        f"If it is still unclear, treat it as not confirmed. "
        f"For openings and salary, repeat the exact number back to the recipient for confirmation. "
        f"For shift, repeat only the shift they actually stated. "
        f"Do not convert 'day' into 'day/night' unless the recipient explicitly says both. "

        f"Before ending, give a short confirmation recap in the SAME selected language. "
        f"The recap must include only confirmed details: hiring status, role, openings, salary, "
        f"shift, experience, skills, joining timeline, referral permission, and future follow-up permission. "
        f"If any item was not confirmed, explicitly say it was not confirmed. "
        f"Then thank the recipient and end the call politely. "
        f"Keep the conversation natural and concise."
    )

    client = CalleClient(
        api_key=CALLE_API_KEY
    )

    print(
        "\n[CALL-E] Starting LIVE call using the working SDK path...",
        flush=True
    )

    # This is the exact execution pattern that worked in official_live_test.py.
    call = client.calls.create_and_wait(
        task=task
    )

    print(
        "\n================ CALL-E RAW RESPONSE ================",
        flush=True
    )
    print(call, flush=True)
    print(
        "=====================================================\n",
        flush=True
    )

    if not call:
        raise RuntimeError(
            "CALL-E returned an empty response."
        )

    parsed_result = parse_hiring_result(
        call=call,
        business_name=business_name
    )

    parsed_result["_calle_metadata"] = {
        "status": _read_call_value(
            call,
            "status",
            "unknown"
        ),
        "task_completed": _read_call_value(
            call,
            "task_completed",
            None
        ),
        "completion_confidence": _read_call_value(
            call,
            "completion_confidence",
            None
        ),
        "evidence": _read_call_value(
            call,
            "evidence",
            []
        ),
        "summary": (
            _read_call_value(call, "summary", None)
            or _read_call_value(call, "result", None)
            or _read_call_value(call, "message", None)
        )
    }

    return parsed_result


def _run_mock_call(
    business_name: str,
    phone_number: str
) -> dict:

    mock_results = {

        "Metro Warehouse": {
            "business_name": "Metro Warehouse",
            "permission_to_continue": True,
            "hiring_status": "hiring_now",
            "job_title": "Warehouse Assistant",
            "number_of_openings": 2,
            "salary_min": 16000,
            "salary_max": 18000,
            "shift": "Night",
            "experience_required": "Fresher accepted",
            "skills_required": [
                "Packing",
                "Inventory"
            ],
            "joining_timeline": "Immediate",
            "candidate_referrals_allowed": "yes",
            "future_follow_up_allowed": True,
            "missing_information": [],
            "verification_status": "verified",
            "follow_up_required": False,
            "call_summary": (
                "Business confirmed two Warehouse Assistant openings. "
                "Freshers are accepted and immediate joining is preferred."
            )
        },

        "City Mart": {
            "business_name": "City Mart",
            "permission_to_continue": True,
            "hiring_status": "hiring_now",
            "job_title": "Retail Associate",
            "number_of_openings": 1,
            "salary_min": 14000,
            "salary_max": 16000,
            "shift": "Day",
            "experience_required": "0-1 year",
            "skills_required": [
                "Communication",
                "Billing"
            ],
            "joining_timeline": "Within 7 days",
            "candidate_referrals_allowed": "yes",
            "future_follow_up_allowed": True,
            "missing_information": [],
            "verification_status": "verified",
            "follow_up_required": False,
            "call_summary": (
                "Business confirmed one Retail Associate opening "
                "with a day shift and joining within seven days."
            )
        },

        "Care Clinic": {
            "business_name": "Care Clinic",
            "permission_to_continue": True,
            "hiring_status": "hiring_soon",
            "job_title": "Reception / Office Assistant",
            "number_of_openings": 1,
            "salary_min": 15000,
            "salary_max": 17000,
            "shift": "Day",
            "experience_required": "Basic computer skills",
            "skills_required": [
                "Communication",
                "Basic Computer",
                "Excel"
            ],
            "joining_timeline": "Next month",
            "candidate_referrals_allowed": "unclear",
            "future_follow_up_allowed": True,
            "missing_information": [
                "Exact joining date"
            ],
            "verification_status": "future_demand",
            "follow_up_required": True,
            "call_summary": (
                "Business expects a Reception / Office Assistant opening "
                "next month. Exact joining date is not yet confirmed."
            )
        },

        "Royal Bakery": {
            "business_name": "Royal Bakery",
            "permission_to_continue": True,
            "hiring_status": "not_hiring",
            "job_title": None,
            "number_of_openings": 0,
            "salary_min": None,
            "salary_max": None,
            "shift": None,
            "experience_required": None,
            "skills_required": [],
            "joining_timeline": None,
            "candidate_referrals_allowed": "no",
            "future_follow_up_allowed": True,
            "missing_information": [],
            "verification_status": "verified",
            "follow_up_required": False,
            "call_summary": (
                "Business confirmed that they are not hiring currently."
            )
        },

        "Star Electronics": {
            "business_name": "Star Electronics",
            "permission_to_continue": True,
            "hiring_status": "hiring_now",
            "job_title": "Store Assistant",
            "number_of_openings": 1,
            "salary_min": None,
            "salary_max": None,
            "shift": "Day",
            "experience_required": "Basic customer handling",
            "skills_required": [
                "Communication"
            ],
            "joining_timeline": "Immediate",
            "candidate_referrals_allowed": "yes",
            "future_follow_up_allowed": True,
            "missing_information": [
                "Salary range"
            ],
            "verification_status": "partially_verified",
            "follow_up_required": False,
            "call_summary": (
                "Business confirmed one Store Assistant opening "
                "but chose not to share salary details."
            )
        },

        "QuickFix Services": {
            "business_name": "QuickFix Services",
            "permission_to_continue": False,
            "hiring_status": "unclear",
            "job_title": None,
            "number_of_openings": None,
            "salary_min": None,
            "salary_max": None,
            "shift": None,
            "experience_required": None,
            "skills_required": [],
            "joining_timeline": None,
            "candidate_referrals_allowed": "unclear",
            "future_follow_up_allowed": False,
            "missing_information": [
                "Hiring status",
                "Role",
                "Salary",
                "Shift",
                "Joining timeline"
            ],
            "verification_status": "unverified",
            "follow_up_required": False,
            "call_summary": (
                "Business did not give permission to continue the call."
            )
        }
    }

    return mock_results.get(
        business_name,
        {
            "business_name": business_name,
            "permission_to_continue": False,
            "hiring_status": "unclear",
            "job_title": None,
            "number_of_openings": None,
            "salary_min": None,
            "salary_max": None,
            "shift": None,
            "experience_required": None,
            "skills_required": [],
            "joining_timeline": None,
            "candidate_referrals_allowed": "unclear",
            "future_follow_up_allowed": False,
            "missing_information": [
                "Hiring status",
                "Role",
                "Salary",
                "Shift",
                "Joining timeline"
            ],
            "verification_status": "unverified",
            "follow_up_required": False,
            "call_summary": (
                "No verified hiring information was collected."
            )
        }
    )
