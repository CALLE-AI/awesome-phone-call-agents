from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal, Sequence

from ringdown.calls import Turn

Disposition = Literal["acknowledged", "declined", "unreachable", "wrong_person", "unclear"]

VOICEMAIL = (
    "leave a message",
    "after the tone",
    "after the beep",
    "you have reached",
    "answering machine",
    "unable to take your call",
    "deja tu mensaje",
    "deje su mensaje",
    "despues del tono",
    "despues de la senal",
    "buzon de voz",
    "contestador automatico",
)

WRONG_PERSON = (
    "wrong number",
    "you have the wrong",
    "there is nobody here by that name",
    "numero equivocado",
    "te equivocaste de numero",
    "se equivoco de numero",
    "aca no hay ningun",
    "no hay nadie con ese nombre",
)

DECLINE = (
    "not taking",
    "i am not on call",
    "i'm not on call",
    "not on call this week",
    "cannot take this",
    "can't take this",
    "i am not able to take",
    "someone else will have to",
    "no lo puedo tomar",
    "no puedo tomarlo",
    "no lo voy a tomar",
    "no estoy de guardia",
    "no me puedo hacer cargo",
    "que lo tome otro",
)

ACKNOWLEDGE = (
    "taking this incident",
    "i am taking this",
    "i'm taking this",
    "i am taking it",
    "i'm taking it",
    "i will take it",
    "i'll take it",
    "i have got it",
    "i've got it",
    "i am on it",
    "i'm on it",
    "i am picking this up",
    "i'm picking this up",
    "lo tomo yo",
    "me lo llevo",
    "lo estoy tomando",
    "lo tomo ahora",
    "me hago cargo",
    "yo me encargo",
    "lo agarro yo",
    "estoy con eso",
)

HEDGES = (
    "not sure",
    "i think",
    "maybe",
    "probably",
    "i'll try",
    "i will try",
    "try to",
    "if i can",
    "i guess",
    "hopefully",
    "no estoy seguro",
    "no estoy segura",
    "creo que",
    "tal vez",
    "capaz que",
    "voy a intentar",
    "si llego a",
    "si es que",
    "supongo que",
    "ojala",
)

CALLBACK = (
    "call me back",
    "call me again",
    "call me in",
    "call back in",
    "ring me back",
    "try me again",
    "try me in",
    "come back to me",
    "llamame en",
    "llamame de nuevo",
    "llamame mas tarde",
    "llamame dentro de",
    "volve a llamar",
    "volveme a llamar",
    "llama de nuevo",
)

NAME = r"[a-z][a-z'\-]+"

OWNER = (
    re.compile(rf"\b(?:this is|speaking with|soy|habla) ({NAME})"),
    re.compile(rf"\b({NAME}) speaking\b"),
)

ANSWERED_OWNER = re.compile(rf"\b(?:i am|i'm) ({NAME})(?:\s+{NAME})?\s*(?:[.,!?]|$)")

UNITS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19,
    "un": 1, "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
    "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "once": 11,
    "doce": 12, "trece": 13, "catorce": 14, "quince": 15, "dieciseis": 16,
    "diecisiete": 17, "dieciocho": 18, "diecinueve": 19,
    "veintiuno": 21, "veintidos": 22, "veintitres": 23, "veinticuatro": 24,
    "veinticinco": 25, "veintiseis": 26, "veintisiete": 27, "veintiocho": 28,
    "veintinueve": 29,
}

TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "veinte": 20, "treinta": 30, "cuarenta": 40, "cincuenta": 50, "sesenta": 60,
}


