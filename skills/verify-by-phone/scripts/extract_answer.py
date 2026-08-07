#!/usr/bin/env python3
"""Extract a span-grounded answer from a CALL-E terminal payload.

Standard library only. Reads the payload saved by poll_result.py, walks the
transcript turns, and emits one JSON object per claim with the verbatim
supporting span and character offsets, or an explicit abstention. Hedged
answers keep their polarity at a dampened trust score. Non-responsive turns
(wrong number, refusal, call-back deflections) never count as answers.

This is a self-contained copy of the reference extractor in backend/app of the
source repository. It is not kept in sync by hand: tests/test_skill_parity.py
runs both extractors over the same transcripts and fails if they disagree on
the answer, the span, or the cue lexicons.
"""

from __future__ import annotations

import argparse
import json
import re

from gate import abstains, class_scores

YES_CUES = (
    r"\byes\b",
    # guard the same way for the other agreement cues
    r"\byeah\b",
    r"\byep\b",
    r"\babsolutely\b",
    r"\bcorrect\b",
    r"\bdefinitely\b",
    # "we are not taking" must never read as agreement: without the
    # lookahead this matched inside a refusal and won the tie-break.
    r"\bwe are\b(?!\s+not\b)",
    r"\bsure are\b",
    r"\bof course\b",
)
NO_CUES = (
    # "no problem" / "no worries" / "not at all" are agreement, not refusal.
    # Without this guard "Sure, no problem, we are accepting new patients"
    # extracts a confident NO, which is the worst failure this system can
    # produce: a wrong answer delivered with a highlighted span.
    r"\bno\b(?!\s+(?:problem|worries|trouble|issue|doubt)\b)",
    r"\bnope\b",
    r"\bnot accepting\b",
    r"\bnot taking\b",
    r"\bnot at all\b(?=.*\baccept)",
    r"\bwe aren'?t\b",
    r"\bwe'?re not\b",
    r"\bunfortunately\b",
    r"\bfull\b",
    r"\bwaitlist\b",
    r"\bstopped\b",
)
# strength: 1.0 = strong hedge, 0.8 = belief-verb, 0.4 = mild softener.
HEDGES = (
    (r"\bnot sure\b", 1.0),
    (r"\bno idea\b", 1.0),
    (r"\bi guess\b", 1.0),
    (r"\bmaybe\b", 1.0),
    (r"\bmight\b", 1.0),
    (r"\bpossibly\b", 1.0),
    (r"\bi think\b", 0.8),
    (r"\bi believe\b", 0.8),
    (r"\bprobably\b", 0.8),
    (r"\bas far as i know\b", 0.8),
    (r"\bif i remember\b", 0.8),
    (r"\bpretty sure\b", 0.4),
    (r"\bshould be\b", 0.4),
    (r"\bi'?d say\b", 0.4),
)
DEAD_ENDS = (
    r"\bwrong number\b",
    r"\bresidence\b",
    r"\bwho is this\b",
    r"\bcall back\b",
    r"\bspeak to\b",
    r"\bnot comfortable\b",
    r"\bcan'?t answer\b",
    r"\bdon'?t know\b",
)
# Identity is tracked separately from DEAD_ENDS on purpose. A dead end makes one
# claim unanswerable; a denied identity invalidates the whole call as evidence
# about THIS listing, however cleanly the questions were answered. Numbers get
# reassigned, so a confident "yes, we're accepting patients" from whoever holds
# the number now says nothing about the practice in the directory.
IDENTITY_DENIALS = (
    r"\bwrong number\b",
    r"\bthis is a residence\b",
    r"\bno such (?:business|office|practice|clinic)\b",
    r"\bthere'?s no\b.*\bhere\b",
    r"\b(?:different|another) (?:office|business|practice|clinic|company)\b",
    r"\byou'?ve reached\b.*\b(?:instead|not)\b",
    r"\bwe'?re not\b.*\b(?:that|them)\b",
    # A respondent who says what they are gets taken at their word. An
    # answering service names the practice in a plain declarative sentence,
    # which the name rule read as the practice identifying itself, and these
    # are the exact cooperative-but-not-the-listing parties this gate exists
    # to exclude.
    r"\banswering service\b",
    r"\bmessage (?:service|cent(?:er|re))\b",
    r"\bcall cent(?:er|re)\b",
)
# What an identity question from the agent looks like. Its own script asks
# "Is this the office of {org}?" first, before any claim question, so a bare
# affirmative counts as identity only after a construction from this list that
# also named the listing in the same turn.
_IDENTITY_QUESTION = re.compile(
    r"\bis this\b|\bis that\b|\bhave i reached\b|\bdid i reach\b|\bhave we reached\b"
    r"|\bam i speaking\b|\bconfirm (?:that )?(?:i|we) (?:have )?reached\b"
    r"|\bconfirm (?:that )?this is\b"
)
CLAIM_PATTERNS = {
    "accepting_new_patients": r"accepting new patients",
    # Word-bounded on purpose: "accepting" must NOT trigger this claim, or a
    # new-patients answer gets mis-attributed to the insurance question.
    "accepts_plan": r"\baccepts?\b|\btakes?\b.*\b(?:plan|insurance)\b|\bin[- ]network\b",
}
DAMPEN = 0.55  # app.hedge.MAX_DAMPEN
CONTRADICTION_SCORE = 0.25


