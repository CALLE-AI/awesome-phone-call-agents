"""Interpretable counterpart features computed from a (possibly partial) transcript.

Four signal families, matching the DIALTONE detection design:
  timing      - response latency level and regularity, first-greeting delay
  interruption- overlaps / barge-ins and backchannels (humans do both, bots rarely)
  lexical     - formulaic phrasing, disfluencies, turn-length regularity, echoing
  structural  - IVR menu markers, verbatim repeats, self-disclosure

CALL-E exposes only turn *start* offsets, so turn ends are estimated from word
count (see models.speech_seconds). Every feature is cheap and explainable; the
classifier's weights on them are published in dialtone/model.json.
"""

from __future__ import annotations

import re
import statistics

from .models import Transcript, speech_seconds, words

DISCLOSURE_RE = re.compile(
    r"\b(virtual|digital|automated|ai|a\.i\.|artificial intelligence|voice)\s+(?:[a-z-]+\s+){0,2}(assistant|agent|receptionist|attendant|system|concierge|bot)\b"
    r"|\b(assistant|agent) (virtuel|vocal|automatique)\b|\bassistante? (virtuelle?|vocale?)\b"
    r"|\bi'?m an? (ai|bot|automated|virtual)\b|\bthis is an automated\b|\bautomated (system|service|line)\b",
    re.I,
)
IVR_RE = re.compile(
    r"\b(press|dial|enter)\s+(one|two|three|four|five|six|seven|eight|nine|zero|star|pound|the pound key|\d)\b"
    r"|\bpara espa[nñ]ol\b|\bmain menu\b|\blisten carefully\b|\bmenu options\b|\boptions have changed\b"
    r"|\byour call (is|may be) (very )?(important|recorded|monitored)\b|\bstay on the line\b|\bat the tone\b"
    r"|\bpound sign\b|\bfollowed by the pound\b|\bto repeat (these|this) (options|menu)\b|\bcurrent wait time\b"
    r"|\bplease hold\b|\bin a few words\b|\byou can say\b|\bnext available\b",
    re.I,
)
IVR_REJECT_RE = re.compile(
    r"\b(sorry,? i didn'?t (get|catch|understand) that|invalid (entry|selection|option)|i'?m sorry,? that is not a valid|let'?s try (that )?again)\b",
    re.I,
)
FORMULAIC_RE = re.compile(
    r"\b(i'?d be (happy|glad|delighted) to|is there anything else|how (can|may) i (help|assist)|thank you for calling"
    r"|i understand|certainly|absolutely|of course|great question|let me (check|look that up|pull that up)"
    r"|one moment(,)? (please|while)|i can help (you )?with that|thanks for (your patience|holding)|have a (great|wonderful) day"
    r"|just to confirm|to confirm,|you'?re all set|is that correct)\b",
    re.I,
)
DISFLUENCY_RE = re.compile(r"\b(u+m+|u+h+|e+r+m*|hmm+|mm+|you know|i mean|sort of|kinda|like,|e+u+h+|bah|hein|genre|du coup)\b", re.I)
FALSE_START_RE = re.compile(r"\b(\w+)[\s,.-]+\1\b|\w+-\s|—|\.\.\.", re.I)
BACKCHANNELS = {"mm-hmm", "mhm", "uh-huh", "yeah", "yep", "okay", "ok", "right", "sure", "yes", "mm", "uh", "hmm", "got it", "alright",
                "oui", "ouais", "daccord", "oui oui", "voil", "euh", "hm"}  # _norm strips accents/apostrophes: "voilà" -> "voil"
STOP = set("a an the to of and or for in on at is it i you we my your our this that be are was with do can please".split())

FEATURE_NAMES = [
    "first_user_delay",
    "first_turn_words",
    "latency_mean",
    "latency_std",
    "latency_regularity",
    "overlap_rate",
    "long_pause_rate",
    "backchannel_rate",
    "disfluency_rate",
    "formulaic_rate",
    "turn_words_mean",
    "turn_words_cv",
    "echo_overlap",
    "repeat_rate",
    "ivr_markers",
    "ivr_rejects",
    "dtmf_used",
    "disclosure",
]


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def _content(text: str) -> set[str]:
    return {w for w in _norm(text).split() if w not in STOP and len(w) > 2}


