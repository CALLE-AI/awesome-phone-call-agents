def can_follow_up_with_employer(
    job_result: dict,
    candidate_consent: str
) -> tuple[bool, str]:

    if candidate_consent != "approved":
        return False, "Candidate has not approved profile sharing."

    if job_result.get("permission_to_continue") is not True:
        return False, "Business did not give permission to continue."

    if job_result.get("candidate_referrals_allowed") != "yes":
        return False, "Business has not approved candidate referrals."

    if job_result.get("hiring_status") not in {
        "hiring_now",
        "hiring_soon"
    }:
        return False, "Business is not currently hiring."

    return True, "Employer follow-up is eligible."