def turns_from_payload(payload: dict) -> list[dict]:
    for recipient in payload.get("recipients", []):
        for attempt in recipient.get("attempts", []):
            turns = attempt.get("transcript_turns")
            if turns:
                return list(turns)
    return []


# A negation immediately before the organization's name flips a mention from
# confirmation into denial. Scoped to a short window BEFORE the name rather than
# applied to the whole turn, because "Yes, this is Example Family Medicine, not
# the Buckhead office" contains a negation and is still a confirmation.
_NEGATION = r"\b(?:no|not|isn'?t|aren'?t|ain'?t|never|wrong|different|another)\b"
_NEGATION_WINDOW = 40
# An explicit correction states who WAS reached: "No, this is Buckhead Clinic".
# It must win regardless of where the listing's name appears, before or after,
# because the window alone is position-dependent: "Example Family Medicine?
# No, this is Buckhead Clinic" opens with the name, nothing precedes it, and a
# before-the-name check reads the echo as an affirmative mention. The
# corrected-to identity decides the direction: naming somebody else is a
# denial; naming the listing itself ("No, this is Example Family Medicine",
# correcting a mispronunciation) is a confirmation.
_CORRECTION = re.compile(
    r"\b(?:no|nope)\b[^a-z0-9]{0,3}"
    r"(?:this is|it'?s|you'?ve reached|we'?re|we are)\s+([^.?!;]{1,80})"
)
_CLAUSES = re.compile(r"[^.?!;]+[.?!;]?")
# A question identifies nobody. Exactly two things survive one, and they are
# the two the fifth review pass asked for: an unambiguous self-identifying
# greeting, which cannot itself be a question ("Thanks for calling Northside,
# how can I help you?"), and an actual affirmative response that states the
# name ("Yes, this is Northside, how can I help you?"). The introducing phrase
# is the discriminator, never punctuation inside the clause, because a tag
# question has a comma too and "Example Family Medicine, right?" used to read
# as a greeting on exactly that basis.
# Both are anchored to the start of the clause and must run all the way to the
# name, so the phrase has to be what the respondent is SAYING rather than
# something quoted or asked about inside it. Unanchored, "Did you say 'thanks
# for calling Northside'?" confirmed the listing, which is the same defect the
# comma had: a surface feature standing in for the speech act.
_COURTESY = r"(?:(?:good (?:morning|afternoon|evening)|hi|hello|hey)[^a-z0-9]{0,3}\s*)?"
_GREETING_ID = re.compile(
    r"^\W{0,4}" + _COURTESY + r"(?:thanks? for calling|thank you for calling|welcome to"
    r"|you'?ve reached|you have reached)\s+(?:the\s+)?$"
)
# "This is Example Family Medicine?" is still an echo, so a stated identity
# survives a question only as the direct continuation of an affirmative.
_STATED_ID = re.compile(
    r"^\W*(?:yes|yeah|yep|sure|absolutely|certainly|correct)\b[^a-z0-9]{0,3}\s*"
    r"(?:this is|it'?s|it is|we'?re|we are|you'?ve reached|you have reached"
    r"|thanks? for calling|thank you for calling|welcome to)\s+(?:the\s+)?$"
)
# Whether a clause is a question cannot rest on the question mark alone. That is
# the same kind of scope boundary the fourth pass was lost on: a transcript that
# arrives without punctuation would walk straight past it and every echo would
# read as a statement. Three independent signals instead.
_INTERROGATIVE_OPENER = re.compile(
    r"^\W*(?:is|are|am|was|were|do|does|did|can|could|would|will|should|have|has"
    r"|who|what|which|where|when|why|how)\b"
)
_TAG_QUESTION = re.compile(r"\b(?:right|correct)\W*$")


