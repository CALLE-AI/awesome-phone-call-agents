"""Conservative English rescue-intent guards; not a general semantic classifier.

Chat observations must not become work orders merely because they contain 'watch'.
A configured model still interprets language, but known unsafe/status-only text and
conditional transport cannot silently become a confirmed unconditional goal.
"""
from __future__ import annotations

import re

CARE = r"\b(?:vet|vets|veterinary|veterinarian|clinic|hospital|shelter|care)\b"
MOVE = r"\b(?:take|taking|taken|bring|transport|transportation|drive|ride|pickup|pick[ -]up|move|moving)\b"
CHECK = r"\b(?:check|checking|assess|assessment|examine|examination|look at|look over)\b"
MEDICAL = r"\b(?:injur\w*|wound\w*|bleed\w*|swollen|swelling|pain\w*|sick|ill|genital\w*|testicl\w*|scrot\w*|balls|medical|veterinary|vet|veterinarian)\b|what(?:'s| is|s)? wrong"
CONDITION = r"\b(?:if|only if|unless|depending on|when necessary|when needed|as needed|as necessary|subject to|provided that|only when)\b"
STATUS_ONLY = re.compile(
    r"^(?:(?:yes|no|right now|currently)[, ]+)?(?:i(?:'m| am)?|we(?:'re| are)?|i have|we have)\s+"
    r"(?:(?:still|just|only|closely|currently|already|safely)\s+)*"
    r"(?:watch(?:ing)?|observ(?:e|ing)|monitor(?:ing)?|look(?:ing)?|standing|stand|wait(?:ing)?|"
    r"stay(?:ing)?|with\b|near\b|at\b|left\b|leaving\b|like\b|love\b|see\b|saw\b|noticed\b)", re.I)
REQUEST = re.compile(
    r"\b(?:i (?:want|need|would like)|we (?:want|need|would like)|please|could you|can you|"
    r"can someone|could someone|can somebody|could somebody|someone to|somebody to|"
    r"(?:can|could) (?:a |an |the )?(?:vet|veterinarian|veterinary professional|helper|responder)|"
    r"send (?:a|an|someone)|arrange|goal\s*:|successful rescue|help me get)\b", re.I)
ACTION_START = re.compile(
    r"^(?:(?:actually|instead|then|and|just|only|safely)\s+)*"
    r"(?:feed|feeding|check|observe|watch|monitor|assess|examine|take|bring|transport|pickup|pick[ -]up|"
    r"get|rescue|move|remove|secure|contain|catch|free|keep an eye|look at)\b", re.I)
SCOPE_QUESTION = (
    "You asked for assessment before deciding about transport. Which should we arrange now: "
    "an on-site veterinary assessment first (no transport yet), or pickup and transport to a vet "
    "for assessment? Transport after a later assessment needs a new plan and your approval."
)
WELFARE_CHECK_GOAL = (
    "Arrange for someone to observe the animal from a safe distance and report back; no handling or transport."
)
SAFETY_NOTICE = (
    "This service arranges animal-welfare assistance only. Harmful or sexual actions are not "
    "included in a rescue goal; the request stays focused on appropriate care."
)


def normal(text: str) -> str:
    return ' '.join((text or '').replace('’', "'").split())