MINUTES = r"(?:minutes?|mins?|minutos?)"
ETA_QUESTION = re.compile(rf"(?:how many|en cuantos) {MINUTES}\b")
IDENTITY_QUESTION = re.compile(r"\b(?:am i speaking with|hablo con)\b")
DIGIT_ETA = re.compile(rf"(\d{{1,3}})\s*{MINUTES}\b")
WORD_ETA = re.compile(
    rf"\b({'|'.join([*TENS, *UNITS])})"
    rf"(?:[\s\-]+(?:y\s+)?({'|'.join(UNITS)}))?\s*{MINUTES}\b"
)
HALF_HOUR = re.compile(r"\b(?:half an hour|media hora)\b")
ONE_HOUR = re.compile(r"\b(?:(?:an|one) hour|una hora)\b")

NEGATION = re.compile(r"\b(?:no|not|nobody|wrong|nadie|equivocado|equivocada)\b")

HEDGE = re.compile(r"\b(?:" + "|".join(re.escape(hedge) for hedge in HEDGES) + r")\b")

OVERRIDE = re.compile(
    r"\b(?:ignore|disregard|forget|override|ignora|olvida|olvidate|desestima)\b[^.]{0,40}?"
    r"\b(?:previous|prior|earlier|above|all|your|the"
    r"|anterior|anteriores|previa|previas|previo|previos"
    r"|todo|toda|todos|todas|tu|tus|el|la|lo|los|las)\b[^.]{0,40}?"
    r"\b(?:instruction|instructions|prompt|rules|directives|guidelines"
    r"|instruccion|instrucciones|reglas|directivas)\b"
)

IMPERSONATION = re.compile(
    r"(?:\b(?:system|sistema)\s*:|\b(?:you are|you're) now\b|\bahora (?:sos|eres)\b"
    r"|\b(?:new instructions|nuevas instrucciones)\b"
    r"|\bas (?:the|your) (?:admin|administrator|developer|operator|supervisor)\b"
    r"|\bcomo (?:el |tu )?(?:admin|administrador|desarrollador|operador|supervisor)\b)"
)

VERDICT_COMMAND = re.compile(
    r"\b(?:record|mark|log|report|register) (?:this|it|the call|the page) as "
    r"(?:acknowledged|acknowledge|ack|accepted|taken|handled|resolved|owned|done|complete)\b"
    r"|\bset the (?:verdict|eta|status|disposition)\b"
    r"|\b(?:marca|registra|anota|reporta|informa) (?:esto|esta llamada|el llamado) como "
    r"(?:reconocid[oa]|aceptad[oa]|tomad[oa]|atendid[oa]|resuelt[oa]|hech[oa])\b"
    r"|\b(?:pone|poner|setea|cambia) el (?:veredicto|estado)\b"
)

INJECTION = (OVERRIDE, IMPERSONATION, VERDICT_COMMAND)


@dataclass(frozen=True)
class Extraction:
    disposition: Disposition
    disposition_span: str
    owner_confirmed: str
    owner_span: str
    eta_minutes: int | None
    eta_span: str
    callback_minutes: int | None = None
    callback_span: str = ""
    hedge_span: str = ""


def normalise(text: str) -> str:
    folded = unicodedata.normalize("NFD", text.replace("’", "'").lower())
    stripped = "".join(c for c in folded if not unicodedata.combining(c))
    return " ".join(stripped.split())


def recipient_turns(turns: Sequence[Turn]) -> tuple[Turn, ...]:
    return tuple(turn for turn in turns if turn.speaker == "user")


def _first_matching(spoken: Sequence[tuple[Turn, str]], phrases: Sequence[str]) -> Turn | None:
    return next(
        (turn for turn, text in spoken if any(phrase in text for phrase in phrases)), None
    )


def _spoken(turns: Sequence[Turn]) -> tuple[tuple[Turn, str], ...]:
    return tuple((turn, normalise(turn.text)) for turn in recipient_turns(turns))


def _first_injection(spoken: Sequence[tuple[Turn, str]]) -> Turn | None:
    return next(
        (turn for turn, text in spoken if any(family.search(text) for family in INJECTION)), None
    )


def instructed(turns: Sequence[Turn]) -> bool:
    return _first_injection(_spoken(turns)) is not None