def _is_question(clause: str) -> bool:
    """Is this clause asking rather than asserting?"""
    stripped = clause.strip()
    return (
        stripped.endswith("?")
        or _INTERROGATIVE_OPENER.match(stripped) is not None
        or _TAG_QUESTION.search(stripped) is not None
    )


def _identifies_through_a_question(clause: str, name_start: int) -> bool:
    """Does this questioning clause still state who answered?

    Only the two forms the fifth review pass named. A greeting that cannot be
    a question ("Thanks for calling Northside, how can I help you?"), or an
    actual affirmative that states the name ("Yes, this is Northside, how can
    I help you?"). Everything else asked or echoed inside a question,
    including a bare name before a comma, establishes nothing.

    This asks only whether the clause CONFIRMS. A negation next to the name is
    decided before this is ever called, because the fail-closed direction never
    needs a punctuation argument: "We're not Northside, right?" is a denial
    whether or not it is phrased as a question.
    """
    lead_in = clause[:name_start]
    return _GREETING_ID.match(lead_in) is not None or _STATED_ID.match(lead_in) is not None


def _org_tokens(org: str) -> set[str]:
    """Words distinctive enough to identify the practice.

    Corporate suffixes and generic clinical nouns are dropped: matching "center"
    or "health" would confirm essentially any medical listing.
    """
    generic = {
        "the",
        "and",
        "of",
        "for",
        "llc",
        "inc",
        "pc",
        "pa",
        "llp",
        "group",
        "center",
        "centre",
        "clinic",
        "practice",
        "associates",
        "health",
        "healthcare",
        "medical",
        "medicine",
        "counseling",
        "counselling",
        "therapy",
        "wellness",
        "services",
        "care",
        "family",
        "partners",
    }
    return {w for w in re.findall(r"[a-z0-9]+", org.lower()) if len(w) > 2 and w not in generic}


def _name_mentions(lowered: str, tokens: set[str]) -> tuple[bool, bool]:
    """(mentioned_affirmatively, mentioned_under_negation) for one turn.

    A turn can do both, so both are reported and the caller decides. Denial
    wins, because an explicit "this is not X" must never be outvoted by an
    incidental affirmative-looking mention elsewhere in the same breath.

    Three rules, in order:
      - An explicit correction ("No, this is ...") is classified by WHO it
        names: somebody else denies, the listing itself confirms. This is
        deliberately position-independent, because the fourth review pass
        showed the window alone is not: "Example Family Medicine? No, this is
        Buckhead Clinic" opens with the name and nothing precedes it.
      - A name mention inside a question asserts nothing, and the only thing
        that survives a question is an explicit self-identification
        ("Thanks for calling Northside, how can I help you?"). The fifth
        review pass showed why the discriminator cannot be a comma:
        "Example Family Medicine, right?" has one and is an echo.
      - Otherwise the negation window before the name decides, per clause.
    """
    affirmative = negated = False
    consumed: list[tuple[int, int]] = []
    for cm in _CORRECTION.finditer(lowered):
        tail = cm.group(1)
        hit: re.Match[str] | None = None
        for tok in tokens:
            found = re.search(rf"\b{re.escape(tok)}\b", tail)
            if found is not None and (hit is None or found.start() < hit.start()):
                hit = found
        if hit is None or re.search(_NEGATION, tail[: hit.start()]):
            negated = True
        else:
            affirmative = True
        consumed.append(cm.span(1))
    for clause_m in _CLAUSES.finditer(lowered):
        clause = clause_m.group(0)
        is_question = _is_question(clause)
        for tok in tokens:
            for m in re.finditer(rf"\b{re.escape(tok)}\b", clause):
                if any(a <= clause_m.start() + m.start() < b for a, b in consumed):
                    continue
                # Negation first, and regardless of whether the clause is a
                # question. Gating this on the question test made
                # "We're not Northside Family Medicine, right?" report neither
                # denial nor confirmation, losing a denial the previous version
                # caught, and let one greeting outvote an explicit denial later
                # in the same breath. Denial is the fail-closed direction and
                # never needs a punctuation argument.
                prefix = clause[max(0, m.start() - _NEGATION_WINDOW) : m.start()]
                if re.search(_NEGATION, prefix):
                    negated = True
                    continue
                if is_question and not _identifies_through_a_question(clause, m.start()):
                    # The respondent is asking or echoing, not identifying:
                    # "Example Family Medicine?", "Example Family Medicine,
                    # right?", "Example Family Medicine, is that who I
                    # reached?" and "Example Family Medicine, what do you
                    # want?" all name the listing and establish nothing about
                    # who answered. A bare name in a greeting is now
                    # unconfirmed rather than confirmed, which is the
                    # fail-closed direction and the one this tool exists for.
                    continue
                affirmative = True
    return affirmative, negated


