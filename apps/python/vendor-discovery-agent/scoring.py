"""
Lead quality scoring based on OSM data richness.
Higher score = call this vendor first.
"""
from __future__ import annotations

KEYWORD_MATCH_BONUS = 20
WEBSITE_BONUS = 15
HOURS_BONUS = 10
ADDRESS_BONUS = 10
NAME_BONUS = 10
EMAIL_BONUS = 5
MAX_SCORE = 100


def score_lead(vendor: dict) -> tuple[float, list[str]]:
    """
    Score a vendor dict (from discover_vendors) 0–100.
    Returns (score, reasons) where reasons is a list of short strings.
    """
    score = 0.0
    reasons = []

    tags = vendor.get("tags") or {}

    if tags.get("website") or tags.get("contact:website"):
        score += WEBSITE_BONUS
        reasons.append("has website")

    if tags.get("opening_hours"):
        score += HOURS_BONUS
        reasons.append("has opening hours")

    addr_fields = ["addr:street", "addr:housenumber", "addr:city", "addr:postcode"]
    addr_count = sum(1 for f in addr_fields if tags.get(f))
    if addr_count >= 3:
        score += ADDRESS_BONUS
        reasons.append(f"complete address ({addr_count}/4 fields)")
    elif addr_count >= 1:
        score += ADDRESS_BONUS // 2
        reasons.append(f"partial address ({addr_count}/4 fields)")

    if vendor.get("name"):
        score += NAME_BONUS
        reasons.append("has name")

    if tags.get("email") or tags.get("contact:email"):
        score += EMAIL_BONUS
        reasons.append("has email")

    # Category match strength: exact tag match is stronger than name fallback
    if vendor.get("category") and vendor.get("osm_id"):
        score += KEYWORD_MATCH_BONUS
        reasons.append("exact category match")

    return min(score, MAX_SCORE), reasons


def score_from_r1_inference(inference: dict) -> float:
    """
    Adjust score upward or downward based on R1 inference results.
    Call after R1 completes to update lead priority for R2 ordering.
    """
    delta = 0.0
    interest = inference.get("interest_level", "unknown")
    sentiment = inference.get("sentiment", "neutral")

    interest_map = {"high": 30, "medium": 15, "low": -5, "none": -20, "unknown": 0}
    sentiment_map = {"positive": 10, "neutral": 0, "negative": -20}

    delta += interest_map.get(interest, 0)
    delta += sentiment_map.get(sentiment, 0)
    return delta
