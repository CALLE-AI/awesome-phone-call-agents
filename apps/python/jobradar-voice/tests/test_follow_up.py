from follow_up import can_follow_up_with_employer


def test_follow_up_allowed():
    result = {
        "permission_to_continue": True,
        "candidate_referrals_allowed": "yes",
        "hiring_status": "hiring_now"
    }

    allowed, _ = can_follow_up_with_employer(
        job_result=result,
        candidate_consent="approved"
    )

    assert allowed is True


def test_follow_up_blocked_without_candidate_consent():
    result = {
        "permission_to_continue": True,
        "candidate_referrals_allowed": "yes",
        "hiring_status": "hiring_now"
    }

    allowed, _ = can_follow_up_with_employer(
        job_result=result,
        candidate_consent="declined"
    )

    assert allowed is False


def test_follow_up_blocked_if_business_does_not_allow_referrals():
    result = {
        "permission_to_continue": True,
        "candidate_referrals_allowed": "no",
        "hiring_status": "hiring_now"
    }

    allowed, _ = can_follow_up_with_employer(
        job_result=result,
        candidate_consent="approved"
    )

    assert allowed is False