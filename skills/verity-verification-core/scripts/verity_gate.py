#!/usr/bin/env python3
"""Deterministic verification core for CALL-E phone tasks — parse + gate, no network.

This is a faithful, standard-library-only port of the safety-critical parts of the
Verity project: the transcript grammar (`parse_transcript`) and the Action Gate
(`decide`). It never contacts CALL-E, a phone provider, or the network. Given a call
snapshot and its transcript it returns ALLOW / BLOCK plus a reason and, on BLOCK, a
`repair_target` to confirm on a second channel.

The gate is fail-closed: any missing field or thrown error resolves to BLOCK, never
ALLOW. `task_completed == true` is necessary, never sufficient.

The bundled TypeScript app under `apps/typescript/verity-verification-core/` is the
reference implementation and uses Luxon for full timezone handling; this helper
resolves relative dates from the ISO date component of `call_created_at`, which is
equivalent for calls placed during business hours.
"""

from __future__ import annotations

import datetime as _dt
import re
from typing import Any

# ─────────────────────────────── grammar tables ───────────────────────────────

WEEKDAY = {
    "sunday": 7, "sun": 7, "monday": 1, "mon": 1, "tuesday": 2, "tue": 2, "tues": 2,
    "wednesday": 3, "wed": 3, "thursday": 4, "thu": 4, "thur": 4, "thurs": 4,
    "friday": 5, "fri": 5, "saturday": 6, "sat": 6,
}
MONTH = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12, "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7,
    "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}
NUMWORD = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
}

CORRECTION_CUE_RE = re.compile(
    r"\b(no wait|scratch that|actually|make it|sorry,? i meant|let'?s do .+ instead|change that to)\b",
    re.IGNORECASE,
)
AFFIRMATIVE_RE = re.compile(
    r"\b(yes|yep|yeah|yup|that works|works for me|that'?s right|correct|confirmed|"
    r"sounds good|see you then|perfect|great,? see you)\b",
    re.IGNORECASE,
)
NEGATION_START_RE = re.compile(r"^\s*(no|nope|not|nah)\b", re.IGNORECASE)
INTERROGATIVE_START_RE = re.compile(
    r"^\s*(is|are|can|could|would|will|do|does|did|what|when|which|how|any chance|got anything)\b",
    re.IGNORECASE,
)
TZ_CUE_RE = re.compile(
    r"\b(EST|EDT|PST|PDT|CST|CDT|MST|MDT|eastern|pacific|central time|mountain time|"
    r"America/[A-Za-z_]+|UTC|GMT)\b",
    re.IGNORECASE,
)


def _infer_meridiem(h: int) -> int:
    """Bare hour -> 24h, business-hours heuristic (09:00-17:00): 1-7 PM, 8-11 AM, 12 noon."""
    if h == 12:
        return 12
    if 1 <= h <= 7:
        return h + 12
    return h


def _hour_from_token(tok: str) -> int | None:
    t = tok.lower()
    if re.fullmatch(r"\d{1,2}", t):
        return int(t)
    return NUMWORD.get(t)