def goal_revision_request(text: str) -> bool:
    """Recognize feedback about the draft, not a replacement rescue instruction.

    Deliberately narrow English fallback. A model may ask further questions for
    other wording, but a recognized revision must never be auto-confirmed.
    """
    t = normal(text).casefold()
    return bool(re.search(
        r"\b(?:improve|refine|revise|reword|rephrase|clarify|change|edit|amend)\s+"
        r"(?:(?:this|that|the|my|our|rescue|current|proposed)\s+)*(?:goal|outcome|wording|summary|plan|it|this|that)\b|"
        r"\b(?:this|that|it|(?:(?:this|that|the|my|our|current|proposed) )?(?:goal|wording|summary|outcome))\s+(?:(?:can|could|should|needs? to)\s+be\s+|needs?\s+)"
        r"(?:improv\w*|refin\w*|revis\w*|reword\w*|rephras\w*|clarif\w*|chang\w*|better|clearer|more specific|less vague)\b|"
        r"\bmake\s+(?:this|that|it|the goal)\s+(?:more specific|clearer|better|less vague)\b|"
        r"\b(?:not|isn't|is not|wasn't|was not)\s+(?:quite\s+)?what i (?:meant|want(?:ed)?|asked for)\b|"
        r"\b(?:(?:do not|don't) confirm(?: (?:this|that|it|the goal))?(?: yet)?|not ready to confirm)\b|"
        r"\b(?:goal|wording|summary|this|that)\s+(?:is |sounds? |seems? )?(?:too vague|unclear|wrong|not right)\b|"
        r"^(?:(?:yeah|yes|no|hmm|well)[, .!]+)?(?:no|nope|not really|not quite|not exactly|let's rethink(?: (?:this|it))?|"
        r"help me (?:decide|work (?:this|it) out))[.!? ]*$", t))


def ambiguous_check_goal(text: str) -> bool:
    """'Check him out/up' does not identify observation vs veterinary assessment.

    Keep established, explicit 'check on ... / report back' goals compatible.
    This is a guard for vague wording, not a diagnosis from the observations.
    """
    t = normal(text)
    vague = re.search(
        r"\bcheck(?:ing)?\s+(?:him|her|it|them|(?:the |a )?(?:animal|dog|cat|bird|puppy|kitten))\s+(?:out|up)\b|"
        r"\bcheck(?:ing)?\s+(?:out|up)\s+(?:him|her|it|them|(?:the |a )?(?:animal|dog|cat|bird|puppy|kitten))\b|"
        r"\b(?:get|have)\s+(?:him|her|it|them|the animal|the dog|the cat)\s+checked(?: out| up)?\b|"
        r"^(?:please |just )?(?:check|look at|look over)\s+(?:him|her|it|them)[.!? ]*$", t, re.I)
    # Negated scope does not by itself tell us which positive service is wanted.
    positive = ' '.join(re.split(r"\b(?:do not|don't|without|no|not)\b", part, maxsplit=1, flags=re.I)[0]
                        for part in re.split(r'[.;]|\bbut\b', t, flags=re.I))
    specific = re.search(
        MEDICAL + '|' + CARE + '|' + MOVE +
        r"|\b(?:observe|observation|watch|monitor|report|update|distance|visually|visual|welfare check|"
        r"contain|secure|out of danger|off the road)\b", positive, re.I)
    return bool(vague and not specific)


def unsafe_request(text: str) -> bool:
    """Target first-person/requested conduct, NOT an animal licking itself or anatomical terms."""
    text = normal(text).casefold()
    # Quoted observations about the animal are not the human action being requested.
    sexual = re.search(
        r"\b(?:i|we)\b[^.!?;]{0,100}\b(?:my|our)\s+(?:tongue|tounge)\b|"
        r"\b(?:i|we)\s+(?:(?:am|are|will|might|want to|would like to|can|may|could|also)\s+){0,4}"
        r"(?:lick|licking|assist\b[^.!?;]{0,50}\blick)|"
        r"\b(?:sex(?:ual)?|masturbat\w*|bestiality)\b[^.!?;]{0,80}\b(?:animal|dog|cat|him|her|it)\b|"
        r"\b(?:please|help me|i want (?:you )?to)\s+(?:lick|sexually)\b", text)
    # Requested nominal/imperative conduct can omit "I". Keep animal self-grooming
    # and veterinary descriptions out of this rule: anatomy alone is not unsafe.
    human_clause = (
        r"(?:^|[,;]|\b(?:and|but|also|plus)\s+)\s*"
        r"(?:(?:yes|yeah|maybe|perhaps|also|please|might|can you|could you|help me|"
        r"i (?:am|will|might|want to|would like to))\s+)*"
    )
    nominal = re.search(human_clause + r"(?:"
        r"(?:give|giving)\s+(?:him|her|it|them|his|her|its|the (?:animal|dog|cat)(?:'s)?)"
        r"[^.!?;]{0,65}\b(?:a|one)\s+(?:(?:hard|good|long|quick)\s+)?lick\b|"
        r"(?:lick|licking)\s+(?:his|her|its|the (?:animal|dog|cat)(?:'s)?)\s+"
        r"(?:balls|testicles|genitals|genital area|penis|vulva|anus)\b|"
        r"(?:assist|help)\s+(?:him|her|it|the animal|the dog|the cat)\s+"
        r"(?:in\s+)?lick(?:ing)?\b)", text)
    harm = re.search(
        r"\b(?:please|i want (?:you )?to|i will|i'll|help me)\s+"
        r"(?:hurt|torture|poison|kick|beat|abuse)\b", text)
    return bool(sexual or nominal or harm)


