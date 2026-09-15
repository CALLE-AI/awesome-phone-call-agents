"""Draft-only goal clarification. This state never authorizes work or makes calls.

The optional context travels with the browser draft so an unanswered goal question
survives retries, status replies and reloads. Changing the goal field invalidates
it. The conservative rules also protect model-backed reviews from premature
confirmation; a model can supply additional questions, not bypass this guard.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from rescue_intent import (ambiguous_check_goal, conditional_transport, conditional_goal,
                           goal_revision_request, extract_goal, normal,
                           SCOPE_QUESTION, safe_reply, welfare_check_fragment,
                           goal_completion_reply, WELFARE_CHECK_GOAL, CARE, MOVE, MEDICAL)


class GoalClarification(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    kind: Literal["scope", "revision", "conditional", "model", "missing"]
    goal: str = Field(default="", max_length=600)
    question: str = Field(min_length=8, max_length=400)


MISSING_QUESTION = "What would a successful rescue mean to you?"

CHECK_QUESTION = (
    "What kind of help should we ask for: someone to observe from a safe distance and report back, "
    "a veterinary professional to assess the animal on site, or pickup and transport to a vet "
    "for assessment? You can describe a different outcome too."
)
REVISION_QUESTION = (
    "What should we change about the goal: the kind of help, what the responder should do, "
    "or what a successful outcome looks like? Tell me what is missing; we will keep this as a draft."
)
UNCERTAIN_QUESTION = (
    "What are you most concerned about: whether the animal is safe, whether it needs a veterinary "
    "assessment, or getting it to a clinic? You do not need to diagnose it. Describe your concern "
    "or choose the kind of help below; we will not contact anyone yet."
)

GOAL_CHOICES = [
    {"label": "Observe and report back", "reply": WELFARE_CHECK_GOAL},
    {"label": "On-site veterinary assessment", "reply": "Arrange an on-site veterinary assessment of the animal; no transport yet."},
    {"label": "Transport to a vet", "reply": "Arrange safe pickup and transport to a vet for assessment."},
]
CONDITIONAL_CHOICES = GOAL_CHOICES[1:]


def latest_user(data: dict) -> str:
    return next((m["text"] for m in reversed(data.get("messages", [])) if m.get("role") == "user"), "")


def pending_goal(data: dict) -> dict | None:
    context = data.get("goal_clarification")
    if not context:
        return None
    # API input is validated too; this also protects non-HTTP callers/tests.
    context = GoalClarification.model_validate(context).model_dump()
    if normal(context["goal"]).casefold() != normal(data["report"].get("expected_outcome", "")).casefold():
        return None
    return context


def clarification_for(data: dict, goal: str) -> dict | None:
    """An old goal stays a draft until there is a real new outcome or form edit."""
    old_goal = data["report"].get("expected_outcome", "")
    latest = latest_user(data) if data.get("new_reply") else ""
    explicit_answer = bool(latest and (contextual_goal_choice(data, latest) or extract_goal(latest)))
    prior = pending_goal(data)
    if prior and prior["kind"] == "model" and scope_menu_question(prior["question"]):
        prior = None if explicit_scope_goal(goal) else {**prior, "kind": "scope", "question": CHECK_QUESTION}
    completed = bool(goal and extract_goal(goal, explicit_field=True) and goal_completion_reply(latest)
                     and not (prior and prior["kind"] in {"scope", "conditional", "missing"}))
    changed = bool(goal and (normal(goal).casefold() != normal(old_goal).casefold() or explicit_answer or completed))
    # v5.5 persisted a forced stage-choice question for perfectly clear IF goals.
    # It is obsolete draft state, not missing consent to one of its two options.
    if prior and (prior["kind"] == "conditional" or prior["question"] == SCOPE_QUESTION):
        prior = None
    if goal_revision_request(latest) and not changed:
        kind = "revision"
        question = CHECK_QUESTION if ambiguous_check_goal(goal) else REVISION_QUESTION
    elif ambiguous_check_goal(goal):
        kind, question = "scope", CHECK_QUESTION
    elif prior and not changed:
        kind, question = prior["kind"], prior["question"]
    else:
        return None
    if kind in {"scope", "revision", "missing"} and re.fullmatch(
            r"(?:i(?:'m| am)? )?(?:not sure(?: yet)?|don'?t know|do not know|unsure)[.!? ]*", normal(latest), re.I):
        question = UNCERTAIN_QUESTION
    return {"kind": kind, "goal": goal, "question": question}


def choices_for(context: dict | None) -> list[dict]:
    if not context:
        return []
    if context["kind"] == "conditional":
        return [dict(choice) for choice in CONDITIONAL_CHOICES]
    # Only expose a numbered scope menu when the actual question uses that menu.
    if context["kind"] == "scope" or (context["kind"] == "revision" and context["question"] in {CHECK_QUESTION, UNCERTAIN_QUESTION}):
        return [dict(choice) for choice in GOAL_CHOICES]
    return []


def contextual_goal_choice(data: dict, text: str) -> str:
    """Resolve explicit short answers against the current goal question only.

    Bare yes/no, 'vet', observations and medical symptoms are not scope choices.
    Negations and conditions must be handled as explicit requests, not guessed.
    """
    if not data.get("new_reply"):
        return ""
    # A separately recognized inappropriate aside must not erase a safe answer.
    text = safe_reply(text)
    if not text:
        return ""
    context = pending_goal(data)
    original = data["report"].get("expected_outcome", "")
    if not context and ambiguous_check_goal(original):
        context = {"kind": "scope", "goal": original, "question": CHECK_QUESTION}
    if not context:
        return ""
    if welfare_check_fragment(text):
        return GOAL_CHOICES[0]["reply"]
    t = normal(text).casefold().strip(" .!?")
    if context["kind"] in {"revision", "model"} and original and not scope_menu_question(context["question"]) and re.fullmatch(
            r"(?:please )?keep (?:the |my )?(?:original|current|existing) goal(?: (?:as is|unchanged))?", t):
        return original
    choices = choices_for(context)
    ordinal = re.fullmatch(r"(?:the )?(first|second|third|1st|2nd|3rd|1|2|3)(?: (?:one|option))?|option ([123])", t)
    if ordinal:
        word = ordinal[1] or ordinal[2]
        index = {"first": 0, "1st": 0, "1": 0, "second": 1, "2nd": 1, "2": 1, "third": 2, "3rd": 2, "3": 2}[word]
        return choices[index]["reply"] if index < len(choices) else ""
    if re.fullmatch(r"(?:(?:just|only) )?(?:observation(?: only)?|observe(?: only)?|watch(?: only)?|observe and report back|a visual check|a welfare check|someone to look and report back)", t):
        return GOAL_CHOICES[0]["reply"]
    if re.fullmatch(
            r"(?:(?:a|an|the) )?(?:on[ -]site (?:vet|veterinary (?:assessment|professional))|"
            r"(?:vet|veterinary assessment) (?:on[ -]site|here)|"
            r"vet (?:to |should )?come (?:here|to the animal)|assessment (?:here|on[ -]site))"
            r"(?: first)?(?:[,;]? (?:please|no transport(?: yet)?))?", t):
        return GOAL_CHOICES[1]["reply"]
    if re.fullmatch(r"(?:pickup and )?transport to (?:a |the )?(?:vet|clinic)(?: for assessment)?(?: please)?", t):
        return GOAL_CHOICES[2]["reply"]
    return ""




def explicit_scope_goal(goal: str) -> bool:
    """Proof for dismissing a repeated service menu, not a readiness shortcut.

    In particular, a generic request for help is not proof of any one service.
    Required questions and scope/conditional guards still run independently.
    """
    if ambiguous_check_goal(goal):
        return False
    if conditional_goal(goal):
        return True
    t = normal(goal).casefold().translate(str.maketrans("‐‑–−", "----"))
    positive = ' '.join(re.split(r"\b(?:do not|don't|without|no|not)\b", part, maxsplit=1)[0]
                        for part in re.split(r'[.;]|\bbut\b', t))
    observation = (re.search(r"\b(?:observe|observation|watch|report back|welfare check|check(?: up)? on)\b", positive)
                   and not re.search(MEDICAL + '|' + CARE + '|' + MOVE, positive))
    on_site = re.search(r"\bon[ -]site\b", positive) and re.search(r"\b(?:vet|veterinary|veterinarian)\b", positive)
    transport = re.search(MOVE, positive) and re.search(CARE, positive)
    return bool(observation or on_site or transport)


def scope_menu_question(question: str) -> bool:
    """Recognize a broad three-service menu, not a targeted logistical question.

    Models use different wording and non-breaking hyphens. Canonicalize an old
    menu before displaying numbered choices, never reinterpret an old ordinal
    using a newly imposed order. This deliberately narrow English matcher is
    also used to drop stale service menus AFTER a concrete scope is selected.
    """
    q = normal(question).casefold().translate(str.maketrans("‐‑–−", "----"))
    prompt = re.search(
        r"^(?:when you say\b.{0,120},\s*)?(?:do you (?:want|mean|prefer)|"
        r"would you (?:like|prefer)|are you (?:asking for|looking for)|"
        r"should we (?:arrange|request)|what (?:kind|type) of (?:help|check)|"
        r"which (?:kind|type) of (?:help|check))\b", q)
    return bool(prompt and re.search(r"\bor\b", q)
                and re.search(r"\b(?:welfare check|observation|observe|report back)\b", q)
                and re.search(r"\bon[ -]site\b", q)
                and re.search(r"\b(?:vet|veterinary|veterinarian)\b", q)
                and re.search(r"\b(?:transport|pickup|pick-up)\b", q))


def generic_goal_question(question: str) -> bool:
    """Broad goal/scope menus, not targeted model follow-ups about an actual gap."""
    q = normal(question).casefold()
    if scope_menu_question(question) or q in {normal(t).casefold() for t in (MISSING_QUESTION, CHECK_QUESTION, UNCERTAIN_QUESTION, SCOPE_QUESTION)}:
        return True
    return bool(re.search(
        r"^(?:what would (?:a |the )?successful rescue (?:mean|look like)|"
        r"what (?:kind|type) of help (?:would you like|do you (?:want|need)|should we))\b", q)
        or re.fullmatch(
        r"(?:what (?:help|outcome) (?:would you like|do you (?:want|need))|"
        r"what is (?:your|the) (?:rescue )?goal)(?: for (?:him|her|it|the animal|the dog|the cat))?[? .]*", q))
