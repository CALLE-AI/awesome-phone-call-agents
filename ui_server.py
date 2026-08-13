import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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
    save_profile_sharing_consent,
    get_profile_sharing_consent,
    reset_demo_data,
)


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"

app = FastAPI(
    title="JobRadar Voice",
    version="2026.1",
)

app.mount(
    "/assets",
    StaticFiles(directory=WEB_DIR),
    name="assets",
)

init_db()

runtime = {
    "profile": None,
    "result": None,
    "match": None,
}


class ProfilePayload(BaseModel):
    name: str
    location: str
    preferred_role: str
    skills: str = ""
    expected_salary: int = 15000
    shift: str = "Day"
    travel_distance: int = 10


class InterestPayload(BaseModel):
    candidate_name: str
    business_name: str
    job_title: str


class ConsentPayload(BaseModel):
    candidate_name: str
    business_name: str
    job_title: str
    consent_status: str


def get_business():
    live_phone = os.getenv(
        "JOBRADAR_TEST_PHONE",
        "",
    ).strip()

    if USE_MOCK_CALLS:
        phone = "+910000000001"
        location = "Test Location"

    else:
        phone = live_phone
        location = "Authorized Test Location"

    return {
        "name": "Metro Warehouse",
        "category": "Logistics",
        "location": location,
        "phone": phone,
        "authorized": True,
        "do_not_call": False,
    }


def clean_result(result):
    return {
        key: value
        for key, value in result.items()
        if not key.startswith("_")
    }


def get_call_record(business):
    logs = get_call_logs()

    for log in logs:

        if log[0] != business["name"]:
            continue

        record = create_call_record(business)

        record["masked_phone"] = (
            log[1]
            or record.get("masked_phone")
        )

        record["status"] = (
            log[2]
            or "prepared"
        )

        record["attempt"] = (
            log[3]
            or 0
        )

        record["outcome"] = log[4]

        record["created_at"] = (
            log[5]
            or record.get("created_at")
        )

        return record

    record = create_call_record(business)

    save_call_record(record)

    return record


@app.get("/")
def home():

    return FileResponse(
        WEB_DIR / "index.html"
    )


@app.get("/api/config")
def config():

    business = get_business()

    allowed, reason = (
        can_call_business(business)
    )

    return {
        "mode": (
            "demo"
            if USE_MOCK_CALLS
            else "live"
        ),

        "mode_label": (
            "DEMO MODE"
            if USE_MOCK_CALLS
            else "LIVE CALL-E MODE"
        ),

        "business": {
            "name": business["name"],
            "category": business["category"],
            "location": business["location"],

            "phone_masked": (
                mask_phone_number(
                    business["phone"]
                )
                if business["phone"]
                else "Not configured"
            ),

            "approved": allowed,
            "approval_reason": reason,
        },
    }


@app.post("/api/search")
def search(profile: ProfilePayload):

    if (
        not profile.name.strip()
        or not profile.location.strip()
    ):
        raise HTTPException(
            status_code=400,
            detail="Name and location are required.",
        )

    runtime["profile"] = (
        profile.model_dump()
    )

    runtime["result"] = None
    runtime["match"] = None

    business = get_business()

    allowed, reason = (
        can_call_business(business)
    )

    return {
        "ok": True,

        "profile": runtime["profile"],

        "employer": {
            "name": business["name"],
            "category": business["category"],
            "location": business["location"],

            "phone_masked": (
                mask_phone_number(
                    business["phone"]
                )
                if business["phone"]
                else "Not configured"
            ),

            "approved": allowed,
            "approval_reason": reason,
        },
    }