def user_clauses(text: str) -> list[str]:
    """Separate an unsafe aside without discarding an independent welfare request.

    Do not generally split at 'and': doing so can drop transport conditions or
    negations. Split a conjunction/comma only when a component is independently
    recognized as unsafe. Used by both intake and downstream context filtering.
    """
    parts = re.split(r'(?<=[.!?;])\s+|\s+and (?=i\b|we\b)', normal(text), flags=re.I)
    result = []
    for part in parts:
        pieces = re.split(r'(\s+(?:and|but|also|plus)\s+|,\s*)', part, flags=re.I)
        unsafe = [unsafe_request(c) for c in pieces[::2]]
        if not any(unsafe):
            result.append(part)
            continue
        # Keep adjacent safe components together, including their conjunctions:
        # 'check ... and report back' must not lose its reporting requirement.
        group, previous = pieces[0], unsafe[0]
        for index, bad in enumerate(unsafe[1:], start=1):
            if bad == previous:
                group += pieces[2 * index - 1] + pieces[2 * index]
            else:
                result.append(group)
                group = pieces[2 * index]
            previous = bad
        result.append(group)
    return [part.strip() for part in result if part.strip()]


def safe_reply(text: str) -> str:
    """Safe clauses only; raw user messages stay intact in the draft transcript."""
    return ' '.join(part for part in user_clauses(text) if not unsafe_request(part))


def welfare_check_fragment(text: str) -> bool:
    """Recognize an elliptical answer, not 'I am checking' or a medical request.

    Call only in a goal field or when answering a goal question. In narrative
    observations these words alone are not authorization for any work.
    """
    t = normal(text).casefold().strip(' .!?')
    return bool(re.fullmatch(
        r"(?:(?:yes|yeah|yep|okay|ok|sure)[, ]+)?(?:(?:just|only) )?"
        r"(?:(?:someone|somebody) (?:to )?)?"
        r"(?:check(?:ing)? on (?:him|her|it|them|(?:the |a )?(?:animal|dog|cat|puppy|kitten))|"
        r"(?:a )?welfare check|(?:a )?check on (?:him|her|it|them|the animal|the dog|the cat))"
        r"(?: (?:and )?report(?:ing)? back)?(?:[,;]? please)?", t))


def goal_completion_reply(text: str) -> bool:
    """An explicit end to refinement, NOT a replacement goal or call approval."""
    return bool(re.fullmatch(
        r"(?:(?:yes|yeah|okay|ok)[, ]+)?(?:that(?: is|'s) (?:all|it)(?: i (?:want|need))?|"
        r"nothing else|no more changes|keep (?:it|the goal) (?:as is|unchanged))"
        r"[.! ]*", normal(text), re.I))


def conditional_goal(text: str) -> bool:
    """Recognize common conditional wording without treating it as ambiguity.

    Meaning is assessed by the model. This limited English guard just prevents a
    known IF/ELSE constraint from disappearing in a paraphrase or a flat plan.
    """
    return bool(re.search(CONDITION + r"|\b(?:otherwise|else|depending upon)\b", normal(text), re.I))


