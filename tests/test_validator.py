from result_validator import validate_job_result


def test_valid_job_result():
    result = {
        "permission_to_continue": True,
        "hiring_status": "hiring_now",
        "job_title": "Warehouse Assistant",
        "number_of_openings": 2,
        "salary_min": 15000,
        "salary_max": 18000,
        "shift": "Night",
        "experience_required": "Fresher",
        "skills_required": ["Packing"],
        "joining_timeline": "Immediate",
        "candidate_referrals_allowed": "yes",
        "future_follow_up_allowed": True,
        "missing_information": [],
        "verification_status": "verified",
        "follow_up_required": False,
        "call_summary": "Hiring confirmed."
    }

    valid, errors = validate_job_result(result)

    assert valid is True
    assert errors == []


def test_invalid_salary_range():
    result = {
        "permission_to_continue": True,
        "hiring_status": "hiring_now",
        "salary_min": 20000,
        "salary_max": 15000,
        "candidate_referrals_allowed": "yes",
        "verification_status": "verified",
        "follow_up_required": False
    }

    valid, errors = validate_job_result(result)

    assert valid is False
    assert "salary_min cannot be greater than salary_max" in errors