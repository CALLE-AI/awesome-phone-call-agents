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
        # CONTEXT IS MANDATORY HERE, AND ONLY HERE. Without the country the
        # question goes out open-ended and the field comes back binary, and
        # nobody can connect the two. See CONTEXT_REQUIRED.
        "whether someone who resides in {country} may take part",
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


# Families whose question means nothing without a piece of context.
# A question the extraction model cannot evaluate still gets an answer, and
# that answer is invented. Refusing to ask is cheaper than reading a fabricated
# result as if it were evidence.
CONTEXT_REQUIRED = {"country restricted": "country"}


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


def call_task(phone: str, family: str, quote: str, source: str,
              context: dict | None = None) -> dict:
    """Return the call task and the result schema for ONE clause.

    `phone` is in international form. It is never logged and never returned
    anywhere except inside the task, which is the only place the provider
    needs it.

    `context` carries the values some questions need in order to mean anything,
    see CONTEXT_REQUIRED. A family that asks for one and does not get it places
    NO call at all.
    """
    if family not in FAMILIES:
        raise NothingToAsk("unknown family, %r, no call is justified" % family)
    if not readable(quote):
        raise NothingToAsk("no quotation, nothing to have confirmed out loud")
    if not re.fullmatch(r"\+[1-9]\d{6,14}", phone or ""):
        raise NothingToAsk("invalid phone number, a call needs a recipient in "
                           "strict E.164 form")

    needed = CONTEXT_REQUIRED.get(family)
    if needed and not (context or {}).get(needed):
        raise NothingToAsk(
            "family %r needs the %r context, without it the question goes out "
            "open-ended and the answer comes back unusable" % (family, needed))

    question, fields = FAMILIES[family]
    if needed:
        question = question.format(**{needed: context[needed]})
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


# What the provider accepts inside a `result_schema`, and what it rejects.
# Taken from its own OpenAPI contract rather than from JSON Schema in general.
# The contract is explicit, unsupported features include `$ref`, `oneOf`,
# `anyOf`, `allOf`, recursive schemas, complex format validation and
# `additionalProperties: true`.
SCHEMA_SUPPORTED = {"type", "properties", "required", "enum", "items",
                    "description", "additionalProperties"}
SCHEMA_REJECTED = {"$ref", "oneOf", "anyOf", "allOf", "not", "patternProperties",
                   "format", "pattern", "minimum", "maximum"}
RESERVED_NAMES = {"summary", "status", "transcript", "call_id"}


def validate_result_schema(schema: dict, path: str = "$") -> list[str]:
    """Return the list of departures from the provider contract. Empty is good.

    WHY VALIDATE INSTEAD OF TRUSTING. A malformed schema is not rejected when
    the call is created. The call runs, the caller's time is spent, and the
    structured result comes back `null` once the call reaches a terminal state.
    You pay for the call and learn nothing. This moves the penalty to before
    the call, where it is free.

    Returns a list rather than raising, because a schema can have several
    faults and you want to see them all at once.
    """
    problems = []
    if not isinstance(schema, dict):
        return ["%s is not an object" % path]

    for key in schema:
        if key in SCHEMA_REJECTED:
            problems.append("%s.%s is rejected by the provider" % (path, key))
        elif key not in SCHEMA_SUPPORTED:
            problems.append("%s.%s is outside the supported set" % (path, key))

    if schema.get("type") == "object":
        if schema.get("additionalProperties") is not False:
            problems.append("%s must set additionalProperties to false" % path)
        properties = schema.get("properties") or {}
        if not properties:
            problems.append("%s is an object with no property" % path)
        for name, sub in properties.items():
            if name in RESERVED_NAMES:
                problems.append("%s.%s reuses a name the provider reserves" % (path, name))
            problems += validate_result_schema(sub, "%s.%s" % (path, name))
        for name in schema.get("required") or []:
            if name not in properties:
                problems.append("%s requires %r which is not declared" % (path, name))

    values = schema.get("enum")
    if values is not None:
        if not values:
            problems.append("%s has an empty enum" % path)
        elif not any(str(v).lower() in ("unknown", "inconnu") for v in values):
            # The provider contract recommends this in so many words. Without a
            # way to say nothing was learned, the extraction model has to pick
            # between yes and no when the call produced neither, and it will.
            problems.append("%s offers no way to say the call settled nothing" % path)
        if not schema.get("description"):
            problems.append("%s enumerates without explaining how to choose" % path)

    if schema.get("type") == "array" and "items" not in schema:
        problems.append("%s is an array without items" % path)
    return problems
