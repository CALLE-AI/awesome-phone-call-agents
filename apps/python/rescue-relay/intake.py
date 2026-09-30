"""No-call report clarification, shared by form and conversation intake."""
from __future__ import annotations
import re
from rescue_intent import (extract_goal, requested_action, conditional_transport, conditional_goal, stage_choice,
                           unsafe_request, SAFETY_NOTICE, normal, goal_completion_reply)
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from intake_semantics import (GoalAssessment, GoalOption, validate_semantics,
                              SEMANTIC_INSTRUCTION, obvious_non_welfare_goal)
from goal_dialogue import (clarification_for, contextual_goal_choice, choices_for,
                           pending_goal, MISSING_QUESTION, generic_goal_question,
                           scope_menu_question, explicit_scope_goal, CHECK_QUESTION)


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    field: Literal["location", "animal_type", "expected_outcome", "situation"]
    question: str = Field(min_length=8, max_length=400)


class IntakeReview(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    goal_assessment: GoalAssessment | None = None
    goal_options: list[GoalOption] = Field(default_factory=list, max_length=3)
    understanding: str = Field(min_length=8, max_length=800)
    location: str = Field(default="", max_length=250)
    animal_type: str = Field(default="", max_length=100)
    expected_outcome: str = Field(default="", max_length=600)
    location_quote: str = Field(default="", max_length=1200)
    animal_quote: str = Field(default="", max_length=1200)
    outcome_quote: str = Field(default="", max_length=1200)
    questions: list[Question] = Field(default_factory=list, max_length=4)


ANIMALS = {"dog": r"\b(dog|dogs|puppy|puppies)\b", "cat": r"\b(cat|cats|kitten|kittens)\b",
           "bird": r"\b(bird|birds|pigeon|pigeons|crow|parrot)\b", "cow": r"\b(cow|cows|calf)\b",
           "horse": r"\b(horse|horses)\b", "snake": r"\b(snake|snakes)\b", "wildlife": r"\bwildlife\b"}


def user_texts(data: dict) -> list[str]:
    report = data["report"]
    return [report.get("summary", "")] + [m["text"] for m in data.get("messages", []) if m.get("role") == "user"]


def explicit_goal(text: str) -> str:
    return extract_goal(text)


def goal_from_history(data: dict) -> tuple[str, str]:
    report = data["report"]
    original = report.get("expected_outcome", "")
    goal = extract_goal(original, explicit_field=True)
    quote = original if goal else ""
    messages = [m["text"] for m in data.get("messages", []) if m.get("role") == "user"]
    if data.get("new_reply") and messages:
        choice = contextual_goal_choice(data, messages[-1])
        if choice:
            return choice, messages[-1][:1200]
    # Form edits win over old conversation. New chat can change intent ONLY when it
    # actually requests a different outcome; answering 'are you still there?' cannot.
    if goal:
        if data.get("new_reply") and messages:
            latest = messages[-1]
            order_reminder = conditional_goal(goal) and bool(re.fullmatch(
                r"(?:(?:please|yes)[, ]+)?(?:an? )?(?:on[ -]site (?:veterinary )?)?(?:assessment|assess(?: him| her| it| the animal| the dog)?) first[.! ]*",
                normal(latest), re.I))
            change = "" if order_reminder else (stage_choice(latest, goal) or extract_goal(latest))
            if change:
                return change, latest[:1200]
        return goal, quote[:1200]
    # Recover an earlier safe request from an old draft, using the question that
    # actually preceded each answer rather than applying today's menu to history.
    prior = pending_goal(data)
    entries = [(report.get("summary", ""), "")]
    assistant_turn = []
    for message in data.get("messages", []):
        if message["role"] == "assistant":
            assistant_turn.append(message["text"])
        elif message["role"] == "user":
            entries.append((message["text"], "\n".join(assistant_turn)))
            assistant_turn = []
    for text, question in entries:
        history_choice = ""
        if prior and normal(prior["question"]).casefold() in normal(question).casefold():
            # Ordinals cannot be replayed against a menu whose order may have changed.
            t = normal(text).casefold().strip(" .!?")
            if not re.fullmatch(r"(?:the )?(?:first|second|third|1st|2nd|3rd|[123])(?: (?:one|option))?|option [123]", t):
                history_choice = contextual_goal_choice({**data, "new_reply": True}, text)
        change = stage_choice(text, goal) or extract_goal(text) or history_choice
        if change:
            goal, quote = change, text[:1200]
    return goal, quote


def rule_review(data: dict) -> dict:
    report = data["report"]
    texts = user_texts(data)
    location, animal = report.get("location", ""), report.get("animal_type", "")
    goal, oq = goal_from_history(data)
    outside_scope = obvious_non_welfare_goal(goal)
    if outside_scope:
        goal, oq = "", ""
    lq = aq = ""
    for text in texts:
        found = next((k for k, pattern in ANIMALS.items() if re.search(pattern, text, re.I)), None)
        if found and not animal:
            animal, aq = found, text[:1200]
        if not animal and re.search(r"\b(?:animal|species|type)\b.{0,40}\b(?:unknown|not sure|cannot tell|can't tell)\b|^unknown[.! ]*$", text, re.I):
            animal, aq = "unknown", text[:1200]
        if not location:
            m = re.search(r"\b(?:at|near|beside|outside|location:)\s+([^\n.!?]{3,180})", text, re.I)
            if m:
                location, lq = m[1].strip(), m[0][:1200]
    questions = []
    if not animal:
        questions.append({"field": "animal_type", "question": "What kind of animal is it? You can say unknown if you cannot tell safely."})
    if not location or location.casefold() in {"unknown", "here", "nearby", "not sure"}:
        questions.append({"field": "location", "question": "Where is the animal? Share a street or a clear landmark so a helper can find it."})
    if not goal or goal.casefold().strip(".! ") in {"help", "rescue", "help the animal", "rescue the animal", "i don't know", "not sure"}:
        goal = ""
        questions.append({"field": "expected_outcome", "question": MISSING_QUESTION})
    clarification = clarification_for(data, goal)
    if clarification:
        questions = [{"field": "expected_outcome", "question": clarification["question"]}] + [
            q for q in questions if q["field"] != "expected_outcome"]
    return {"understanding": "I have your observations. Let's clarify the missing details before contacting anyone." if questions else "Please check the rescue goal and location below. Nobody has been contacted.",
            "location": location, "animal_type": animal, "expected_outcome": goal,
            "location_quote": lq, "animal_quote": aq, "outcome_quote": oq, "questions": questions}


def validate_review(raw: dict, data: dict) -> dict:
    result = IntakeReview.model_validate(raw).model_dump()
    if result.get("goal_assessment") is not None:
        return validate_semantics(result, data)
    result.pop("goal_assessment", None)
    result.pop("goal_options", None)
    report = data["report"]
    texts = user_texts(data)
    normalized = [" ".join(t.casefold().split()) for t in texts]
    for field, quote_field in [("location", "location_quote"), ("animal_type", "animal_quote"), ("expected_outcome", "outcome_quote")]:
        value, original = result[field], report.get(field, "")
        if original and value!=original and not data.get("new_reply"):
            result[field]=original
            continue
        quote = " ".join(result[quote_field].casefold().split())
        supported = len(quote) >= 3 and any(quote in t for t in normalized)
        if field == "location" and value and value != original:
            supported = supported and " ".join(value.casefold().split()) in quote
        if field == "animal_type" and value in ANIMALS and value != original:
            supported = supported and bool(re.search(ANIMALS[value], quote, re.I))
        if value and value != original and not supported:
            result[field] = original  # ungrounded suggested fact is never inserted
    proposed_goal = result["expected_outcome"]
    goal, goal_source = goal_from_history(data)
    # Verbatim quote grounding alone is insufficient: a quotation of a status or
    # unsafe aside is still not rescue intent. Known English intent takes priority
    # over a model that broadens/narrows it or copies the latest reply wholesale.
    if not goal:
        quote = result["outcome_quote"]
        grounded = any(" ".join(quote.casefold().split()) in t for t in normalized) if quote else False
        if grounded and requested_action(quote) and requested_action(proposed_goal, explicit_field=True):
            goal = extract_goal(proposed_goal, explicit_field=True)
    outside_scope = obvious_non_welfare_goal(goal)
    if outside_scope:
        goal = ""
    result["expected_outcome"] = goal
    necessary = rule_review({"report": {**report, **{k: result[k] for k in ("location", "animal_type", "expected_outcome")}}, "messages": []})
    # Required questions cannot be crowded out by optional model questions. Never
    # claim readiness with an empty/unsupported goal. Conditional work is a valid goal.
    required = necessary["questions"]
    clarification = clarification_for(data, goal)
    if clarification and clarification["kind"] in {"model", "revision"} and not choices_for(clarification):
        # Let the model ask a more targeted follow-up instead of freezing its
        # first question. Missing output is not permission to clear the state.
        followup = next((q for q in result["questions"] if q["field"] == "expected_outcome"), None)
        if followup:
            clarification = {**clarification, "question": followup["question"]}
    if clarification and clarification["kind"] in {"model", "revision"} and not choices_for(clarification) and scope_menu_question(clarification["question"]):
        clarification = {**clarification, "kind": "scope", "question": CHECK_QUESTION}
    if clarification:
        required = [{"field": "expected_outcome", "question": clarification["question"]}] + [
            q for q in required if q["field"] != "expected_outcome"]
    required_fields = {q["field"] for q in required}
    prior = pending_goal(data)
    latest = next((m["text"] for m in reversed(data.get("messages", [])) if m.get("role") == "user"), "")
    completed = bool(data.get("new_reply") and goal_completion_reply(latest))
    resolved = bool(goal and not clarification and "expected_outcome" not in required_fields)

    def still_needed(question: dict) -> bool:
        if question["field"] != "expected_outcome" or not resolved:
            return True
        # A usable goal answers the generic menu. An explicit answer clears that
        # pending question, not every possible logistical clarification. A deliberate
        # 'that is all' may end optional goal refinement, never required scope/location.
        if scope_menu_question(question["question"]):
            return not explicit_scope_goal(goal)
        if generic_goal_question(question["question"]) or completed:
            return False
        return not (prior and normal(question["question"]).casefold() == normal(prior["question"]).casefold())

    # A nonempty draft is not proof that the goal is clear. Keep the model's
    # targeted goal questions instead of silently turning them into readiness.
    optional = sorted([q for q in result["questions"] if q["field"] not in required_fields and still_needed(q)],
                      key=lambda q: q["field"] != "expected_outcome")
    result["questions"] = (required + optional)[:4]
    goal_question = next((q for q in result["questions"] if q["field"] == "expected_outcome"), None)
    if goal_question and not clarification:
        if scope_menu_question(goal_question["question"]):
            goal_question["question"] = CHECK_QUESTION
            clarification = {"kind": "scope", "goal": goal, "question": CHECK_QUESTION}
        else:
            clarification = {"kind": "model" if goal else "missing", "goal": goal,
                             "question": goal_question["question"]}
    result["goal_clarification"] = clarification
    result["goal_choices"] = choices_for(clarification)
    if goal and not clarification:
        result["goal_choices"] = [{"label": "Use this conditional rescue goal" if conditional_goal(goal) else (goal if len(goal) <= 100 else "Select this rescue goal"),
                                   "reply": goal, "kind": "goal"}]
    result["ready"] = not result["questions"] and bool(result["location"] and goal and result["animal_type"])
    if result["ready"]:
        result["understanding"] = "Review your goal in the confirmation summary below. Nobody has been contacted."
    elif completed and clarification and choices_for(clarification):
        result["understanding"] = ("You do not need to add more description. Choose one type of help below "
                                   "so we can prepare the right goal. Nobody has been contacted.")
    elif clarification and clarification["kind"] == "revision":
        result["understanding"] = "Let's refine the goal together before confirming it. Nobody has been contacted."
    elif clarification and clarification["kind"] == "scope":
        result["understanding"] = "The kind of check still needs to be clarified. Nobody has been contacted."
    elif clarification and clarification["kind"] == "model":
        result["understanding"] = "Let's clarify what help you want before confirming the goal. Nobody has been contacted."
    elif goal and not clarification:
        result["understanding"] = "Your rescue goal is clear. We still need the details below before you can confirm. Nobody has been contacted."
    else:
        result["understanding"] = "We still need to clarify the details below. Nobody has been contacted."
    latest_user = next((m["text"] for m in reversed(data.get("messages", [])) if m.get("role") == "user"), "")
    safety_inputs = [latest_user] if data.get("new_reply") else texts + [report.get("expected_outcome", "")]
    if goal and normal(goal).casefold() != normal(report.get("expected_outcome", "")).casefold():
        safety_inputs.append(goal_source)  # also acknowledge an aside discarded during old-draft recovery
    result["safety_notice"] = SAFETY_NOTICE if any(unsafe_request(t) for t in safety_inputs) else ""
    result["conditional_goal"] = conditional_goal(goal)
    result["scope_note"] = ("This is one goal with conditional steps. Confirming saves the whole goal; finding help and approving helpers and prices remain separate. An unknown assessment result is not a 'no'."
                            if conditional_goal(goal) else "")
    if goal and conditional_goal(goal) and not clarification:
        result["understanding"] = "Your goal includes both outcomes, and neither needs to be chosen in advance. Review the complete goal below. Nobody has been contacted."
    if outside_scope:
        result["understanding"] = "Restaurant orders are outside this app's animal-welfare services. Nobody has been contacted."
        question = "What animal-welfare concern should the helpers address?"
        result["questions"] = [{"field": "expected_outcome", "question": question}] + [q for q in result["questions"] if q["field"] != "expected_outcome"]
        result["goal_clarification"] = {"kind": "missing", "goal": "", "question": question}
        result["goal_choices"] = []
    return result


INSTRUCTION = """Read an animal-welfare report and the reporter's chat. This step NEVER contacts responders.
Understand what 'rescue' means to this user. Read the WHOLE conversation. Separate requested
help from observations, proximity/ownership answers, jokes, unsafe/sexual remarks, and irrelevant details.
An answer to a question about the reporter's current activity NEVER replaces an already stated rescue goal.
Change a goal only on an explicit new request or correction. Summarize intent, not the latest message.
A filled expected_outcome is a DRAFT, not proof that the user is satisfied or that the scope is clear.
Feedback such as 'this can be improved', 'not what I meant', or 'make it more specific' requests
refinement, not confirmation and not a new animal-welfare goal. Acknowledge the feedback and ask one
focused question about what to change. Preserve the old draft until the user supplies a clearer outcome.
'Check him out' and 'check him up' can be ambiguous when no other context defines the desired outcome.
Use the full conversation first. Ask a focused question only if the intended help remains genuinely unclear;
observation, veterinary assessment and transport are not interchangeable, nor an exhaustive menu.
Read goal_clarification when present: this is an unanswered question about the current draft.
A bare 'yes', 'not sure', or a status update does not answer a multiple-choice scope question.
Interpret short answers using the actual preceding question. For example, 'yes checking on him'
answers the welfare-check option: draft safe observation and a report, not treatment or transport.
A reply may contain both a legitimate request and an inappropriate aside. Keep the independent
animal-welfare request; exclude the inappropriate action and explain the boundary without repeating it.
Do not discard a safe answer just because another clause is inappropriate.
Do not reopen details already settled or repeat a question that the latest reply has answered.
'That is all', 'that is it', and 'that's it' end optional refinement of an actionable goal. It is not a new goal, not an answer to
an unresolved scope choice, and not permission to contact anyone. Keep truly necessary location or
animal-type questions separate; never erase a clear goal while clarifying those details.
Only ask essential questions. A nonempty draft may need a targeted expected_outcome question, but a
clear user-defined or reasonably inferred success criterion must not be blocked by a repeated menu.
Use neutral clinical wording for anatomical concerns; never discard a medical concern just for slang.
Do not repeat sexual/harmful asides as goals or instructions. Redirect to legitimate animal-welfare help.
Preserve conditions such as 'take it to a vet ONLY IF assessment finds it necessary' as part of ONE
valid goal. IF/THEN/ELSE, otherwise, unless and only-if describe a decision policy, not a missing
answer. 'Assess him; if a clinic is needed transport him, otherwise feed him' is actionable when
aligned with the report and app mission. Preserve assessment, the trigger, both branches and all
exclusions. Do not replace it with assessment-only or unconditional transport, or force a choice
between those services. The future assessment result need not be known to confirm the goal.
A qualified responder, not this model or the reporter guessing, evaluates a medical condition.
Unknown is neither true nor false. Approval can cover the complete conditional plan and its price
limits; a branch inside that approved scope does not need a replacement goal. No work is started
at intake. Ask a targeted question only when the intended condition or outcome is genuinely unclear.
An old goal_clarification of kind conditional may be the obsolete forced-stage menu; do not repeat it.
Do not turn veterinary assessment into a neighbor simply watching. Do not infer a diagnosis.
 An injury is not consent to assume a full rescue, transport,
clinic visit or medical treatment. Ask brief, targeted questions when their desired outcome or logistics
are unclear. Do not always say 'got it'. Do not diagnose or give animal-handling instructions.
Return no more than 4 questions; prioritize desired outcome, usable location, animal type, and crucial
logistical ambiguity. Do not ask for a budget unless the reporter raises cost; it is optional.
Unknown animal type is acceptable when the user explicitly cannot tell. Never invent an address, species,
reported observation or desired outcome. Proposed filled fields must have exact supporting user quotes;
leave genuinely missing fields empty. The user reviews and confirms the form before any calls.
Use this schema: {"understanding":"...","location":"...","animal_type":"...","expected_outcome":"...",
"location_quote":"...","animal_quote":"...","outcome_quote":"...",
"questions":[{"field":"location|animal_type|expected_outcome|situation","question":"..."}]}.
Questions are empty only when the rescue goal is clear. Do not include ready; the server computes it."""


INSTRUCTION += "\n" + SEMANTIC_INSTRUCTION