def minutes_in(text: str) -> int | None:
    return _minutes_in_normalised(normalise(text))


def _minutes_in_normalised(lowered: str) -> int | None:
    digits = DIGIT_ETA.search(lowered)
    if digits:
        return int(digits.group(1))
    words = WORD_ETA.search(lowered)
    if words:
        head, tail = words.group(1), words.group(2)
        base = TENS.get(head, UNITS.get(head, 0))
        if tail and head not in TENS:
            return None
        return base + UNITS.get(tail, 0) if head in TENS and tail else base
    if HALF_HOUR.search(lowered):
        return 30
    if ONE_HOUR.search(lowered):
        return 60
    return None


def _asked(turns: Sequence[Turn], question: re.Pattern[str]) -> int | None:
    return max(
        (
            index
            for index, turn in enumerate(turns)
            if turn.speaker == "bot" and question.search(normalise(turn.text))
        ),
        default=None,
    )


def find_eta(turns: Sequence[Turn]) -> tuple[int | None, str]:
    asked = _asked(turns, ETA_QUESTION)
    if asked is None:
        return None, ""
    for turn, text in _spoken(turns[asked + 1 :]):
        minutes = _minutes_in_normalised(NEGATION.split(text, 1)[0])
        if minutes is not None:
            return minutes, turn.text
    return None, ""


def find_commitment(spoken: Sequence[tuple[Turn, str]]) -> tuple[Turn | None, Turn | None]:
    hedged: Turn | None = None
    for turn, text in spoken:
        said = min((text.find(phrase) for phrase in ACKNOWLEDGE if phrase in text), default=None)
        if said is None:
            continue
        if NEGATION.search(text[:said]) or HEDGE.search(text):
            hedged = hedged or turn
            continue
        return turn, None
    return None, hedged


def find_callback(spoken: Sequence[tuple[Turn, str]]) -> tuple[int | None, str]:
    for turn, text in spoken:
        asked = min((text.find(phrase) for phrase in CALLBACK if phrase in text), default=None)
        if asked is None:
            continue
        minutes = _minutes_in_normalised(text[asked:])
        if minutes is not None and minutes >= 1:
            return minutes, turn.text
    return None, ""


def find_owner(turns: Sequence[Turn]) -> tuple[str, str]:
    asked = _asked(turns, IDENTITY_QUESTION)
    if asked is None:
        return "", ""
    for index, (turn, text) in enumerate(_spoken(turns[asked + 1 :])):
        for pattern in (*OWNER, ANSWERED_OWNER) if index == 0 else OWNER:
            found = pattern.search(text)
            if found and not NEGATION.search(text[: found.start()]):
                return found.group(1), turn.text
    return "", ""


def extract(turns: Sequence[Turn]) -> Extraction:
    spoken = _spoken(turns)
    owner, owner_span = find_owner(turns)
    eta_minutes, eta_span = find_eta(turns)

    for phrases, disposition in (
        (VOICEMAIL, "unreachable"),
        (WRONG_PERSON, "wrong_person"),
        (DECLINE, "declined"),
    ):
        turn = _first_matching(spoken, phrases)
        if turn is None:
            continue
        if disposition in ("unreachable", "wrong_person"):
            return Extraction(disposition, turn.text, "", "", None, "")
        return Extraction(disposition, turn.text, owner, owner_span, eta_minutes, eta_span)

    committed, hedged = find_commitment(spoken)
    if committed is not None:
        return Extraction(
            "acknowledged", committed.text, owner, owner_span, eta_minutes, eta_span
        )

    if not spoken:
        return Extraction("unreachable", "", "", "", None, "")
    callback_minutes, callback_span = find_callback(spoken)
    return Extraction(
        "unclear",
        "",
        owner,
        owner_span,
        eta_minutes,
        eta_span,
        callback_minutes,
        callback_span,
        hedged.text if hedged is not None else "",
    )
