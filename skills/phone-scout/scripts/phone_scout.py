#!/usr/bin/env python3
"""phone_scout.py — multi-agent phone research orchestrator.

PhoneScout researches real-world businesses by phone. Give it a research
objective (like "find a restaurant for 8 tonight with vegetarian options
under R500") and it:

1. Plans the research (extracts required fields, constraints)
2. Discovers candidate businesses via web search (Google Places / OSM)
3. Selects the best candidates to call
4. Contacts each through CALL-E
5. Extracts structured results from each call
6. Verifies results against constraints
7. Ranks candidates and returns a recommendation

Usage:
    # Full pipeline (prints result to stdout; nothing persisted to disk)
    python3 phone_scout.py search --objective "..." --max-calls 3

    # Plan only (discovery, no calls — for delegation)
    python3 phone_scout.py search --objective "..." --plan-only

    # Verify / rank a results file (from sub-agents)
    python3 phone_scout.py verify --results-file /tmp/results.json --constraints '{"party_size":2}'
    python3 phone_scout.py rank   --results-file /tmp/results.json --constraints '{"party_size":2}'
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time as _time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MAX_CALLS = int(os.environ.get("PHONE_SCOUT_MAX_CALLS", "3"))
CURRENCY = os.environ.get("PHONE_SCOUT_CURRENCY", "R")
DEFAULT_LOCATION = os.environ.get("PHONE_SCOUT_DEFAULT_LOCATION", "Johannesburg")
DEFAULT_TZ_NAME = os.environ.get("PHONE_SCOUT_TZ", "Africa/Johannesburg")

# Keywords stripped from objectives when extracting the location phrase.
_KIND_KEYWORDS = ("barber", "salon", "hair", "haircut", "dentist", "doctor",
                  "clinic", "hotel", "vet", "garage", "pharmacy", "cafe",
                  "gym", "spa", "restaurant", "steakhouse")


# ---------------------------------------------------------------------------
# Safety helpers
# ---------------------------------------------------------------------------

def _validate_e164(phone: str) -> bool:
    """Strict E.164: + then ASCII digits only, 7-15 digit body, no leading zero."""
    s = str(phone).strip()
    if not s.startswith('+'):
        return False
    digits = s[1:]
    if not digits:
        return False
    if not all(c.isascii() and c.isdigit() for c in digits):
        return False
    if digits[0] == '0':
        return False
    if len(digits) < 7 or len(digits) > 15:
        return False
    return True


def _mask_phone(phone: str) -> str:
    """Mask a phone number for public output: +27 87 *** 6508"""
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) >= 8:
        return f"+{digits[:2]} {digits[2:4]} *** {digits[-4:]}"
    return "***"


def _mask_result(obj: Any) -> Any:
    """Recursively mask phone-bearing fields in any nested structure.
    Named phone keys are masked, and free-text string values are regex-scrubbed."""
    import re as _re
    if isinstance(obj, dict):
        masked = {}
        for k, v in obj.items():
            if k in ("phone", "caller_phone") and v:
                masked[k] = _mask_phone(str(v))
            elif isinstance(v, (dict, list)):
                masked[k] = _mask_result(v)
            elif isinstance(v, str):
                # Mask embedded phone numbers in free-text values
                masked[k] = _re.sub(
                    r'\+?[1-9]\d{6,14}',
                    lambda m: _mask_phone(m.group()),
                    v
                )
            else:
                masked[k] = v
        return masked
    if isinstance(obj, list):
        return [_mask_result(it) for it in obj]
    return obj

# ---------------------------------------------------------------------------
# Timezone
# ---------------------------------------------------------------------------

try:
    from zoneinfo import ZoneInfo

    _LOCAL_TZ = ZoneInfo(DEFAULT_TZ_NAME)
except Exception:
    _LOCAL_TZ = None


def _now() -> str:
    return datetime.now(_LOCAL_TZ).isoformat() if _LOCAL_TZ else datetime.now().isoformat()


# ---------------------------------------------------------------------------
# Candidate discovery
# ---------------------------------------------------------------------------

def discover_candidates(
    constraints: dict, max_results: int = 5, objective: str = ""
) -> list[dict]:
    """Search for businesses via Google Places (if API key set) or OpenStreetMap Overpass."""
    # Search via Google Places or OSM
    import web_search

    location = (constraints.get("location") or "").strip()

    # Fallback: extract location from the objective text. Handles two patterns:
    # 1. "restaurant in Cape Town" → extracts "Cape Town"
    # 2. "dentist Manhattan New York" → passes the non-keyword remainder
    if not location and objective:
        for prep in [" in ", " near ", " at ", " around "]:
            idx = objective.lower().find(prep)
            if idx >= 0:
                location = objective[idx + len(prep):].strip().rstrip(".,")
                break
        if not location:
            # No preposition — strip known business-type keywords, pass the rest
            # as the location phrase. Google/Nominatim will handle it.
            bare = objective
            for kw in _KIND_KEYWORDS:
                bare = re.sub(rf"\b{kw}\b", "", bare, flags=re.IGNORECASE)
            location = " ".join(bare.split()).strip() or DEFAULT_LOCATION

    kind = "restaurant"
    search_text = f"{location} {objective}".lower()
    for kw in ("barber", "salon", "hair", "haircut", "dentist", "doctor", "clinic",
               "hotel", "vet", "garage", "pharmacy", "cafe", "gym", "spa"):
        if kw in search_text:
            kind = kw
            break

    query = f"{kind} {location}".strip() if location else kind
    raw, meta = web_search.search_web(query, max_results=max_results)

    candidates = []
    for i, r in enumerate(raw):
        phone = (r.get("phones") or [None])[0]
        candidate = {
            "id": f"web-{i:03d}",
            "name": r.get("name", "?"),
            "phone": phone or "",
            "phone_missing": not bool(phone),
            "location": r.get("location") or location or "unknown",
            "website": r.get("url", ""),
            "discovery_source": r.get("discovery_source", "web_search"),
        }
        candidates.append(candidate)
        if len(candidates) >= max_results:
            break

    if not candidates and not meta.get("location_geocoded"):
        sys.stderr.write(
            "Location could not be geocoded. "
            "Include a specific city name in the objective (e.g. 'restaurant Cape Town').\n"
        )

    return candidates


# ---------------------------------------------------------------------------
# Research planner
# ---------------------------------------------------------------------------

def plan_research(objective: str, constraints: dict | None = None) -> dict[str, Any]:
    """Analyse the research objective and produce a structured plan.

    required_fields are derived generically from constraints keys (via
    CONSTRAINT_FIELD_MAP) plus a cheap keyword scan of the objective text.
    """
    if constraints is None:
        constraints = {}

    required_fields = ["availability", "available_time"]

    # Every constraint maps to a field we need to ask about.
    for key in constraints:
        if key == "location":
            continue
        mapped = CONSTRAINT_FIELD_MAP.get(key, key)
        if mapped not in required_fields:
            required_fields.append(mapped)

    # Also infer fields from objective keywords (cheap heuristic).
    kw_map = {
        "vegetarian": "vegetarian_options",
        "vegan": "vegan_options",
        "halal": "halal_options",
        "price": "estimated_price_per_person",
        "cost": "estimated_price_per_person",
        "budget": "estimated_price_per_person",
        "medical aid": "accepts_medical_aid",
    }
    obj_lower = objective.lower()
    for kw, field in kw_map.items():
        if kw in obj_lower and field not in required_fields:
            required_fields.append(field)

    required_fields.append("booking_requirements")

    return {
        "research_id": str(uuid.uuid4())[:8],
        "objective": objective,
        "constraints": constraints,
        "required_fields": required_fields,
        "max_calls": MAX_CALLS,
        "mode": "live",
        "started_at": _now(),
        "status": "planned",
    }


# ---------------------------------------------------------------------------
# Live CALL-E research call
# ---------------------------------------------------------------------------

def _collect_transcript(call: dict) -> str | None:
    """Gather full call transcript text from recipients[].attempts[] (defensive against SDK shape)."""
    parts: list[str] = []
    # CALL-E nests attempts under recipients
    for rcp in call.get("recipients") or []:
        if not isinstance(rcp, dict):
            continue
        for att in rcp.get("attempts") or []:
            if not isinstance(att, dict):
                continue
            t = att.get("transcript") or att.get("transcript_turns") or att.get("conversation")
            if isinstance(t, str):
                parts.append(t)
            elif isinstance(t, list):
                for turn in t:
                    if isinstance(turn, dict):
                        speaker = turn.get("speaker") or turn.get("role") or "?"
                        text = turn.get("text") or turn.get("content") or turn.get("message") or ""
                        parts.append(f"{speaker}: {text}")
                    elif isinstance(turn, str):
                        parts.append(turn)
    return "\n".join(parts) if parts else None


def _research_error(restaurant: dict, code: str, message: str) -> dict[str, Any]:
    """Build a standard recovered-error result."""
    return {
        "business_id": restaurant.get("id", "?"),
        "business_name": restaurant.get("name", "?"),
        "error": code,
        "recoverable": True,
        "user_action": message,
        "contacted": False,
        "mode": "live",
    }


def run_live_research_call(restaurant: dict, research_plan: dict) -> dict[str, Any]:
    """Contact a business via CALL-E and return structured results."""
    required_fields = research_plan.get("required_fields", [])
    constraints = research_plan.get("constraints", {})
    context = research_plan.get("context", "")  # free-text context injected by --context

    # Safety: validate AND normalize the phone number
    raw_phone = str(restaurant.get("phone", "")).strip()
    if not _validate_e164(raw_phone):
        return _research_error(
            restaurant, "invalid_phone",
            f"Invalid or missing E.164 phone number: {raw_phone!r}",
        )
    # Use the normalized value for the call—not the potentially dirty original
    restaurant["phone"] = raw_phone

    # Build a rich natural-language task that CALL-E validation will accept.
    questions = [FIELD_QUESTIONS[f] for f in required_fields if f in FIELD_QUESTIONS]

    context_lines = [context] if context else []
    if constraints:
        if "party_size" in constraints:
            context_lines.append(f"The customer has a party of {constraints['party_size']}.")
        if "max_price_per_person" in constraints:
            context_lines.append(
                f"The customer's budget is {CURRENCY}{constraints['max_price_per_person']} per person."
            )
        # Use descriptive context for the date / time fields we currently collapse
        if constraints.get("time_after"):
            context_lines.append(f"The customer wants to know about availability after {constraints['time_after']}.")
        for k in ("vegetarian", "vegan", "halal"):
            if constraints.get(k):
                context_lines.append(f"The customer wants {k} options.")

    ctx_block = "\n".join(context_lines) + "\n\n" if context_lines else ""

    task = (
        ctx_block
        + f"Contact {restaurant['name']} at {restaurant['phone']} and research:\n"
        + "\n".join(f"- {q}" for q in questions)
        + "\n\n"
        "CRITICAL — THIS IS A RESEARCH / FEELER CALL ONLY:\n"
        "- Start naturally: 'Hi, I'm calling to ask a few questions about [the service] on [the day] — this is just for research, I'm not making a booking today.'\n"
        "- Ask the research questions above while the person is engaged.\n"
        "- At the end, confirm: 'Thank you — as I mentioned this is just research. My client will call back if they decide to book.'\n"
        "- Do NOT negotiate a booking, do NOT hold a table/slot, do NOT provide a callback number for a reservation.\n"
        "- Keep the conversation brief and natural — don't over-explain.\n\n"
        "You MUST be transparent from the start that this is an information-gathering call, not a booking request.\n"
        "This is an INFORMATION-GATHERING call only. Do not make a booking or reservation."
    )

    try:
        from calle import CalleClient

        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            return {
                "business_id": restaurant["id"],
                "business_name": restaurant.get("name", "?"),
                "error": "no_api_key",
                "recoverable": False,
                "user_action": "Add CALLE_API_KEY to ~/.hermes/.env",
                "contacted": False,
                "mode": "live",
            }
        client = CalleClient(api_key=api_key)
        call = client.calls.create_and_wait(
            task=task,
            recipient={"phone": restaurant["phone"]},
            result_schema=build_result_schema(required_fields),
            metadata={
                "source": "phone_scout",
                "business": restaurant["name"],
                "research_id": research_plan["research_id"],
            },
            interval_seconds=5.0,
            timeout_seconds=600.0,
        )
        client.close()
        sr = call.get("structured_result") or {}
        return {
            "business_id": restaurant["id"],
            "business_name": restaurant["name"],
            "phone": restaurant["phone"],
            "contacted": sr.get("contacted", True),
            "answered": sr.get("contacted", True),
            "availability": sr.get("availability"),
            "available_times": sr.get("available_times"),
            "party_size_ok": sr.get("party_size_ok"),
            "vegetarian_options": sr.get("vegetarian_options"),
            "vegan_options": sr.get("vegan_options"),
            "halal_options": sr.get("halal_options"),
            "price_min": sr.get("price_min"),
            "price_max": sr.get("price_max"),
            "booking_required": sr.get("booking_required"),
            "booking_deadline": sr.get("booking_deadline"),
            "accepts_medical_aid": sr.get("accepts_medical_aid"),
            "confidence": (call.get("completion_confidence") or {}).get("score", 0.5),
            "evidence": call.get("evidence") or [],
            "transcript": _collect_transcript(call),
            "mode": "live",
            "call_id": call.get("id"),
        }
    except ImportError:
        return {
            "business_id": restaurant["id"],
            "business_name": restaurant.get("name", "?"),
            "error": "calle_ai_not_installed",
            "recoverable": False,
            "user_action": "Install calle-ai: pip install calle-ai into the skill venv",
            "contacted": False,
            "mode": "live",
        }
    except Exception as exc:
        return {
            "business_id": restaurant["id"],
            "business_name": restaurant.get("name", "?"),
            "error": str(exc),
            "recoverable": True,
            "user_action": f"Call failed with unexpected error: {exc}. Retry the call.",
            "contacted": False,
            "mode": "live",
        }


# ---------------------------------------------------------------------------
# Generic field knowledge
# ---------------------------------------------------------------------------

# Maps a constraint key to the result field that carries its answer.
CONSTRAINT_FIELD_MAP: dict[str, str] = {
    "party_size": "party_size_ok",
    "vegetarian": "vegetarian_options",
    "vegan": "vegan_options",
    "halal": "halal_options",
    "max_price_per_person": "estimated_price_per_person",
}

# required-field -> live research question (used to build the CALL-E task)
FIELD_QUESTIONS: dict[str, str] = {
    "availability": "whether they can accommodate the request at the requested time",
    "available_time": "the available time(s) they can offer",
    "party_size_ok": "whether they can accommodate the requested party size",
    "vegetarian_options": "whether vegetarian options are available",
    "vegan_options": "whether vegan options are available",
    "halal_options": "whether halal options are available",
    "estimated_price_per_person": "the approximate price per person",
    "booking_requirements": "any booking requirements or deadlines",
    "accepts_medical_aid": "whether they accept the patient's medical aid",
}

# required-field -> result_schema property (drives the live CALL-E schema)
def _schema_property(field: str) -> dict[str, Any] | None:
    return {
        "party_size_ok": {"type": "boolean"},
        "vegetarian_options": {"type": "boolean"},
        "vegan_options": {"type": "boolean"},
        "halal_options": {"type": "boolean"},
        "booking_requirements": {"type": "string"},
        "accepts_medical_aid": {"type": "boolean"},
    }.get(field)


def build_result_schema(required_fields: list[str]) -> dict[str, Any]:
    """Build a generic CALL-E result schema from the required fields.

    ALL fields (contacted + every research field) are marked required so CALL-E's
    validator does not short-circuit after a partial answer.
    """
    props: dict[str, Any] = {
        "contacted": {"type": "boolean"},
        "availability": {"type": "boolean"},
        "available_times": {"type": "array", "items": {"type": "string"}},
    }
    required = ["contacted", "availability"]
    for f in required_fields:
        if f == "estimated_price_per_person":
            props["price_min"] = {"type": "integer"}
            props["price_max"] = {"type": "integer"}
            required.extend(["price_min", "price_max"])
            continue
        if f == "available_time":
            continue  # already have available_times as a base field
        prop = _schema_property(f)
        if prop:
            props[f] = prop
            required.append(f)
    return {"type": "object", "required": required, "properties": props}


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

def _check_price(result: dict, cap: Any) -> tuple[Any, Any]:
    pmin = result.get("price_min")
    pmax = result.get("price_max")
    if pmin is not None and pmax is not None:
        return (pmax <= cap, f"{pmin}-{pmax}")
    if pmin is not None:
        return (pmin <= cap, str(pmin))
    if pmax is not None:
        return (pmax <= cap, str(pmax))
    return (None, None)


def _check_time_after(result: dict, target: str) -> tuple[Any, Any]:
    times = result.get("available_times") or []
    matching = [t for t in times if t >= target]
    return (len(matching) > 0, {"times": times, "matching": matching})


def _check_min_rating(result: dict, v: float) -> tuple[Any, Any]:
    rating = result.get("rating")
    if rating is None:
        return (None, None)
    return (rating >= v, rating)


# Generic constraint checkers: constraint key -> fn(result, expected) -> (passed, actual)
CHECKERS: dict[str, Any] = {
    "party_size": lambda r, v: (bool(r.get("party_size_ok")), r.get("party_size_ok")),
    "vegetarian": lambda r, v: (bool(r.get("vegetarian_options")), r.get("vegetarian_options")),
    "vegan": lambda r, v: (bool(r.get("vegan_options")), r.get("vegan_options")),
    "halal": lambda r, v: (bool(r.get("halal_options")), r.get("halal_options")),
    "max_price_per_person": _check_price,
    "time_after": _check_time_after,
    "min_rating": _check_min_rating,
}


def verify_result(result: dict, plan: dict) -> dict[str, Any]:
    """Generic constraint verification.

    Every key in plan['constraints'] is checked against the result via CHECKERS
    (falling back to a direct field comparison for unknown keys). `location` is
    a discovery filter, not a call-time check, so it is skipped here.
    """
    constraints = plan.get("constraints", {})
    checks: dict[str, Any] = {}

    if not result.get("contacted"):
        return {
            "business_id": result.get("business_id"),
            "business_name": result.get("business_name", "?"),
            "passed": False,
            "error": "could_not_contact",
            "checks": {},
            "conflicts": [],
            "overall_confidence": result.get("confidence", 0.1),
        }

    for field, expected in constraints.items():
        if field == "location":
            continue
        checker = CHECKERS.get(field)
        if checker:
            passed, actual = checker(result, expected)
        else:
            actual = result.get(field)
            passed = bool(actual) if expected is True else (actual == expected)
        checks[field] = {"expected": expected, "actual": actual, "passed": passed}

    # Conservative: unknown (None) counts as not-passed.
    all_passed = all(c.get("passed") is True for c in checks.values())

    # Conflict detection (web listing vs phone quote)
    conflicts = []
    if result.get("price_min") and result.get("price_max"):
        conflicts.append(
            {
                "field": "price",
                "source_a": "web_listing",
                "value_a": f"{result['price_min']}-{result['price_max']}",
                "source_b": "phone_call",
                "value_b": result.get("price_confirmation", "not confirmed"),
                "preferred": "phone_call",
                "reason": "Phone information was verified today.",
            }
        )

    return {
        "business_id": result.get("business_id"),
        "business_name": result.get("business_name", "?"),
        "passed": all_passed,
        "checks": checks,
        "conflicts": conflicts,
        "overall_confidence": result.get("confidence", 0.1),
    }


# ---------------------------------------------------------------------------
# Ranking
# ---------------------------------------------------------------------------

def rank_candidates(results: list[dict], verifications: list[dict], constraints: dict | None = None) -> list[dict]:
    """Rank candidates by constraint satisfaction, confidence, and value.

    Scoring (max ~100):
      - constraint satisfaction: 50 pts (proportional to checks passed)
      - confidence:             25 pts
      - value (price):          15 pts (only when max_price_per_person set)
      - availability slots:      up to 9 pts
      - not contacted:          -40 penalty
    """
    constraints = constraints or {}
    scored = []
    for r, v in zip(results, verifications):
        score = 0.0
        reasons: list[str] = []

        checks = v.get("checks", {})
        all_checks = list(checks.values())
        total = len(all_checks)
        passed = sum(1 for c in all_checks if c.get("passed") is True)
        if total:
            score += (passed / total) * 50
        if passed == total and total:
            reasons.append("Meets all constraints")

        confidence = v.get("overall_confidence", 0.5)
        score += confidence * 25
        if confidence > 0.8:
            reasons.append("High confidence: phone-verified")

        cap = constraints.get("max_price_per_person")
        pmin = r.get("price_min")
        if cap and pmin is not None:
            score += max(0, (cap - pmin) / cap) * 15
            if pmin <= cap * 0.7:
                reasons.append("Excellent value")

        times = r.get("available_times") or []
        if times:
            score += min(len(times), 3) * 3
            reasons.append(f"{len(times)} available time slots")

        if not r.get("contacted"):
            score = max(0, score - 40)

        # Copy every result field into the ranking entry so the parent agent
        # can access any field generically (not just restaurant-specific ones).
        entry = dict(r)
        entry.update(
            {
                "rank": 0,
                "score": round(score, 1),
                "max_score": 100,
                "passed_verification": v.get("passed"),
                "why": reasons,
            }
        )
        scored.append(entry)

    scored.sort(key=lambda x: x["score"], reverse=True)
    for i, s in enumerate(scored):
        s["rank"] = i + 1

    return [_mask_result(s) for s in scored]


# ---------------------------------------------------------------------------
# Main research pipeline
# ---------------------------------------------------------------------------

def run_research(plan: dict) -> dict[str, Any]:
    """Run the full research pipeline and return a structured result (stdout only)."""
    events: list[dict[str, Any]] = []

    def log(phase: str, detail: str):
        events.append({"phase": phase, "detail": detail, "at": _now()})

    log("planner", f"Research plan created: {' '.join(plan['required_fields'])}")

    constraints = plan.get("constraints", {})
    max_calls = plan.get("max_calls", MAX_CALLS)

    # Discovery
    candidates = discover_candidates(
        constraints, max_results=max_calls, objective=plan.get("objective", "")
    )
    log("discovery", f"Found {len(candidates)} candidates")
    for c in candidates:
        log("discovery", f"  {c['name']} ({c['location']})")

    if not candidates:
        return {
            "research_id": plan["research_id"],
            "status": "failed",
            "error": "no_candidates_found",
            "events": events,
        }

    # Selection
    log("selector", f"Selected {len(candidates)} businesses to contact")

    # Phone research
    results: list[dict[str, Any]] = []
    for c in candidates:
        log("calling", f"Contacting {c['name']}...")
        result = run_live_research_call(c, plan)
        results.append(result)
        status = "answered" if result.get("contacted") else "failed"
        # Stop after an ambiguous/recoverable error — do not auto-advance
        if result.get("error") and result.get("recoverable"):
            log("calling", f"  {c['name']}: ambiguous — stopping batch")
            break
        log("calling", f"  {c['name']}: {status}")

    contacted = sum(1 for r in results if r.get("contacted"))
    log("extraction", f"Extracted results from {contacted}/{len(candidates)} calls")

    # Verification
    verifications = [verify_result(r, plan) for r in results]
    passed = sum(1 for v in verifications if v.get("passed"))
    log("verification", f"Verified: {passed}/{len(verifications)} passed constraints")

    # Ranking
    rankings = rank_candidates(results, verifications, constraints)
    log("ranking", f"Ranked {len(rankings)} candidates")
    best = rankings[0] if rankings else None
    if best:
        log("ranking", f"  #1: {best['business_name']} (score {best['score']})")

    recommendation = None
    if best:
        recommendation = dict(best)
        recommendation["rank"] = 1

    
    # Flag for ambiguous outcomes: agent must stop, not auto-retry
    ambiguous = any(
        r.get("error") and r.get("recoverable") is True
        for r in results
    )

    # Failure summary
    failures = [r for r in results if r.get("error")]
    failure_rate = len(failures) / len(results) if results else 0
    failure_summary = None
    if failure_rate > 0:
        failure_summary = {
            "total": len(results),
            "failed": len(failures),
            "failure_rate": round(failure_rate, 2),
            "failed_businesses": [
                {
                    "name": f.get("business_name", "?"),
                    "error": f.get("error", "unknown"),
                    "recoverable": f.get("recoverable", True),
                }
                for f in failures
            ],
            "recommendation": (
                "All calls failed — check phone numbers, region support, or API key."
                if failure_rate == 1.0
                else "Partial results available. Some calls failed."
            ),
        }

    status = "completed"
    if failure_rate == 1.0:
        status = "failed"
    elif failure_rate > 0:
        status = "partial"

    return {
        "research_id": plan["research_id"],
        "objective": plan["objective"],
        "constraints": constraints,
        "required_fields": plan.get("required_fields", []),
        "status": status,
        "mode": "live",
        "calls_attempted": len(candidates),
        "calls_completed": contacted,
        "results": results,
        "verifications": verifications,
        "rankings": rankings,
        "recommendation": recommendation,
        "failure_summary": failure_summary,
        "events": events,
        "started_at": plan["started_at"],
        "completed_at": _now(),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def cmd_search(args: argparse.Namespace) -> int:
    if not args.objective:
        sys.stderr.write("error: --objective is required for search\n")
        return 2
    objective = args.objective
    constraints = json.loads(args.constraints) if args.constraints else {}

    if args.max_calls:
        global MAX_CALLS
        MAX_CALLS = args.max_calls

    plan = plan_research(objective, constraints)

    if args.plan_only:
        candidates = discover_candidates(
            plan.get("constraints", {}),
            max_results=MAX_CALLS,
            objective=plan.get("objective", ""),
        )
        out = {
            "research_id": plan["research_id"],
            "objective": plan["objective"],
            "required_fields": plan["required_fields"],
            "constraints": plan.get("constraints", {}),
            "max_calls": plan["max_calls"],
            "candidates": _mask_result(candidates),
            "note": "Plan-only mode — no calls placed. Use these candidates for delegation.",
        }
        if args.pretty:
            print(json.dumps(out, indent=2, ensure_ascii=False, default=str))
        else:
            print(json.dumps(out, ensure_ascii=False, default=str))
        return 0

    if not args.plan_only and not args.confirm:
        sys.stderr.write("This would place REAL phone calls. Re-run with --confirm to dial.\n")
        # Still run discovery so the user can see candidates before confirming
        candidates = discover_candidates(
            plan.get("constraints", {}),
            max_results=MAX_CALLS,
            objective=plan.get("objective", ""),
        )
        out = {
            "dry_run": True,
            "research_id": plan["research_id"],
            "objective": plan["objective"],
            "required_fields": plan["required_fields"],
            "candidates": _mask_result(candidates),
            "note": "CONFIRMATION REQUIRED — review these candidates, then re-run with --confirm to place live research calls.",
        }
        if args.pretty:
            print(json.dumps(out, indent=2, ensure_ascii=False, default=str))
        else:
            print(json.dumps(out, ensure_ascii=False, default=str))
        sys.stderr.write("Refusing to dial: pass --confirm to place live calls.\n")
        return 1

    result = run_research(plan)
    # Mask sensitive fields in output (phones, transcripts)
    if "results" in result:
        result["results"] = [_mask_result(r) for r in result["results"]]

    if args.pretty:
        print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
    else:
        rec = result.get("recommendation")
        print(f"Research {result['research_id']}: {result['status']}")
        print(f"  {result['calls_completed']}/{result['calls_attempted']} calls completed (live mode)")
        if rec:
            print(
                f"  #{rec['rank']} {rec['business_name']} "
                f"(score {rec['score']}, confidence {rec['confidence']:.0%})"
            )
    return 0


def cmd_call_one(args: argparse.Namespace) -> int:
    """Research ONE business by phone. Designed for sub-agents.
    Places a real CALL-E research call.
    """
    plan = {
        "research_id": str(uuid.uuid4())[:8],
        "required_fields": args.research_questions,
        "context": args.context or "",
        "constraints": json.loads(args.constraints) if getattr(args, "constraints", None) else {},
    }

    candidate = {
        "id": args.candidate_id,
        "name": args.name or args.candidate_id,
        "phone": args.phone or "",
    }

    if not args.confirm:
        sys.stderr.write("This would place a REAL phone call. Re-run with --confirm to dial.\n")
        plan_out = dict(plan)
        plan_out["dry_run"] = True
        plan_out["note"] = "CONFIRMATION REQUIRED — review, then re-run with --confirm to place a live call."
        if args.pretty:
            print(json.dumps(plan_out, indent=2, ensure_ascii=False, default=str))
        else:
            print(json.dumps(plan_out, ensure_ascii=False, default=str))
        sys.stderr.write("Refusing to dial: pass --confirm to place a live call.\n")
        return 1

    if not _validate_e164(candidate["phone"]):
        sys.stderr.write(f"error: invalid or missing E.164 phone number: {candidate['phone']}\n")
        return 2

    result = run_live_research_call(candidate, plan)
    result["mode"] = "live"
    result = _mask_result(result)
    if args.pretty:
        print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
    else:
        print(json.dumps(result, ensure_ascii=False, default=str))

    fatal_errors = {"no_api_key", "calle_ai_not_installed"}
    if result.get("error") in fatal_errors:
        return 1
    return 0


def _load_results_from_file(results_file: str, constraints_json: str | None = None) -> tuple[list[dict] | None, dict | None]:
    """Load results from a JSON file (list or {results: [...]})."""
    data = json.loads(Path(results_file).read_text())
    if isinstance(data, list):
        results = data
    elif isinstance(data, dict) and "results" in data:
        results = data["results"]
    else:
        results = [data]
    constraints = json.loads(constraints_json) if constraints_json else {}
    return results, {"constraints": constraints}


def cmd_verify(args: argparse.Namespace) -> int:
    if not args.results_file:
        sys.stderr.write("error: --results-file is required\n")
        return 2
    results, plan = _load_results_from_file(args.results_file, args.constraints)
    if results is None:
        return 2
    verifications = [verify_result(r, plan) for r in results]
    if args.pretty:
        print(json.dumps(verifications, indent=2, ensure_ascii=False, default=str))
    else:
        for v in verifications:
            flag = "PASS" if v.get("passed") else "FAIL"
            print(f"{v.get('business_name', '?'):30s} {flag}")
            for field, c in v.get("checks", {}).items():
                mark = "✓" if c.get("passed") is True else ("✗" if c.get("passed") is False else "?")
                print(f"    {mark} {field}: expected {c.get('expected')!r} -> actual {c.get('actual')!r}")
    return 0


def cmd_rank(args: argparse.Namespace) -> int:
    if not args.results_file:
        sys.stderr.write("error: --results-file is required\n")
        return 2
    results, plan = _load_results_from_file(args.results_file, args.constraints)
    if results is None:
        return 2
    constraints = (plan or {}).get("constraints", {})
    verifications = [verify_result(r, plan) for r in results]
    rankings = rank_candidates(results, verifications, constraints)
    if args.pretty:
        print(json.dumps(rankings, indent=2, ensure_ascii=False, default=str))
    else:
        for r in rankings:
            flag = "✓" if r.get("passed_verification") else "✗"
            print(f"#{r['rank']} {r.get('business_name', '?'):30s} score={r['score']:5.1f} {flag}  {', '.join(r.get('why', []))}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="phone_scout.py", description="Multi-agent phone research orchestrator")
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("search", help="Run a phone research task")
    sp.add_argument("--objective", help="Natural-language research objective")
    sp.add_argument("--max-calls", type=int, default=MAX_CALLS, help=f"Max businesses to contact (default: {MAX_CALLS})")
    sp.add_argument("--constraints", help='JSON constraints dict, e.g. {"vegetarian":true,"max_price_per_person":400}')
    sp.add_argument("--plan-only", action="store_true", help="Stop after discovery — print candidates, don't call")
    sp.add_argument("--confirm", action="store_true", help="REQUIRED to place live calls. Without this, the command is a dry run.")
    sp.add_argument("--pretty", action="store_true", help="Pretty-print full JSON result")
    sp.set_defaults(func=cmd_search)

    sp = sub.add_parser("call-one", help="Research ONE business by phone (used by sub-agents)")
    sp.add_argument("--candidate-id", required=True, help="Candidate ID from --plan-only output")
    sp.add_argument("--phone", help="Phone number to call (E.164)")
    sp.add_argument("--name", help="Business name")
    sp.add_argument("--research-questions", required=True, nargs="*", help="Questions to research (from planner required_fields)")
    sp.add_argument("--context", help="Rich natural-language context for the call")
    sp.add_argument("--constraints", help='JSON constraints dict for the call')
    sp.add_argument("--confirm", action="store_true", help="REQUIRED to place a live call. Without this, it's a dry run.")
    sp.add_argument("--pretty", action="store_true", help="Pretty-print full JSON result")
    sp.set_defaults(func=cmd_call_one)

    sp = sub.add_parser("verify", help="Verify results against constraints")
    sp.add_argument("--results-file", required=True, help="JSON file of raw results (a list, or {results: [...]})")
    sp.add_argument("--constraints", help='JSON constraints dict, e.g. {"party_size": 8}')
    sp.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    sp.set_defaults(func=cmd_verify)

    sp = sub.add_parser("rank", help="Rank results by constraint fit")
    sp.add_argument("--results-file", required=True, help="JSON file of raw results")
    sp.add_argument("--constraints", help='JSON constraints dict')
    sp.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    sp.set_defaults(func=cmd_rank)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())