def has_else_branch(text: str) -> bool:
    return bool(re.search(r"\b(?:otherwise|else|if not|if (?:it is |it's )?not needed)\b", normal(text), re.I))


def conditional_transport(text: str) -> bool:
    t = normal(text)
    if not (re.search(MOVE, t, re.I) and re.search(CARE, t, re.I)):
        return False
    # Recognize assessment-triggered escalation, not an unrelated condition such
    # as a clinic's opening hours or a driver's availability.
    trigger = (r"\b(?:need(?:ed|s)?|necessary|injur\w*|wound\w*|bleed\w*|pain\w*|"
               r"sick|ill|assessment|assessor|examination)\b|"
               r"\b(?:vet|professional|responder|doctor)\b.{0,35}\b(?:recommend\w*|find\w*|say\w*)\b")
    return any(re.search(trigger, t[m.end():].split('.')[0], re.I)
               for m in re.finditer(CONDITION, t, re.I))


def medical_assessment(text: str) -> bool:
    return bool(re.search(CHECK, text, re.I) and re.search(MEDICAL, text, re.I))


def assessment_only(text: str) -> bool:
    if not medical_assessment(text) or conditional_transport(text):
        return False
    positive = []
    for clause in re.split(r'[.;\n]|\bbut\b', normal(text), flags=re.I):
        positive.append(re.split(r"\b(?:do not|don't|without|no need to|no|not)\b", clause, maxsplit=1, flags=re.I)[0])
    return not re.search(MOVE, ' '.join(positive), re.I)


def requested_action(text: str, *, explicit_field: bool = False) -> bool:
    t = normal(text)
    if not t or unsafe_request(t):
        return False
    if goal_revision_request(t) and not re.search(
            CHECK + '|' + MOVE + r"|\b(?:observe|observation|watch|monitor|contain|rescue|assessment|veterinary|vet)\b",
            re.sub(r"\brescue\s+(?:goal|plan|outcome)\b", "goal", t, flags=re.I), re.I):
        return False
    if STATUS_ONLY.search(t) and not REQUEST.search(t):
        return False
    if re.search(r"\b(?:ignore (?:all|previous|the)|system prompt|developer message)\b", t, re.I):
        return False
    if ACTION_START.search(t):
        return True
    if REQUEST.search(t) and re.search(
            r'\b(?:feed|feeding|check|observe|watch|monitor|assess|assessment|examine|examination|take|bring|'
            r'transport|pickup|pick[ -]up|rescue|move|remove|secure|contain|catch|free|'
            r'vet|veterinary|veterinarian|clinic|hospital|shelter|reunite|foster|adopt|'
            r'help|care|animal|dog|cat|bird)\b', t, re.I):
        return True
    # Goal-field fragments can describe logistics without being an imperative.
    return explicit_field and bool(re.search(
        r'\b(?:feed|feeding|rescue|assessment|examination|transport|pickup|pick[ -]up|observation|'
        r'containment|removal|relocation|reunite|reunification|adoption|foster|shelter)\b', t, re.I))