@app.post("/api/call")
def call_employer(
    profile: ProfilePayload
):

    business = get_business()

    if (
        not USE_MOCK_CALLS
        and not business["phone"]
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "JOBRADAR_TEST_PHONE "
                "is missing from .env."
            ),
        )

    allowed, reason = (
        can_call_business(business)
    )

    if not allowed:

        raise HTTPException(
            status_code=400,
            detail=reason,
        )

    call_record = (
        get_call_record(business)
    )

    can_retry, retry_reason = (
        should_retry_call(call_record)
    )

    if not can_retry:

        if (
            USE_MOCK_CALLS
            and call_record.get(
                "status"
            ) == "completed"
        ):

            result = (
                discover_job_from_business(
                    business_name=business["name"],
                    phone_number=business["phone"],
                    candidate_role=profile.preferred_role,
                )
            )

        else:

            raise HTTPException(
                status_code=409,
                detail=(
                    f"{business['name']} "
                    f"not called again: "
                    f"{retry_reason}. "
                    "Use Reset Search for "
                    "a fresh authorized test."
                ),
            )

    else:

        call_record = (
            mark_call_started(
                call_record
            )
        )

        save_call_record(
            call_record
        )

        try:

            result = (
                discover_job_from_business(
                    business_name=business["name"],
                    phone_number=business["phone"],
                    candidate_role=profile.preferred_role,
                )
            )

        except Exception as error:

            call_record = (
                mark_outcome_unknown(
                    call_record
                )
            )

            save_call_record(
                call_record
            )

            raise HTTPException(
                status_code=502,
                detail=(
                    "Call outcome unknown. "
                    "Automatic retry blocked. "
                    f"{error}"
                ),
            )

        valid, errors = (
            validate_job_result(
                result
            )
        )

        if not valid:

            call_record = (
                mark_outcome_unknown(
                    call_record
                )
            )

            save_call_record(
                call_record
            )

            raise HTTPException(
                status_code=422,
                detail=(
                    "Invalid call result: "
                    + ", ".join(errors)
                ),
            )

        call_record = (
            mark_call_completed(
                call_record
            )
        )

        save_call_record(
            call_record
        )

        save_discovered_job(
            result
        )

    result["_business_meta"] = (
        business
    )

    result["_call_record"] = (
        call_record
    )

    candidate_skills = {
        skill.strip().lower()
        for skill
        in profile.skills.split(",")
        if skill.strip()
    }

    match = None

    if (
        result.get(
            "permission_to_continue"
        ) is True

        and result.get(
            "hiring_status"
        )
        in {
            "hiring_now",
            "hiring_soon",
        }

        and result.get(
            "job_title"
        )
    ):

        score, reasons, label = (
            calculate_match_score(
                result=result,
                preferred_role=profile.preferred_role,
                candidate_skills=candidate_skills,
                expected_salary=profile.expected_salary,
                preferred_shift=profile.shift,
            )
        )

        match = {
            "score": score,
            "reasons": reasons,
            "label": label,
        }

    runtime["profile"] = (
        profile.model_dump()
    )

    runtime["result"] = (
        clean_result(result)
    )

    runtime["match"] = match

    return {
        "ok": True,

        "result": (
            runtime["result"]
        ),

        "match": match,

        "call_record": {
            "status": call_record.get(
                "status"
            ),

            "attempt": call_record.get(
                "attempt",
                0,
            ),

            "masked_phone": (
                call_record.get(
                    "masked_phone"
                )
            ),
        },
    }


@app.post("/api/interest")
def interest(
    payload: InterestPayload
):

    save_interest(
        payload.candidate_name,
        payload.business_name,
        payload.job_title,
    )

    return {
        "ok": True,
    }


@app.post("/api/consent")
def consent(
    payload: ConsentPayload
):

    if payload.consent_status not in {
        "approved",
        "declined",
    }:

        raise HTTPException(
            status_code=400,
            detail="Invalid consent.",
        )

    save_profile_sharing_consent(
        payload.candidate_name,
        payload.business_name,
        payload.job_title,
        payload.consent_status,
    )

    saved = (
        get_profile_sharing_consent(
            payload.candidate_name,
            payload.business_name,
            payload.job_title,
        )
    )

    followup = None

    if runtime["result"]:

        allowed, reason = (
            can_follow_up_with_employer(
                job_result=runtime[
                    "result"
                ],
                candidate_consent=saved,
            )
        )

        followup = {
            "allowed": allowed,
            "reason": reason,
        }

    return {
        "ok": True,
        "consent": saved,
        "followup": followup,
    }


@app.post("/api/reset")
def reset():

    reset_demo_data()

    runtime["profile"] = None
    runtime["result"] = None
    runtime["match"] = None

    return {
        "ok": True,
    }