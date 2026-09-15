from matching import calculate_match_score


def test_best_match():
    result = {
        "job_title": "Warehouse Assistant",
        "salary_max": 18000,
        "shift": "Night",
        "hiring_status": "hiring_now",
        "skills_required": [
            "Packing",
            "Inventory"
        ]
    }

    candidate_skills = {
        "packing",
        "inventory"
    }

    score, reasons, label = calculate_match_score(
        result=result,
        preferred_role="Warehouse Assistant",
        candidate_skills=candidate_skills,
        expected_salary=15000,
        preferred_shift="Night"
    )

    assert score == 100
    assert label == "Best Match"
    assert "Role matched" in reasons


def test_low_match():
    result = {
        "job_title": "Retail Associate",
        "salary_max": 12000,
        "shift": "Day",
        "hiring_status": "hiring_soon",
        "skills_required": [
            "Billing"
        ]
    }

    candidate_skills = {
        "packing"
    }

    score, reasons, label = calculate_match_score(
        result=result,
        preferred_role="Warehouse Assistant",
        candidate_skills=candidate_skills,
        expected_salary=18000,
        preferred_shift="Night"
    )

    assert score == 0
    assert label == "Low Match"