def organization_denied(turns: list[dict], org: str | None = None) -> bool:
    """Did the respondent say we reached somewhere other than the listing?

    Answering this is a precondition for treating anything said on the call as
    directory evidence, not a detail. If the number now belongs to someone
    else, a clean "yes, we are accepting new patients" is a true statement
    about the wrong organization, and recording it against the listing would
    manufacture exactly the false confirmation this tool exists to prevent.

    Three ways to deny. The fixed cue list catches "wrong number" and friends.
    The second, added after review, catches a NEGATED mention of the
    organization's own name: "No, this is not Example Family Medicine" matched
    no cue, and the name tokens inside it then made confirmation return True,
    so an explicit denial was read as a confirmation. That is worse than
    fail-open, it is inverted. The third, added on the fourth review pass,
    catches a CORRECTION naming somebody else: "Example Family Medicine? No,
    this is Buckhead Clinic" has no negation before the name, so the window
    misses it, and the correction must win wherever the name sits in the turn.
    """
    tokens = _org_tokens(org) if org else set()
    for turn in turns:
        if turn.get("speaker") == "bot":
            continue
        lowered = str(turn.get("text", "")).lower()
        if any(re.search(cue, lowered) for cue in IDENTITY_DENIALS):
            return True
        if tokens:
            _, negated = _name_mentions(lowered, tokens)
            if negated:
                return True
    return False


def organization_confirmed(turns: list[dict], org: str | None) -> bool:
    """Did the respondent positively confirm they represent the named listing?

    Absence of a denial is not confirmation. The agent opens by naming the
    organization, so a respondent who simply starts answering questions has
    established nothing: wrong numbers, answering services, shared reception
    desks and reassigned lines all produce cooperative respondents who are not
    the listing. Attributing their answers to the listing is how a verification
    tool manufactures a false confirmation.

    Confirmation requires one of two things from a USER turn:
      - the organization's own distinctive name, STATED rather than asked and
        not under negation: "Northside, this is the front desk", "Thanks for
        calling Northside, how can I help you?". Anything the respondent asks
        or echoes establishes nothing, whether or not it carries a comma
        ("Example Family Medicine?", "Example Family Medicine, right?"), and a
        correction ("No, this is Example Family Medicine") counts by what it
        names, or
      - an explicit affirmative answering an identity question that the agent
        actually asked AND that named this listing.

    Generic pleasantries deliberately do not count. "Hello", "how can I help
    you", and "sure" are what any human says on any phone.

    **Denial or correction always wins, wherever it appears in the turn.**
    Checked first and for the whole call, because "No, this is not Example
    Family Medicine" contains the name and used to return True here, and
    "Example Family Medicine? No, this is Buckhead Clinic" put the name BEFORE
    the correction, where a before-the-name negation window cannot see it. An
    explicit denial read as a confirmation is worse than fail-open: it is
    inverted, and it would attribute a later answer to a party that had just
    told us they are not the listing.

    Without --org there is nothing to confirm against, so this returns False
    and every claim abstains. That is the fail-closed direction on purpose.
    """
    if not org:
        return False
    if organization_denied(turns, org):
        return False
    tokens = _org_tokens(org)
    asked_identity = False
    for turn in turns:
        text = str(turn.get("text", ""))
        lowered = text.lower()
        if turn.get("speaker") == "bot":
            # A bare affirmative only confirms identity if it ANSWERS an
            # identity question. Tracking which question the agent last asked is
            # the whole difference between a real check and a decorative one:
            # an earlier version accepted "Yes, we are." as confirmation, which
            # is the ordinary way to answer "are you accepting new patients",
            # so every cooperative respondent confirmed themselves. Both halves
            # are required for the same reason: a bare "confirm" matched "can
            # you confirm you are accepting new patients", and naming the
            # listing anywhere in a turn that happened to hold a question mark
            # matched the disclosure itself, so either one alone re-opened the
            # decorative check with extra steps.
            asked_identity = _IDENTITY_QUESTION.search(lowered) is not None and any(
                re.search(rf"\b{re.escape(t)}\b", lowered) for t in tokens
            )
            continue
        # Saying the practice's own distinctive name is confirmation on its own,
        # unprompted, and is how a staffed front desk actually answers. Only an
        # UN-negated mention counts: organization_denied already rejected the
        # whole call on a negated one, and this keeps the two consistent.
        affirmative, negated = _name_mentions(lowered, tokens)
        if negated:
            return False
        if affirmative:
            return True
        if asked_identity and re.match(
            r"\W*(?:yes|yeah|yep|correct|speaking|that'?s right|that'?s us|it is|sure is)\b",
            lowered,
        ):
            return True
    return False