def extract_times(text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def add(index: int, hour24: int, minute: int, confidence: str, raw: str) -> None:
        if not (0 <= hour24 <= 23 and 0 <= minute <= 59):
            return
        for x in out:
            if x["hour24"] == hour24 and x["minute"] == minute:
                if x["confidence"] == "medium" and confidence == "high":
                    x.update(index=index, confidence=confidence, raw=raw)
                return
        out.append({"index": index, "hour24": hour24, "minute": minute,
                    "confidence": confidence, "raw": raw})

    # 1. HH:MM with optional meridiem
    for m in re.finditer(r"\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?", text, re.IGNORECASE):
        h, minute = int(m.group(1)), int(m.group(2))
        mer = (m.group(3) or "").lower().replace(".", "")
        conf = "high"
        if mer == "pm" and h < 12:
            h += 12
        elif mer == "am" and h == 12:
            h = 0
        elif not mer:
            h = _infer_meridiem(h)
            conf = "medium"
        add(m.start(), h, minute, conf, m.group(0))

    # 2. "9 AM", "3pm"  (not the "00" inside "9:00 AM")
    for m in re.finditer(r"(?<![\d:])(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)\b", text, re.IGNORECASE):
        h = int(m.group(1))
        mer = m.group(2).lower().replace(".", "")
        if mer == "pm" and h < 12:
            h += 12
        elif mer == "am" and h == 12:
            h = 0
        add(m.start(), h, 0, "high", m.group(0))

    # 3. noon / midnight
    for m in re.finditer(r"\bnoon\b", text, re.IGNORECASE):
        add(m.start(), 12, 0, "high", m.group(0))
    for m in re.finditer(r"\bmidnight\b", text, re.IGNORECASE):
        add(m.start(), 0, 0, "high", m.group(0))

    # 4. "<n> o'clock"
    for m in re.finditer(r"\b([a-z]+|\d{1,2})\s*o'?clock\b", text, re.IGNORECASE):
        h = _hour_from_token(m.group(1))
        if h is not None:
            add(m.start(), _infer_meridiem(h), 0, "medium", m.group(0))

    # 5. "<n> thirty|fifteen|forty-five"
    for m in re.finditer(r"\b([a-z]+|\d{1,2})[- ](thirty|fifteen|forty-?five|o'?clock)\b",
                         text, re.IGNORECASE):
        h = _hour_from_token(m.group(1))
        if h is None:
            continue
        kind = m.group(2).lower()
        minute = 30 if kind.startswith("thirty") else 15 if kind.startswith("fifteen") \
            else 45 if kind.startswith("forty") else 0
        add(m.start(), _infer_meridiem(h), minute, "medium", m.group(0))

    # 6. "half/quarter past|to <n>"
    for m in re.finditer(r"\b(quarter|half)\s+(past|to|after)\s+([a-z]+|\d{1,2})\b",
                         text, re.IGNORECASE):
        h = _hour_from_token(m.group(3))
        if h is None:
            continue
        base = _infer_meridiem(h)
        minute = 30 if m.group(1).lower() == "half" else 15
        if re.search(r"past|after", m.group(2), re.IGNORECASE):
            add(m.start(), base, minute, "medium", m.group(0))
        else:
            add(m.start(), (base + 23) % 24, 30 if m.group(1).lower() == "half" else 45,
                "medium", m.group(0))

    # 7. "X or Y[:MM]" option pairs
    for m in re.finditer(r"\b(\d{1,2})\s+or\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?",
                         text, re.IGNORECASE):
        add(m.start(), _infer_meridiem(int(m.group(1))), 0, "medium", m.group(1))
        h2 = int(m.group(2))
        min2 = int(m.group(3)) if m.group(3) else 0
        mer = (m.group(4) or "").lower().replace(".", "")
        if mer == "pm" and h2 < 12:
            h2 += 12
        elif mer == "am" and h2 == 12:
            h2 = 0
        else:
            h2 = _infer_meridiem(h2)
        add(m.start() + 1, h2, min2, "high" if (m.group(3) or mer) else "medium",
            m.group(2) + (f":{m.group(3)}" if m.group(3) else ""))

    # 8. bare number in a time context
    for m in re.finditer(
        r"\b(?:at|by|around|for|make it|makes it|do|say|to)\s+([a-z]+|\d{1,2})\b"
        r"(?!\s*(?:st|nd|rd|th|:|/|-\d))",
        text, re.IGNORECASE,
    ):
        h = _hour_from_token(m.group(1))
        if h is not None:
            add(m.start(), _infer_meridiem(h), 0, "medium", m.group(0).strip())
    for m in re.finditer(r"\b([a-z]+|\d{1,2})\s+(works|is fine|is good|sounds good)\b",
                         text, re.IGNORECASE):
        h = _hour_from_token(m.group(1))
        if h is not None:
            add(m.start(), _infer_meridiem(h), 0, "medium", m.group(0))

    out.sort(key=lambda x: x["index"])
    return out


def _anchor_date(call_created_at: str) -> _dt.date:
    return _dt.date.fromisoformat(call_created_at[:10])


def _iso(d: _dt.date) -> str:
    return d.isoformat()


def extract_dates(text: str, call_created_at: str) -> list[dict[str, Any]]:
    dates: list[dict[str, Any]] = []
    anchor = _anchor_date(call_created_at)
    # date.isoweekday(): Mon=1..Sun=7 — matches the TS WEEKDAY table.

    def next_weekday(target: int, add_weeks: int = 0) -> _dt.date:
        delta = (target - anchor.isoweekday() + 7) % 7
        d = anchor + _dt.timedelta(days=7 if delta == 0 else delta)
        return d + _dt.timedelta(weeks=add_weeks)

    for m in re.finditer(r"\bnext\s+(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b",
                         text, re.IGNORECASE):
        wd = WEEKDAY.get(m.group(1).lower())
        if wd is None:
            continue
        a, b = next_weekday(wd, 0), next_weekday(wd, 1)
        dates.append({"index": m.start(), "date": _iso(a), "is_relative": True,
                      "relative_resolutions": [_iso(a), _iso(b)], "raw": m.group(0)})

    for m in re.finditer(r"\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b",
                         text, re.IGNORECASE):
        if re.search(r"\bnext\s+$", text[: m.start()], re.IGNORECASE):
            continue
        wd = WEEKDAY[m.group(1).lower()]
        d = next_weekday(wd)
        dates.append({"index": m.start(), "date": _iso(d), "is_relative": True,
                      "relative_resolutions": [_iso(d)], "raw": m.group(0)})

    months = "|".join(MONTH)
    for m in re.finditer(rf"\b({months})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", text, re.IGNORECASE):
        mon, day = MONTH[m.group(1).lower()], int(m.group(2))
        try:
            d = _dt.date(anchor.year, mon, day)
        except ValueError:
            continue
        if d < anchor:
            d = _dt.date(anchor.year + 1, mon, day)
        dates.append({"index": m.start(), "date": _iso(d), "is_relative": False,
                      "relative_resolutions": [_iso(d)], "raw": m.group(0)})

    for m in re.finditer(r"\btoday\b", text, re.IGNORECASE):
        dates.append({"index": m.start(), "date": _iso(anchor), "is_relative": True,
                      "relative_resolutions": [_iso(anchor)], "raw": m.group(0)})
    for m in re.finditer(r"\btomorrow\b", text, re.IGNORECASE):
        d = anchor + _dt.timedelta(days=1)
        dates.append({"index": m.start(), "date": _iso(d), "is_relative": True,
                      "relative_resolutions": [_iso(d)], "raw": m.group(0)})

    for m in re.finditer(r"\b(\d{1,2})/(\d{1,2})\b", text):
        try:
            d = _dt.date(anchor.year, int(m.group(1)), int(m.group(2)))
        except ValueError:
            continue
        if d < anchor:
            d = _dt.date(anchor.year + 1, int(m.group(1)), int(m.group(2)))
        dates.append({"index": m.start(), "date": _iso(d), "is_relative": False,
                      "relative_resolutions": [_iso(d)], "raw": m.group(0)})

    dates.sort(key=lambda x: x["index"])
    return dates


def find_correction_cue(text: str) -> dict[str, Any] | None:
    m = CORRECTION_CUE_RE.search(text)
    return None if not m else {"cue": m.group(1).lower(), "index": m.start()}


def is_affirmative(text: str) -> bool:
    if NEGATION_START_RE.search(text):
        return False
    if find_correction_cue(text):
        return False
    return bool(AFFIRMATIVE_RE.search(text))


def is_interrogative(text: str) -> bool:
    return text.strip().endswith("?") or bool(INTERROGATIVE_START_RE.search(text))


def _hhmm(h: int, m: int) -> str:
    return f"{h:02d}:{m:02d}"


def parse_transcript(turns: list[dict[str, Any]], business_tz: str,
                     call_created_at: str) -> dict[str, Any]:
    has_user = any(t.get("speaker") == "user" for t in turns)
    partial = len(turns) == 0 or not has_user or len(turns) < 2

    candidates: list[dict[str, Any]] = []
    date_context: dict[str, Any] | None = None

    for turn_index, turn in enumerate(turns):
        text = turn.get("text", "")
        dates = extract_dates(text, call_created_at)
        times = extract_times(text)
        for t in times:
            in_turn = [d for d in dates if d["index"] <= t["index"]]
            in_turn.sort(key=lambda d: -d["index"])
            src = (in_turn[0] if in_turn else (dates[0] if dates else None)) or date_context
            cand: dict[str, Any] = {
                "turn_index": turn_index,
                "speaker": turn.get("speaker"),
                "raw_text": t["raw"],
                "resolution_confidence": t["confidence"] if src else "low",
                "is_relative": bool(src and src["is_relative"]),
                "char_index": t["index"],
            }
            if src:
                cand["resolved"] = {"date": src["date"], "time": _hhmm(t["hour24"], t["minute"]),
                                    "timezone": business_tz}
                if len(src["relative_resolutions"]) > 1:
                    cand["relative_resolutions"] = list(src["relative_resolutions"])
            candidates.append(cand)
        if dates:
            date_context = dates[-1]

    # correction events (first cue per turn)
    correction_events: list[dict[str, Any]] = []
    corrected_turns: set[int] = set()
    for turn_index, turn in enumerate(turns):
        cue = find_correction_cue(turn.get("text", ""))
        if not cue:
            continue
        in_turn = [c for c in candidates if c["turn_index"] == turn_index]
        before = [c for c in in_turn if c["char_index"] < cue["index"]]
        after = [c for c in in_turn if c["char_index"] >= cue["index"]]
        if not before and not after and len(in_turn) < 2:
            continue
        correction_events.append({
            "cue": cue["cue"], "turn_index": turn_index,
            "before_turn_index": before[-1]["turn_index"] if before else None,
            "after_turn_index": after[0]["turn_index"] if after else None,
        })
        corrected_turns.add(turn_index)

    # resolved targets — declarative user candidates, correction applied
    declarative_user = [
        (t.get("speaker") == "user" and not is_interrogative(t.get("text", ""))) for t in turns
    ]
    by_turn: dict[int, list[dict[str, Any]]] = {}
    for c in candidates:
        if not c.get("resolved") or c["speaker"] != "user" or not declarative_user[c["turn_index"]]:
            continue
        by_turn.setdefault(c["turn_index"], []).append(c)
    surviving: list[dict[str, Any]] = []
    for turn_index, lst in by_turn.items():
        lst.sort(key=lambda c: c["char_index"])
        if turn_index in corrected_turns and len(lst) > 1:
            surviving.append(lst[-1])
        else:
            surviving.extend(lst)
    surviving.sort(key=lambda c: (c["turn_index"], c["char_index"]))

    def _eq(a: dict[str, Any], b: dict[str, Any]) -> bool:
        return a["date"] == b["date"] and a["time"] == b["time"] and a["timezone"] == b["timezone"]

    user_targets: list[dict[str, Any]] = []
    for c in surviving:
        r = c["resolved"]
        if not any(_eq(r, t) for t in user_targets):
            user_targets.append(r)

    # strict E4 explicit confirmation
    explicit_confirmation = False
    confirmation_turn_index: int | None = None
    for i, turn in enumerate(turns):
        if turn.get("speaker") != "user" or not is_affirmative(turn.get("text", "")):
            continue
        if i - 1 < 0 or turns[i - 1].get("speaker") != "bot":
            continue
        bot_cand = next((c for c in candidates
                         if c["turn_index"] == i - 1 and c.get("resolved")), None)
        if not bot_cand:
            continue
        if user_targets and not _eq(bot_cand["resolved"], user_targets[0]):
            continue
        explicit_confirmation = True
        confirmation_turn_index = i
        break

    if user_targets:
        resolved_targets = user_targets
    elif explicit_confirmation and confirmation_turn_index is not None:
        bot_cand = next(c for c in candidates
                        if c["turn_index"] == confirmation_turn_index - 1 and c.get("resolved"))
        resolved_targets = [bot_cand["resolved"]]
    else:
        resolved_targets = []

    any_tz = any(TZ_CUE_RE.search(t.get("text", "")) for t in turns)
    if any_tz:
        timezone_source = "explicit"
    elif resolved_targets or any(c.get("resolved") for c in candidates):
        timezone_source = "business_default"
    else:
        timezone_source = "unknown"

    if partial or not resolved_targets:
        parse_confidence = "low"
    elif any(c["resolution_confidence"] != "high" or len(c.get("relative_resolutions", [])) > 1
             for c in surviving):
        parse_confidence = "medium"
    else:
        parse_confidence = "high"

    for c in candidates:
        c.pop("char_index", None)

    return {
        "candidate_datetimes": candidates,
        "resolved_targets": resolved_targets,
        "correction_events": correction_events,
        "explicit_confirmation": explicit_confirmation,
        "confirmation_turn_index": confirmation_turn_index,
        "timezone_source": timezone_source,
        "partial": partial,
        "parse_confidence": parse_confidence,
    }


# ─────────────────────────────── the gate ───────────────────────────────

BAD_FLAGS = {
    "self_correction_unresolved", "multi_time_mention_unresolved", "relative_date_ambiguity",
    "no_explicit_confirmation", "claim_parse_mismatch",
}
FRESH_CATCH = {"claim_parse_mismatch", "self_correction", "multi_time_mention"}


def expected_target(intent: str, intended: dict[str, Any],
                    original_hold_value: dict[str, Any]) -> dict[str, Any]:
    return original_hold_value if intent == "confirm" else intended


def equals_dt(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return (a["date"] == b["appointment_date"] and a["time"] == b["appointment_time"]
            and a["timezone"] == b["timezone"])


def _resolved_to_bv(rt: dict[str, Any], service_type: str) -> dict[str, Any]:
    return {"appointment_date": rt["date"], "appointment_time": rt["time"],
            "timezone": rt["timezone"], "service_type": service_type}


def detect(parsed: dict[str, Any], intent: str, intended: dict[str, Any],
           original_hold_value: dict[str, Any],
           matched_fixture_ids: list[str] | None = None) -> dict[str, Any]:
    target = expected_target(intent, intended, original_hold_value)
    flags: list[str] = []
    details: dict[str, Any] = {}

    if any(len(c.get("relative_resolutions", [])) > 1 for c in parsed["candidate_datetimes"]):
        flags.append("relative_date_ambiguity")
    if parsed["correction_events"] and not parsed["explicit_confirmation"]:
        flags.append("self_correction_unresolved")

    by_turn: dict[int, set[str]] = {}
    for c in parsed["candidate_datetimes"]:
        if c["speaker"] != "user" or not c.get("resolved"):
            continue
        by_turn.setdefault(c["turn_index"], set()).add(c["resolved"]["time"])
    for turn_index, times in by_turn.items():
        if len(times) >= 2 and target["appointment_time"] not in times:
            flags.append("multi_time_mention_unresolved")
            details["multi_time_turn"] = turn_index
            break

    if (not parsed["explicit_confirmation"] and not parsed["correction_events"]
            and parsed["resolved_targets"]):
        flags.append("no_explicit_confirmation")

    first = parsed["resolved_targets"][0] if parsed["resolved_targets"] else None
    if first and not equals_dt(first, target):
        flags.append("claim_parse_mismatch")
        details["parsed_first"] = first
        details["expected_target"] = target

    return {"flags": flags, "matched_fixture_ids": list(matched_fixture_ids or []), "details": details}


def _parse_iso(s: str) -> float:
    return _dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def decide(gate_input: dict[str, Any]) -> dict[str, Any]:
    """Ordered BLOCK checks, then E1-E7, then ALLOW. Fail-closed on any exception."""
    def block(reason_code: str, reason_detail: str, repair_target: dict | None,
              **extra: Any) -> dict[str, Any]:
        d = {"decision": "BLOCK", "reason_code": reason_code, "reason_detail": reason_detail,
             "repair_target": repair_target, "ghost_booking_prevented": False,
             "evidence_refs": None}
        d.update(extra)
        return d

    try:
        i = gate_input
        parsed = i["parsed"]
        intent = i["intent"]
        intended = i["intended_value"]
        hold_value = i["original_hold"]["value"]
        target = expected_target(intent, intended, hold_value)
        service = intended["service_type"]
        first = parsed["resolved_targets"][0] if parsed["resolved_targets"] else None
        flags = i["ambiguity"]["flags"]
        fixtures = i["matched_fixtures"]

        def bv(rt: dict[str, Any]) -> dict[str, Any]:
            return _resolved_to_bv(rt, service)

        def best_parsed() -> dict[str, Any] | None:
            return bv(first) if first else None

        def fixture(behavior: str) -> dict[str, Any] | None:
            return next((f for f in fixtures if f.get("expected_behavior") == behavior), None)

        decision: dict[str, Any] | None = None

        if i["slot_recheck"]["sandbox_ok"] is False:
            decision = block("sandbox_unavailable",
                             "slot re-check reported the resource unavailable", None)
        elif i["calle"]["status"] != "completed":
            decision = block("call_not_completed", f"calle.status={i['calle']['status']}", None)
        elif i["calle"]["task_completed"] is not True:
            decision = block("claim_absent",
                             f"task_completed={i['calle']['task_completed']}",
                             best_parsed() or hold_value)
        elif (i["calle"].get("completion_confidence") or {}).get("label") == "low":
            decision = block("claim_low_confidence", "completion_confidence.label=low", best_parsed())
        elif parsed["partial"] is True:
            decision = block("transcript_partial",
                             "transcript is partial / truncated / has no caller turn",
                             hold_value if intent == "confirm" else None)
        elif fixture("block_hard"):
            f = fixture("block_hard")
            decision = block("fixture_block", f"fixture {f['fixture_id']} demands a hard block",
                             None, evidence_refs={"fixture_id": f["fixture_id"]})
        elif fixture("force_sms_confirmation"):
            f = fixture("force_sms_confirmation")
            decision = block("fixture_force_sms",
                             f"fixture {f['fixture_id']} demands SMS confirmation",
                             best_parsed() or hold_value,
                             evidence_refs={"fixture_id": f["fixture_id"]})
        elif "self_correction_unresolved" in flags:
            decision = block("self_correction",
                             "unresolved self-correction with no re-confirmation",
                             best_parsed(), evidence_refs={"parsed_field": "resolved_targets[0]"})
        elif "multi_time_mention_unresolved" in flags:
            matches = bv(first) if (first and first["time"] == intended["appointment_time"]) else None
            decision = block("multi_time_mention",
                             "multiple times in one utterance, none agreed", matches)
        elif "relative_date_ambiguity" in flags:
            decision = block("relative_date_ambiguity",
                             "a relative date has >1 valid resolution", None)
        elif not parsed["resolved_targets"]:
            decision = block("no_parseable_target",
                             "no datetime could be parsed from the transcript", None)
        elif len(parsed["resolved_targets"]) >= 2:
            decision = block("multiple_targets",
                             f"{len(parsed['resolved_targets'])} distinct parsed targets", None)
        elif first and not equals_dt(first, target):
            decision = block("claim_parse_mismatch",
                             "parsed value != the value the action would write", bv(first),
                             ghost_booking_prevented=(i["calle"]["task_completed"] is True),
                             evidence_refs={"parsed_field": "resolved_targets[0]",
                                            "calle_field": "structured_result"})
        elif parsed["explicit_confirmation"] is not True:
            decision = block("no_explicit_confirmation",
                             "no bot restatement + caller affirmative",
                             bv(first) if first else None)
        elif i["slot_recheck"]["held_by_hold_id"] != i["original_hold"]["hold_id"]:
            decision = block("slot_lost", "the slot is no longer held by our hold", hold_value)
        elif _parse_iso(i["now"]) >= _parse_iso(i["original_hold"]["expires_at"]):
            decision = block("hold_expired", "the hold expired before the write",
                             best_parsed() or hold_value)

        if decision is None:
            decision = _allow_or_evidence_block(i, parsed, target, first, flags, fixtures,
                                                service, hold_value, intended)

        if (decision["decision"] == "BLOCK" and not decision["ghost_booking_prevented"]
                and decision["reason_code"] in FRESH_CATCH):
            if (first and i["calle"]["task_completed"] is True
                    and not equals_dt(first, target)):
                decision["ghost_booking_prevented"] = True
        return decision
    except Exception as exc:  # fail closed — never ALLOW on a throw
        return {"decision": "BLOCK", "reason_code": "sandbox_unavailable",
                "reason_detail": f"gate_exception:{exc}", "repair_target": None,
                "ghost_booking_prevented": False, "evidence_refs": None}


def _allow_or_evidence_block(i, parsed, target, first, flags, fixtures, service,
                             hold_value, intended) -> dict[str, Any]:
    def bv(rt):
        return _resolved_to_bv(rt, service)

    def best_parsed():
        return bv(first) if first else None

    def block(rc, rd, rt, **extra):
        d = {"decision": "BLOCK", "reason_code": rc, "reason_detail": rd, "repair_target": rt,
             "ghost_booking_prevented": False, "evidence_refs": None}
        d.update(extra)
        return d

    conf = i["calle"].get("completion_confidence") or {}
    e1 = i["calle"]["task_completed"] is True and conf.get("label") != "low"
    e2 = len(parsed["resolved_targets"]) == 1
    e3 = bool(first) and equals_dt(first, target)
    e4 = parsed["explicit_confirmation"] is True
    e5 = not any(f in BAD_FLAGS for f in flags)
    e6 = (i["slot_recheck"]["sandbox_ok"] is True
          and i["slot_recheck"]["held_by_hold_id"] == i["original_hold"]["hold_id"]
          and _parse_iso(i["now"]) < _parse_iso(i["original_hold"]["expires_at"]))
    e7 = not any(f.get("expected_behavior") in ("force_sms_confirmation", "block_hard")
                 for f in fixtures)

    if not e1:
        return block("claim_absent", "E1 failed", best_parsed() or hold_value)
    if not e2:
        return (block("no_parseable_target", "E2 failed (0 targets)", None)
                if not parsed["resolved_targets"]
                else block("multiple_targets", "E2 failed (>1 targets)", None))
    if not e3:
        return block("claim_parse_mismatch", "E3 failed", best_parsed(),
                     ghost_booking_prevented=(i["calle"]["task_completed"] is True))
    if not e4:
        return block("no_explicit_confirmation", "E4 failed", best_parsed())
    if not e5:
        return block("self_correction", "E5 failed", best_parsed())
    if not e6:
        expired = _parse_iso(i["now"]) >= _parse_iso(i["original_hold"]["expires_at"])
        return (block("hold_expired", "E6 failed (expired)", best_parsed() or hold_value)
                if expired else block("slot_lost", "E6 failed (not our hold / resource)", hold_value))
    if not e7:
        return block("fixture_force_sms", "E7 failed", best_parsed())

    return {
        "decision": "ALLOW", "reason_code": "allow_clean", "reason_detail": "E1-E7 all satisfied",
        "repair_target": None, "ghost_booking_prevented": False,
        "evidence_refs": {
            "transcript_turn_indexes":
                [parsed["confirmation_turn_index"]] if parsed["confirmation_turn_index"] is not None else [],
            "parsed_field": "resolved_targets[0]",
        },
    }


# ─────────────────────────── convenience ───────────────────────────

def flatten_transcript(call_task: dict[str, Any]) -> list[dict[str, Any]]:
    """recipients[0].attempts[last].transcript_turns → [{offset_seconds, speaker, text}]."""
    attempts = (call_task.get("recipients") or [{}])[0].get("attempts") or []
    last = attempts[-1] if attempts else {}
    return [
        {"offset_seconds": t.get("offset_seconds"), "speaker": t.get("speaker"), "text": t.get("text", "")}
        for t in (last.get("transcript_turns") or [])
    ]


def call_task_from(doc: dict[str, Any]) -> dict[str, Any]:
    """Accept a CALL-E WebhookEvent or a bare CallTask."""
    return doc["data"] if isinstance(doc, dict) and "data" in doc else doc


def verify(call_task: dict[str, Any], intent: str, intended: dict[str, Any],
           *, business_tz: str = "America/New_York",
           original_hold: dict[str, Any] | None = None,
           slot_recheck: dict[str, Any] | None = None,
           now: str | None = None,
           matched_fixtures: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Parse -> detect -> decide for one CALL-E call snapshot. Pure; no network."""
    parsed = parse_transcript(flatten_transcript(call_task), business_tz, call_task["created_at"])
    ambiguity = detect(parsed, intent, intended, (original_hold or {}).get("value", intended))
    gate_input = {
        "intent": intent,
        "intended_value": intended,
        "original_hold": original_hold or {
            "hold_id": "hold_demo", "slot_id": "slot_demo", "value": intended,
            "expires_at": "2099-01-01T00:00:00Z",
        },
        "calle": {
            "status": call_task["status"],
            "task_completed": call_task.get("task_completed"),
            "completion_confidence": call_task.get("completion_confidence"),
            "structured_result": call_task.get("structured_result"),
        },
        "parsed": parsed,
        "ambiguity": ambiguity,
        "matched_fixtures": matched_fixtures or [],
        "slot_recheck": slot_recheck or {
            "slot_id": "slot_demo", "held_by_hold_id": "hold_demo",
            "available": False, "sandbox_ok": True,
        },
        "now": now or call_task.get("completed_at") or call_task["created_at"],
    }
    return {"parsed": parsed, "ambiguity": ambiguity, "decision": decide(gate_input)}
