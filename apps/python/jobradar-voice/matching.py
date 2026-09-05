def calculate_match_score(
    result: dict,
    preferred_role: str,
    candidate_skills: set,
    expected_salary: int,
    preferred_shift: str
) -> tuple[int, list[str], str]:

    score = 0
    reasons = []

    job_title = result.get("job_title")
    salary_max = result.get("salary_max") or 0
    job_shift = result.get("shift")
    hiring_status = result.get("hiring_status")
    result_skills = result.get("skills_required", [])

    if job_title == preferred_role:
        score += 35
        reasons.append("Role matched")

    if salary_max >= expected_salary:
        score += 20
        reasons.append("Salary matched")

    if preferred_shift == "Any" or job_shift == preferred_shift:
        score += 15
        reasons.append("Shift matched")

    if hiring_status == "hiring_now":
        score += 10
        reasons.append("Hiring now")

    required_skills = {
        skill.lower()
        for skill in result_skills
    }

    if required_skills:
        matched_skills = candidate_skills & required_skills

        skill_match_ratio = (
            len(matched_skills) / len(required_skills)
        )

        skill_score = round(skill_match_ratio * 20)
        score += skill_score

        if matched_skills:
            reasons.append(
                f"Skills matched: "
                f"{', '.join(sorted(matched_skills))}"
            )

    if score >= 80:
        match_label = "Best Match"
    elif score >= 60:
        match_label = "Good Match"
    else:
        match_label = "Low Match"

    return score, reasons, match_label