def last_span(cues: tuple[str, ...], text: str) -> tuple[int, int] | None:
    """The LAST cue occurrence of this polarity in the turn.

    Last, not first, because the documented rule is to trust the final clear
    statement. Taking the first occurrence made a refusal that opens with
    "Unfortunately no, we are full" lose the tie-break to the "we are" that
    appears later, and be served as a confident yes.
    """
    lowered = text.lower()
    best: tuple[int, int] | None = None
    for cue in cues:
        for match in re.finditer(cue, lowered):
            if best is None or match.start() > best[0]:
                best = (match.start(), match.end())
    return best


def apply_gate(result: dict, qhat: float | None) -> dict:
    """Attach the abstention decision to an extracted answer.

    Fails closed on purpose. Without a calibrated threshold there is no
    coverage guarantee to answer behind, so an uncalibrated run abstains on
    everything and says so, rather than substituting a threshold that sounds
    reasonable and guarantees nothing. Run calibrate.py and pass its qhat.
    """
    if qhat is None:
        return {**result, "abstain": True, "gate": "uncalibrated"}
    scores = class_scores(result["answer"], result["trust_score"])
    return {
        **result,
        "abstain": abstains(scores, result["answer"], qhat),
        "gate": f"conformal(qhat={qhat:.3f})",
    }