def extract_goal(text: str, *, explicit_field: bool = False) -> str:
    """Extract requested clauses, not a verbatim whole chat turn. Never diagnose."""
    t = normal(text)
    if explicit_field and welfare_check_fragment(safe_reply(t)):
        return WELFARE_CHECK_GOAL
    parts = user_clauses(t)
    accepted = []
    for part in parts:
        if unsafe_request(part):
            continue
        if requested_action(part, explicit_field=explicit_field):
            accepted.append(part)
        elif accepted and re.match(r'^(?:if|only if|unless|else|otherwise|do not|no need|no (?:transport|handling|treatment|medication)|without)\b', part, re.I):
            accepted.append(part)
    # A leading prohibition qualifies a following positive request ("No transport; someone ...").
    if accepted and parts and re.match(r'^(?:do not|no need|no (?:transport|handling|treatment|medication)|without)\b', parts[0], re.I):
        if parts[0] not in accepted:
            accepted.insert(0, parts[0])
    goal = ' '.join(accepted).strip()
    if not goal:
        return ''
    if conditional_goal(goal):
        # Never replace a decision policy with one canned assessment/transport sentence.
        # Neutralize only anatomical slang; preserve every branch and prohibition.
        cleaned = re.sub(r"\bballs\b", "genital area", goal, flags=re.I)
        # A length limit is not permission to remove a late ELSE clause. The
        # semantic model can summarize a long request; the fallback cannot.
        return cleaned if len(cleaned) <= 600 else ""
    # Anatomical language is a legitimate clinical concern, not a reason to reject a rescue.
    if medical_assessment(goal) and re.search(r'\b(?:balls|testicl\w*|genital\w*|scrot\w*)\b', goal, re.I):
        if re.search(MOVE, goal, re.I) and re.search(CARE, goal, re.I):
            return 'Arrange safe pickup and transport to a vet for assessment of the reported genital concern.'
        return 'Arrange an on-site veterinary assessment of the reported genital concern; no transport yet.'
    return goal[:600]


def stage_choice(text: str, previous_goal: str) -> str:
    """Recognize an explicit scope revision, never infer consent from task order."""
    if not conditional_transport(previous_goal) or unsafe_request(text):
        return ''
    t = normal(text).casefold()
    if conditional_goal(t):
        return ''
    if re.search(
            r'\b(?:assess(?:ment)? only|only (?:an? )?(?:on[ -]site (?:veterinary )?)?assessment|no transport yet)\b', t):
        return 'Arrange an on-site veterinary assessment of the reported concern first; no transport yet.'
    if re.search(MOVE, t) and re.search(CARE, t) and not conditional_goal(t):
        return 'Arrange safe pickup and transport to a vet for assessment of the reported concern.'
    return ''


def goal_problem(goal: str) -> str:
    from intake_semantics import obvious_non_welfare_goal
    if obvious_non_welfare_goal(goal):
        return "Restaurant orders are outside this application's animal-welfare rescue services."
    if unsafe_request(goal):
        return 'This saved goal contains an inappropriate requested action. Review a corrected animal-welfare goal before any inquiries or approval callbacks.'
    if STATUS_ONLY.search(normal(goal)) and not extract_goal(goal):
        return 'This saved goal describes the reporter\'s activity, not the help being requested. Create a corrected report before further inquiries or approval callbacks.'
    if ambiguous_check_goal(goal):
        return 'Clarify whether the goal is observation and a report, on-site veterinary assessment, or transport for assessment before any inquiries or approval callbacks.'
    return ''


def welfare_context(incident: dict) -> str:
    """Keep original history saved; send only relevant, non-unsafe clauses downstream.

    This narrow rule filter is defense in depth, not a universal abuse detector.
    Intake is the only model phase that needs to read the raw clarification chat.
    """
    import json
    texts = [incident.get('summary', '')]
    try:
        messages = json.loads(incident.get('conversation_json') or '[]')
        texts += [m['text'] for m in messages if m.get('role') == 'user' and isinstance(m.get('text'), str)]
    except (ValueError, TypeError, AttributeError):
        pass
    kept = []
    for text in texts:
        for part in user_clauses(text):
            if unsafe_request(part) or re.search(r"\bi (?:like|love) (?:looking|watching)\b", part, re.I):
                continue
            if re.search(r'\b(?:ignore (?:all|previous)|system prompt|developer message)\b', part, re.I):
                continue
            part = re.sub(r'\bballs\b', 'genital area', part, flags=re.I)
            if part and part not in kept:
                kept.append(part)
    return ' '.join(kept)[:4000] or 'The reporter requested animal-welfare assistance; observations need clarification.'
