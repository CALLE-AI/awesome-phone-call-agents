"""Role-specific question sets.

Templates are plain data so a host application can store them in its own
database and pass them straight to `build_result_schema` and
`build_reference_task`. Placeholders are filled in when the task is built:
`{candidate_name}`, `{role}`, `{jd_summary}`.
"""
from __future__ import annotations

STANDARD = [
    {
        "id": "q_relationship",
        "text": "Can you describe your working relationship with {candidate_name} and how long you worked together?",
        "type": "open",
    },
    {
        "id": "q_role",
        "text": "What were {candidate_name}'s main responsibilities in their role?",
        "type": "open",
    },
    {
        "id": "q_strengths",
        "text": "What would you say are {candidate_name}'s greatest professional strengths?",
        "type": "open",
        "follow_up": "Can you give me a specific example?",
    },
    {
        "id": "q_areas_for_growth",
        "text": "What areas could {candidate_name} continue to develop professionally?",
        "type": "open",
    },
    {
        "id": "q_achievement",
        "text": "Can you tell me about a project or achievement of {candidate_name}'s that stands out?",
        "type": "open",
    },
    {
        "id": "q_under_pressure",
        "text": "How did {candidate_name} perform under pressure or during challenging situations?",
        "type": "open",
    },
    {
        "id": "q_collaboration",
        "text": "How well did {candidate_name} collaborate with others on the team?",
        "type": "open",
    },
    {
        "id": "q_rehire",
        "text": "If you had the opportunity, would you work with or hire {candidate_name} again?",
        "type": "boolean",
        "follow_up": "Can you tell me more about that?",
    },
    {
        "id": "q_fit",
        "text": "We are considering {candidate_name} for a {role} role that involves {jd_summary}. How do you think they would perform in that context?",
        "type": "open",
    },
]

ENGINEERING = [
    STANDARD[0],
    {
        "id": "q_technical",
        "text": "How would you describe {candidate_name}'s technical abilities, and what did they work with?",
        "type": "open",
        "follow_up": "Can you give a specific example of their best technical work?",
    },
    {
        "id": "q_problem_solving",
        "text": "Can you describe a difficult technical problem {candidate_name} solved, and how they approached it?",
        "type": "open",
    },
    {
        "id": "q_code_quality",
        "text": "How would you describe {candidate_name}'s code quality and engineering practices?",
        "type": "open",
    },
    {
        "id": "q_learning",
        "text": "How quickly did {candidate_name} pick up new technologies or unfamiliar systems?",
        "type": "open",
    },
    STANDARD[5],
    STANDARD[6],
    STANDARD[7],
    STANDARD[8],
]

SALES = [
    STANDARD[0],
    {
        "id": "q_quota",
        "text": "Did {candidate_name} consistently meet or exceed their targets?",
        "type": "open",
        "follow_up": "What was their typical attainment?",
    },
    {
        "id": "q_customer",
        "text": "How did customers and prospects respond to {candidate_name}?",
        "type": "open",
    },
    {
        "id": "q_objections",
        "text": "How well did {candidate_name} handle objections or difficult negotiations?",
        "type": "open",
    },
    {
        "id": "q_coachability",
        "text": "How did {candidate_name} respond to coaching or feedback?",
        "type": "open",
    },
    STANDARD[6],
    STANDARD[7],
    STANDARD[8],
]

LEADERSHIP = [
    STANDARD[0],
    {
        "id": "q_team_building",
        "text": "How did {candidate_name} build and develop their team?",
        "type": "open",
        "follow_up": "Can you give a specific example?",
    },
    {
        "id": "q_decision_making",
        "text": "Can you describe how {candidate_name} made difficult decisions?",
        "type": "open",
    },
    {
        "id": "q_strategic",
        "text": "How did {candidate_name} think strategically and set direction?",
        "type": "open",
    },
    {
        "id": "q_conflict",
        "text": "How did {candidate_name} handle conflict or underperformance on the team?",
        "type": "open",
    },
    STANDARD[5],
    STANDARD[7],
    STANDARD[8],
]

TEMPLATES = {
    "standard": STANDARD,
    "engineering": ENGINEERING,
    "sales": SALES,
    "leadership": LEADERSHIP,
}