def latencies(t: Transcript) -> list[float]:
    """Estimated gap between the end of our turn and the start of the counterpart's reply."""
    gaps = []
    for prev, cur in zip(t.turns, t.turns[1:]):
        if prev.speaker == "bot" and cur.speaker == "user" and prev.offset_seconds is not None and cur.offset_seconds is not None:
            gaps.append(cur.offset_seconds - (prev.offset_seconds + speech_seconds(prev.text)))
    return gaps


def extract(t: Transcript) -> dict[str, float]:
    users = t.user_turns()
    user_text = " ".join(u.text for u in users)
    n = len(users)
    f = dict.fromkeys(FEATURE_NAMES, 0.0)
    if n == 0:
        return f

    first = next(i for i, turn in enumerate(t.turns) if turn.speaker == "user")
    first_turn = t.turns[first]
    # How long before the counterpart first spoke. Only meaningful if they spoke first.
    if first == 0 and first_turn.offset_seconds is not None:
        f["first_user_delay"] = min(first_turn.offset_seconds, 6.0)
    f["first_turn_words"] = min(len(words(first_turn.text)), 40) / 10

    gaps = latencies(t)
    if gaps:
        clipped = [max(-2.0, min(g, 6.0)) for g in gaps]
        f["latency_mean"] = statistics.fmean(clipped)
        if len(clipped) >= 2:
            f["latency_std"] = statistics.pstdev(clipped)
            # 1 when gaps are metronome-regular, ~0 when they scatter. Needs >=2 gaps.
            f["latency_regularity"] = 1.0 / (1.0 + 3.0 * f["latency_std"])
        f["overlap_rate"] = sum(g < -0.25 for g in gaps) / len(gaps)
        f["long_pause_rate"] = sum(g > 2.5 for g in gaps) / len(gaps)

    lengths = [len(words(u.text)) for u in users]
    f["backchannel_rate"] = sum(_norm(u.text) in BACKCHANNELS for u in users) / n
    total_words = max(sum(lengths), 1)
    f["disfluency_rate"] = min(
        (len(DISFLUENCY_RE.findall(user_text)) + len(FALSE_START_RE.findall(user_text))) / total_words * 10, 3.0
    )
    f["formulaic_rate"] = min(len(FORMULAIC_RE.findall(user_text)) / n, 2.0)
    f["turn_words_mean"] = min(statistics.fmean(lengths), 60) / 10
    if n >= 2 and statistics.fmean(lengths) > 0:
        f["turn_words_cv"] = min(statistics.pstdev(lengths) / statistics.fmean(lengths), 2.0)

    echoes = []
    for prev, cur in zip(t.turns, t.turns[1:]):
        if prev.speaker == "bot" and cur.speaker == "user":
            a, b = _content(prev.text), _content(cur.text)
            if a and b:
                echoes.append(len(a & b) / len(b))
    f["echo_overlap"] = statistics.fmean(echoes) if echoes else 0.0

    long_turns = [_norm(u.text) for u in users if len(words(u.text)) >= 4]
    if long_turns:
        f["repeat_rate"] = (len(long_turns) - len(set(long_turns))) / len(long_turns)

    f["ivr_markers"] = min(len(IVR_RE.findall(user_text)), 6) / 2
    f["ivr_rejects"] = min(len(IVR_REJECT_RE.findall(user_text)), 3)
    f["dtmf_used"] = float(any(turn.speaker == "bot" and "[DTMF" in turn.text.upper() for turn in t.turns))
    f["disclosure"] = float(bool(DISCLOSURE_RE.search(user_text)))
    return f


def vector(t: Transcript) -> list[float]:
    f = extract(t)
    return [f[name] for name in FEATURE_NAMES]
