"""Detect the two ways an email reply can look like an answer without being one.

A. UNCLEAR_CHOICE      you offered options; they agreed without naming one.
B. VAGUE_COMMITMENT    you asked for something; they agreed without saying what or when.

These are rules, not a model. Rules are deterministic, run offline with no API
key, and can be read by a reviewer who wants to know exactly what fires. An
optional model pass can widen recall later; it cannot replace the audit trail.

Every finding carries the exact sentences it was derived from, because the user
is about to approve a phone call on the strength of it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict

from .thread import Thread, spoken_text, split_sentences

# --- vocabulary --------------------------------------------------------------

WEEKDAYS = {
    "monday": ("mon",), "tuesday": ("tue", "tues"), "wednesday": ("wed", "weds"),
    "thursday": ("thu", "thur", "thurs"), "friday": ("fri",),
    "saturday": ("sat",), "sunday": ("sun",),
}

MONTHS = ("january february march april may june july august september october "
          "november december jan feb mar apr jun jul aug sep sept oct nov dec").split()

# "yes" in its many costumes. Matched as whole phrases against the reply.
AFFIRMATIVE = (
    "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "fine by me", "fine",
    "sounds good", "sounds great", "works for me", "that works", "works",
    "i'll be there", "ill be there", "i will be there", "see you there",
    "see you then", "confirmed", "absolutely", "perfect", "great", "no problem",
    "count me in", "happy to", "of course",
)

# Agreement to *do* something, as opposed to agreement that something is true.
COMMITMENT = (
    "will do", "on it", "consider it done", "i'll send", "ill send", "i'll get",
    "ill get", "we'll send", "well send", "i'll share", "ill share", "i'll do",
    "i'll have", "we'll have", "i'll get it done", "leave it with me",
    "i'll sort", "we'll sort", "i'll look", "ill look", "i'll take care",
    "we'll take care", "sure thing",
)

# Words that promise a time without naming one. Their presence is the clearest
# signal that a commitment is unspecific.
VAGUE_TIME = (
    "soon", "shortly", "asap", "in a bit", "later today", "later", "in due course",
    "sometime", "some time", "when i can", "when i get a chance", "end of day",
    "eod", "in a while", "right away", "straight away", "next chance",
)

# Asking for something to be done.
REQUEST = (
    "can you", "could you", "would you", "will you", "are you able to",
    "please send", "please share", "please confirm", "please review",
    "please get", "do you mind", "any chance you", "let me know",
    "send me", "share the", "confirm the", "get me",
)

_TIME = re.compile(r"\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b", re.IGNORECASE)
_DATE_ORDINAL = re.compile(r"\b\d{1,2}(st|nd|rd|th)\b", re.IGNORECASE)
_DATE_NUMERIC = re.compile(r"\b\d{1,4}[/-]\d{1,2}([/-]\d{1,4})?\b")
_NUMBER = re.compile(r"\b\d+\b")
_RELATIVE_DAY = re.compile(r"\b(today|tomorrow|tonight|this morning|this afternoon|this evening)\b", re.IGNORECASE)

_STOPWORD_EDGE = {
    "the", "a", "an", "on", "at", "in", "to", "for", "is", "are", "do", "does",
    "we", "you", "i", "it", "that", "this", "be", "would", "should", "could",
    "either", "or", "and", "if", "prefer", "rather", "better", "works", "work",
}


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9' ]+", " ", text.lower()).strip()


def _contains_phrase(haystack: str, phrases) -> str:
    """Return the first phrase present as a whole word/phrase, else ''."""
    padded = f" {_norm(haystack)} "
    for phrase in phrases:
        if f" {phrase} " in padded:
            return phrase
    return ""


# A phone number is digits, but it is not a date, a time or a quantity. Without
# this, "Will do." followed by an undelimited signature number reads as a
# specific commitment and the finding is silently lost -- which is how the bug
# hid: every test fixture used a "--" delimited signature, which is stripped
# before analysis.
_PHONE_SHAPED = re.compile(r"\+?[0-9][0-9 ()\-.]{6,20}[0-9]")


def _has_specifics(text: str) -> bool:
    """Does this text name a concrete time, date, or quantity?"""
    text = _PHONE_SHAPED.sub(" ", text or "")
    if _TIME.search(text) or _DATE_ORDINAL.search(text) or _DATE_NUMERIC.search(text):
        return True
    if _RELATIVE_DAY.search(text):
        return True
    low = _norm(text)
    for day, aliases in WEEKDAYS.items():
        if re.search(rf"\b({day}|{'|'.join(aliases)})\b", low):
            return True
    for month in MONTHS:
        if re.search(rf"\b{month}\b", low):
            return True
    return bool(_NUMBER.search(text))


# --- option extraction -------------------------------------------------------

def extract_options(question: str) -> list[str]:
    """Pull the offered alternatives out of a question.

    Tried in order of reliability: named weekdays, clock times, then a generic
    split on " or ". Returns [] when nothing convincing is found, which means
    no finding is raised -- silence is the correct output when we cannot say
    what the options were.
    """
    low = _norm(question)

    days = [day.capitalize() for day in WEEKDAYS if re.search(rf"\b{day}\b", low)]
    if len(days) >= 2:
        return days

    times = [m.group(0).strip() for m in _TIME.finditer(question)]
    if len(times) >= 2:
        return _dedupe(times)

    if " or " not in low:
        return []

    # Generic: take the words either side of " or ", trimmed of edge stopwords.
    left, _, right = question.rpartition(" or ")
    left_side = _trim_phrase(left.split(",")[-1], from_end=True)
    right_side = _trim_phrase(right, from_end=False)
    options = [o for o in (left_side, right_side) if o]
    return options if len(options) == 2 else []


def _trim_phrase(text: str, *, from_end: bool, width: int = 4) -> str:
    words = [w for w in re.split(r"\s+", re.sub(r"[?!.,;:]+", " ", text).strip()) if w]
    if not words:
        return ""
    chunk = words[-width:] if from_end else words[:width]
    # Cut back to the last determiner so the phrase starts where its own noun
    # phrase starts, rather than trailing the verb's other object.
    determiners = {"the", "a", "an", "my", "our", "your", "their", "this", "that"}
    positions = [i for i, w in enumerate(chunk) if _norm(w) in determiners]
    if positions and positions[-1] > 0:
        chunk = chunk[positions[-1]:]
    while chunk and _norm(chunk[0]) in _STOPWORD_EDGE:
        chunk = chunk[1:]
    while chunk and _norm(chunk[-1]) in _STOPWORD_EDGE:
        chunk = chunk[:-1]
    return " ".join(chunk).strip()


def _dedupe(items: list[str]) -> list[str]:
    seen, out = set(), []
    for item in items:
        key = _norm(item)
        if key and key not in seen:
            seen.add(key)
            out.append(item)
    return out


def names_an_option(reply: str, options: list[str]) -> str:
    """Return the option the reply actually names, or '' if it names none."""
    low = f" {_norm(reply)} "
    for option in options:
        key = _norm(option)
        if not key:
            continue
        if f" {key} " in low:
            return option
        aliases = WEEKDAYS.get(key, ())
        for alias in aliases:
            if f" {alias} " in low:
                return option
    return ""


# --- findings ----------------------------------------------------------------

@dataclass
class Finding:
    kind: str                 # unclear_choice | vague_commitment
    confidence: str           # high | medium
    asked_index: int
    replied_index: int
    question: str             # the exact sentence we read as the ask
    reply: str                # the exact sentence we read as the non-answer
    options: list[str]
    headline: str             # one line for the UI
    call_question: str        # the single question the call must resolve
    source: str = "rules"     # rules | model — shown to the user, never trusted blindly

    def to_dict(self) -> dict:
        return asdict(self)


def _question_sentences(text: str) -> list[str]:
    return [s for s in split_sentences(text) if "?" in s]


def detect(thread: Thread) -> list[Finding]:
    findings: list[Finding] = []
    for ask in thread.messages:
        if not ask.from_me:
            continue
        reply = _next_reply(thread, ask.index)
        if reply is None:
            continue
        findings.extend(_unclear_choice(ask, reply))
        findings.extend(_vague_commitment(ask, reply))

    # Latest first: the freshest unresolved thing is the one worth a call.
    findings.sort(key=lambda f: (-f.replied_index, f.kind))
    return _one_per_reply(findings)


def _next_reply(thread: Thread, after_index: int):
    for message in thread.messages[after_index + 1:]:
        if not message.from_me:
            return message
    return None


def _unclear_choice(ask, reply) -> list[Finding]:
    ask_text = spoken_text(ask.body)
    reply_text = spoken_text(reply.body)
    if not reply_text:
        return []

    # Options are often stated in one sentence and the question asked in the
    # next: "We can start Monday or Tuesday. Which works for you?" Look inside
    # the question sentences first, then across the whole message -- but only
    # when the message asks something, so a passing mention of two days in a
    # statement cannot raise a finding.
    candidates = [(q, extract_options(q)) for q in _question_sentences(ask_text)]
    if _question_sentences(ask_text) and not any(opts for _, opts in candidates):
        for sentence in split_sentences(ask_text):
            options = extract_options(sentence)
            if len(options) >= 2:
                candidates.append((sentence, options))
                break

    for question, options in candidates:
        if len(options) < 2:
            continue
        if names_an_option(reply_text, options):
            continue  # they answered; nothing to repair
        affirmative = _contains_phrase(reply_text, AFFIRMATIVE)
        if not affirmative:
            continue
        if "?" in reply_text:
            continue  # they asked something back; that is a live conversation
        return [Finding(
            kind="unclear_choice",
            confidence="high" if len(options) == 2 else "medium",
            asked_index=ask.index,
            replied_index=reply.index,
            question=question.strip(),
            reply=split_sentences(reply_text)[0],
            options=options,
            headline=f"They agreed without saying which: {' or '.join(options)}",
            call_question=f"Which one did you mean, {' or '.join(options)}?",
        )]
    return []


def _vague_commitment(ask, reply) -> list[Finding]:
    ask_text = spoken_text(ask.body)
    reply_text = spoken_text(reply.body)
    if not reply_text or not ask_text:
        return []

    requested = _contains_phrase(ask_text, REQUEST)
    if not requested:
        return []
    committed = _contains_phrase(reply_text, COMMITMENT) or _contains_phrase(reply_text, AFFIRMATIVE)
    if not committed:
        return []
    if _has_specifics(reply_text):
        return []  # they named a date, time or quantity
    if "?" in reply_text:
        return []

    vague = _contains_phrase(reply_text, VAGUE_TIME)
    ask_sentence = next(
        (s for s in split_sentences(ask_text) if _contains_phrase(s, REQUEST)),
        split_sentences(ask_text)[0],
    )
    return [Finding(
        kind="vague_commitment",
        confidence="high" if vague else "medium",
        asked_index=ask.index,
        replied_index=reply.index,
        question=ask_sentence.strip(),
        reply=split_sentences(reply_text)[0],
        options=[],
        headline="They agreed, but named no date",
        call_question="What date should we expect it by?",
    )]


def _one_per_reply(findings: list[Finding]) -> list[Finding]:
    """At most one finding per reply. One call resolves one ambiguity."""
    seen, out = set(), []
    for finding in findings:
        if finding.replied_index in seen:
            continue
        seen.add(finding.replied_index)
        out.append(finding)
    return out
