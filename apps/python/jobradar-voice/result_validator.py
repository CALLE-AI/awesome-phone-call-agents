from schemas import JOB_DISCOVERY_SCHEMA


def validate_job_result(result: dict) -> tuple[bool, list[str]]:
    errors = []

    required_fields = JOB_DISCOVERY_SCHEMA.get("required", [])

    for field in required_fields:
        if field not in result:
            errors.append(f"Missing required field: {field}")

    valid_hiring_status = {
        "hiring_now",
        "hiring_soon",
        "not_hiring",
        "unclear"
    }

    if result.get("hiring_status") not in valid_hiring_status:
        errors.append("Invalid hiring_status")

    valid_verification_status = {
        "verified",
        "partially_verified",
        "future_demand",
        "unverified"
    }

    if result.get("verification_status") not in valid_verification_status:
        errors.append("Invalid verification_status")

    valid_referral_status = {
        "yes",
        "no",
        "unclear"
    }

    if result.get("candidate_referrals_allowed") not in valid_referral_status:
        errors.append("Invalid candidate_referrals_allowed")

    salary_min = result.get("salary_min")
    salary_max = result.get("salary_max")

    if (
        salary_min is not None
        and salary_max is not None
        and salary_min > salary_max
    ):
        errors.append(
            "salary_min cannot be greater than salary_max"
        )

    if result.get("permission_to_continue") is False:
        if result.get("verification_status") == "verified":
            errors.append(
                "Result cannot be verified if permission was not given"
            )

    return len(errors) == 0, errors