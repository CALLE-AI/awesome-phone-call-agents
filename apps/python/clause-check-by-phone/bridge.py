# -*- coding: utf-8 -*-
"""From a written clause to a spoken question.

This module turns one finding produced by a page auditor, the condition an
offer sets quietly, into two things, a natural-language call task and the
schema of the answer expected back.

It places no call, opens no socket and knows no key, which is the point. Code
whose execution costs a real phone call cannot be developed by running it.

THE RULE THAT GOVERNS THIS FILE. Never make someone repeat on the phone what
the page already says. A call is worth placing only if its answer can
CONTRADICT the page. A question whose two possible answers both leave the
matter where it stood is a question you do not ask, because it costs a
stranger their time.
"""
from __future__ import annotations
import re

# The clause families worth a call, and the question that tests each one.
FAMILIES = {
    "prize not cash": (
        "whether the advertised award is paid in money, and if not, what it "
        "actually consists of",
        {"paid_in_money": ["yes", "no", "unknown"]},
    ),
    "advancement costs money": (
        "whether reaching the next stage costs the participant anything, and "
        "how much",
        {"cost_to_advance": ["none", "there is one", "unknown"]},
    ),
    "video required": (
        "whether a video hosted on an outside platform is required, or whether "
        "a file can be sent directly",
        {"third_party_video": ["required", "avoidable", "unknown"]},
    ),
    "students only": (
        "whether someone who is not a student may take part",
        {"open_to_non_students": ["yes", "no", "unknown"]},
    ),
    "country restricted": (
        "which countries of residence are accepted",
        {"country_accepted": ["yes", "no", "unknown"]},
    ),
    "team required": (
        "whether a single person may take part alone",
        {"alone_allowed": ["yes", "no", "unknown"]},
    ),
}

# The answer that CANCELS the clause, per family. Anything else, including
# `unknown`, is not a contradiction.
CANCELS = {
    "prize not cash": "yes",
    "advancement costs money": "none",
    "video required": "avoidable",
    "students only": "yes",
    "country restricted": "yes",
    "team required": "yes",
}


class NothingToAsk(Exception):
    """Raised when no call is justified. This is not an error."""


def readable(quote: str, limit: int = 220) -> str:
    """A quotation fit to be SPOKEN, and the word spoken changes the rule.

    Text meant for the eye tolerates a broken character, a reader skips it. A
    speech engine does not skip it, it pronounces it or stumbles. Seen on a
    real page, a quotation ended with a multiplication sign, the remains of a
    close icon flattened into the text. It is perfectly printable, so a filter
    on printability keeps it, and it would have gone into someone's ear.
    """
    t = quote or ""
    t = t.replace("�", " ")
    t = "".join(c for c in t if c.isprintable() or c in " \t\n")
    t = re.sub(r"\s+", " ", t).strip()
    while t and not (t[-1].isalnum() or t[-1] in ').”"%'):
        t = t[:-1]
    t = t.strip()
    if len(t) > limit:
        t = t[:limit].rsplit(" ", 1)[0] + "..."
    return t


def call_task(phone: str, family: str, quote: str, source: str) -> dict:
    """Return the call task and the result schema for ONE clause.

    `phone` is in international form. It is never logged and never returned
    anywhere except inside the task, which is the only place the provider
    needs it.
    """
    if family not in FAMILIES:
        raise NothingToAsk("unknown family, %r, no call is justified" % family)
    if not readable(quote):
        raise NothingToAsk("no quotation, nothing to have confirmed out loud")
    if not re.match(r"^\+\d{7,15}$", phone or ""):
        raise NothingToAsk("invalid phone number, a call needs a recipient")

    question, fields = FAMILIES[family]
    name, values = next(iter(fields.items()))
    task = (
        "Call {phone}. Speak the language of the person who answers. Say plainly "
        "that this is an automated call placed by a software agent on behalf of "
        "someone considering their offer, and that it will take under a minute. "
        "Then ask one question and only one, {question}. For context, their "
        "published page says, quote, {quote}, unquote. Do not argue, do not "
        "sell, do not ask anything else. Thank them and hang up."
    ).format(phone=phone, question=question, quote=readable(quote))

    schema = {
        "type": "object",
        "required": [name],
        "additionalProperties": False,
        "properties": {
            name: {
                "type": "string",
                "enum": values,
                "description": ("What the person said. Use the last value when "
                                "the call did not produce enough evidence."),
            },
            "their_words": {
                "type": "string",
                "description": "The person's own words on that single point, if any.",
            },
        },
    }
    return {"task": task, "result_schema": schema,
            "source": source, "family": family, "quote": readable(quote)}


def contradiction(prepared: dict, answer: dict) -> str | None:
    """Say whether the voice contradicts the page, and nothing else.

    Returns None when there is no contradiction, which is the common case and
    a perfectly good result.
    """
    if not answer:
        return None
    name = prepared["result_schema"]["required"][0]
    said = (answer.get(name) or "").strip().lower()
    if said and said == CANCELS.get(prepared["family"]):
        return ("The page says, quote, %s, unquote. On the phone they said the "
                "opposite. Their words, %s"
                % (prepared["quote"], answer.get("their_words") or "not recorded"))
    return None
