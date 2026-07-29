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
import sys

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


def organization_denied(turns: list[dict]) -> bool:
    """Did the respondent say we reached somewhere other than the listing?

    Answering this is a precondition for treating anything said on the call as
    directory evidence, not a detail. If the number now belongs to someone
    else, a clean "yes, we are accepting new patients" is a true statement
    about the wrong organization, and recording it against the listing would
    manufacture exactly the false confirmation this tool exists to prevent.
    """
    for turn in turns:
        if turn.get("speaker") == "bot":
            continue
        lowered = str(turn.get("text", "")).lower()
        if any(re.search(cue, lowered) for cue in IDENTITY_DENIALS):
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
    yes_hits: list[tuple[int, str, int, int]] = []
    no_hits: list[tuple[int, str, int, int]] = []
    hedge_strength = 0.0
    dead_end = False

    for index, turn in enumerate(turns):
        text = str(turn.get("text", ""))
        lowered = text.lower()
        if turn.get("speaker") == "bot":
            if re.search(question_pattern, lowered):
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
    if not turns:
        sys.exit("ERROR: no transcript turns found in payload.")
    # Computed once for the call, not per claim: identity is a property of who
    # answered the phone, not of any one question.
    denied = organization_denied(turns)
    for claim, pattern in CLAIM_PATTERNS.items():
        others = tuple(p for name, p in CLAIM_PATTERNS.items() if name != claim)
        record = apply_gate(extract(turns, claim, pattern, others), args.qhat)
        record["organization_denied"] = denied
        if denied:
            # Whatever was said, it was not said by this listing. Abstain and
            # drop the span so nothing can be quoted as directory evidence.
            record.update(answer="unknown", span=None, abstain=True, gate="identity-unconfirmed")
        print(json.dumps(record))


if __name__ == "__main__":
    main()