def extract(
    turns: list[dict],
    claim: str,
    question_pattern: str,
    other_question_patterns: tuple[str, ...] = (),
) -> dict:
    """Read one claim's answer out of the transcript.

    The answer window OPENS when the agent asks this claim's question and
    CLOSES when the agent asks a different one. Both halves matter. Without the
    close, the window ran to the end of the call, so on a two-question call the
    reply to the second question was also counted as the answer to the first.
    A respondent who said "I'd have to look into that one" about new patients
    and later "Yes, we take that plan" about insurance had the new-patients
    claim reported as a confident yes, span-grounded to a sentence that is
    plainly about insurance. A wrong answer carrying a citation is worse than
    no answer, because the citation is what invites belief.

    Pass the other claims' patterns so the boundary can be recognised. Bot
    turns that ask nothing tracked (acknowledgements, hold requests) leave the
    window open.
    """
    question_seen = False
    combined_turn = False
    yes_hits: list[tuple[int, str, int, int]] = []
    no_hits: list[tuple[int, str, int, int]] = []
    hedge_strength = 0.0
    dead_end = False

    for index, turn in enumerate(turns):
        text = str(turn.get("text", ""))
        lowered = text.lower()
        if turn.get("speaker") == "bot":
            if re.search(question_pattern, lowered):
                # Both questions in ONE turn makes the reply un-attributable.
                # "Are you accepting new patients, and do you take Example PPO?"
                # answered "Yes." opens both claims' windows on the same reply,
                # and the old code handed that single "Yes." to both claims,
                # each with the same span. One of those is very likely wrong and
                # both look identically confident. There is no way to split it
                # after the fact, so the honest move is to abstain and let the
                # call conduct keep the questions separate in the first place.
                if any(re.search(other, lowered) for other in other_question_patterns):
                    combined_turn = True
                # Re-asking this claim reopens rather than closes the window.
                question_seen = True
            elif question_seen and any(
                re.search(other, lowered) for other in other_question_patterns
            ):
                # The agent moved on. Everything after this answers that
                # question, not this one.
                break
            continue
        if not question_seen:
            continue
        if any(re.search(cue, lowered) for cue in DEAD_ENDS):
            # A dead-end turn ("wrong number", "you'd have to call back") is
            # non-responsive: polarity words inside it are not answers.
            dead_end = True
            continue
        for pattern, strength in HEDGES:
            if re.search(pattern, lowered):
                hedge_strength = max(hedge_strength, strength)
        yes_span = last_span(YES_CUES, text)
        if yes_span:
            yes_hits.append((index, text, yes_span[0], yes_span[1]))
        no_span = last_span(NO_CUES, text)
        if no_span:
            no_hits.append((index, text, no_span[0], no_span[1]))

    hedged = hedge_strength > 0

    def unknown(score: float) -> dict:
        return {
            "claim": claim,
            "answer": "unknown",
            "trust_score": score,
            "hedged": hedged,
            "span": None,
        }

    if combined_turn:
        # Checked before every other outcome, including a clean single "Yes.":
        # a confident-looking answer is exactly what this case produces, and it
        # is exactly what must not be served.
        return {**unknown(0.5), "combined_question": True}
    if dead_end and not yes_hits and not no_hits:
        return unknown(0.85)
    if yes_hits and no_hits:
        # Contradiction: trust the LAST clear statement, at a low score, and
        # tie-break by character offset so a same-turn correction
        # ("Yes... actually no") trusts the final statement.
        final = max(yes_hits + no_hits, key=lambda hit: (hit[0], hit[2]))
        answer = "yes" if final in yes_hits else "no"
        score = CONTRADICTION_SCORE
        index, text, start, end = final
    elif yes_hits or no_hits:
        hits = yes_hits or no_hits
        answer = "yes" if yes_hits else "no"
        score = min(0.9 + 0.02 * (len(hits) - 1), 0.98) * (1.0 - DAMPEN * hedge_strength)
        index, text, start, end = hits[0]
    else:
        return unknown(0.6)

    return {
        "claim": claim,
        "answer": answer,
        "trust_score": round(score, 3),
        "hedged": hedged,
        "span": {"turn": index, "text": text, "char_start": start, "char_end": end},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", required=True, help="JSON file from poll_result.py")
    parser.add_argument(
        "--org",
        default=None,
        help=(
            "Organization name as listed, the same value passed to "
            "place_verify_call.py. Required for any claim to be answered: "
            "without it identity cannot be confirmed and every claim abstains."
        ),
    )
    parser.add_argument(
        "--qhat",
        type=float,
        default=None,
        help="calibrated conformal threshold from calibrate.py. Without it every "
        "claim abstains, because an uncalibrated gate guarantees nothing.",
    )
    args = parser.parse_args()
    with open(args.payload, encoding="utf-8") as handle:
        payload = json.load(handle)
    turns = turns_from_payload(payload)

    # A call with no transcript is the single most common real outcome: nobody
    # picked up, or it went to voicemail and the agent correctly left nothing.
    # Exiting with an error there was wrong twice over. It broke every caller
    # downstream, including reconcile_record.py, on the ordinary case rather
    # than an exceptional one. And a tool whose entire claim is that it emits an
    # explicit abstention when it learns nothing must emit that record LOUDEST
    # when it learned nothing at all. Silence is a result, not a failure.
    if not turns:
        for claim in CLAIM_PATTERNS:
            print(
                json.dumps(
                    {
                        "claim": claim,
                        "answer": "unknown",
                        "trust_score": 0.0,
                        "hedged": False,
                        "span": None,
                        "abstain": True,
                        "gate": "no-transcript",
                        "organization_confirmed": False,
                        "organization_denied": False,
                    }
                )
            )
        return

    # Computed once for the call, not per claim: identity is a property of who
    # answered the phone, not of any one question.
    denied = organization_denied(turns, args.org)
    confirmed = organization_confirmed(turns, args.org)
    for claim, pattern in CLAIM_PATTERNS.items():
        others = tuple(p for name, p in CLAIM_PATTERNS.items() if name != claim)
        record = apply_gate(extract(turns, claim, pattern, others), args.qhat)
        record["organization_confirmed"] = confirmed
        record["organization_denied"] = denied
        # Fail CLOSED on identity. Detecting an explicit denial is not enough:
        # absence of a denial is not confirmation, and a directory answer is
        # only evidence about the listing if we know we reached the listing.
        if record.pop("combined_question", False):
            record.update(answer="unknown", span=None, abstain=True, gate="combined-question")
        if denied or not confirmed:
            gate = "identity-denied" if denied else "identity-unconfirmed"
            record.update(answer="unknown", span=None, abstain=True, gate=gate)
        print(json.dumps(record))


if __name__ == "__main__":
    main()
