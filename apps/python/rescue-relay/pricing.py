"""Evidence-grounded quotes and per-helper (not per-task) cost summaries.

A quote is not a payment, a booking, or proof of availability. Currency values
use the configured display currency and explicitly expose assumptions.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
import os
import re
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

DEFAULT_CURRENCY = os.getenv("DEFAULT_CURRENCY", "USD").strip().upper()
if not re.fullmatch(r"[A-Z]{3}", DEFAULT_CURRENCY):
    raise ValueError("DEFAULT_CURRENCY must be a three-letter currency code")


class CostQuote(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    status: Literal["fixed", "estimate", "free", "unknown"] = "unknown"
    amount: float | None = Field(default=None, ge=0, le=1_000_000_000, allow_inf_nan=False)
    currency: str = Field(default=DEFAULT_CURRENCY, pattern=r"^[A-Z]{3}$")
    currency_assumed: bool = False
    scope: str = Field(default="Scope not confirmed", max_length=600)
    terms: str = Field(default="", max_length=1200)
    evidence_quote: str = Field(default="", max_length=1600)


NUMBER = r"\d+(?:,\d{3})*(?:\.\d{1,2})?"
MONEY = re.compile(rf"\b(?:(PKR|INR|USD|GBP|EUR|Rs\.?|rupees?)\s*({NUMBER})|({NUMBER})\s*(PKR|INR|USD|GBP|EUR|Rs\.?|rupees?))\b", re.I)
FREE = re.compile(r"\b(free of charge|for free|(?:service|rescue|help|tasks) (?:is|are) free|no charge|no fee|no cost|without charge|zero (?:fee|cost))\b", re.I)
UNCERTAIN = re.compile(r"\b(about|around|approximately|estimate|estimated|starting (?:at|from)|from|at least|plus|extra|excluding|depends|depending|per (?:hour|mile|kilomet|km|animal))\b", re.I)
WITHDRAWN = re.compile(r"\b(quote (?:is )?(?:withdrawn|cancelled|canceled)|price (?:is )?(?:unknown|not confirmed)|not confirmed a price|cannot quote|can't quote|no longer valid)\b", re.I)


def texts_from(evidence: dict) -> list[str]:
    return [t["text"] for t in evidence.get("transcript", []) if t.get("speaker") in {"user", "recipient", "human", "callee"} and isinstance(t.get("text"), str)]


def money_values(text: str) -> list[tuple[float, str, bool]]:
    values = []
    for m in MONEY.finditer(text):
        raw_currency, raw_amount = (m[1], m[2]) if m[1] else (m[4], m[3])
        assumed = raw_currency.lower().rstrip(".") in {"rs", "rupee", "rupees"}
        try:
            amount = Decimal(raw_amount.replace(",", ""))
        except InvalidOperation:
            continue
        if Decimal(0) <= amount <= Decimal("1000000000"):
            values.append((float(amount), DEFAULT_CURRENCY if assumed else raw_currency.upper(), assumed))
    return values


def quote_from_text(text: str) -> dict:
    result = CostQuote().model_dump()
    values = money_values(text)
    if WITHDRAWN.search(text):
        return result
    if not values:
        if FREE.search(text) and not re.search(r"\b(not|isn't|is not|cannot|can't|never)\b.{0,70}\b(free|no charge|no fee|no cost)\b", text, re.I):
            result.update(status="free", amount=0, scope="Their offered tasks", evidence_quote=text[:1600])
        return result
    # Multiple prices/fees or a range cannot silently become one fixed total.
    amount, currency, assumed = values[-1]
    estimate_text = re.sub(r"\b(?:no|without) extra (?:charges|fees|costs)\b", "", text, flags=re.I)
    estimate = bool(UNCERTAIN.search(estimate_text)) or len(set((v[0], v[1]) for v in values)) > 1 or bool(re.search(r"\d\s*[-–]\s*\d", text))
    if len(values) > 1 and len({v[1] for v in values}) == 1:
        amount = max(v[0] for v in values)  # display only; never an authorized range total
    scope = "All tasks offered in this call" if re.search(r"\b(all (?:the )?(?:offered |assigned )?tasks|all.?inclusive|whole rescue|full rescue|total (?:for|fee|price|cost))\b", text, re.I) else "Confirm what this price includes"
    result.update(status="estimate" if estimate else ("free" if amount == 0 else "fixed"), amount=amount,
                  currency=currency, currency_assumed=assumed, scope=scope,
                  terms=text[:1200] if estimate else "", evidence_quote=text[:1600])
    return result


def extract_quote(evidence: dict, identity_confirmed: bool = True) -> dict:
    """Only a verified recipient may quote. Bot words/profile metadata never count."""
    result = CostQuote().model_dump()
    if not identity_confirmed:
        return result
    for text in texts_from(evidence):
        if WITHDRAWN.search(text):
            result = CostQuote(terms=text[:1200], evidence_quote=text[:1600]).model_dump()
        elif money_values(text) or FREE.search(text):
            result = quote_from_text(text)
        elif result["amount"] is not None and re.search(r"\b(?:additional|extra|plus|excluding|depends|depending)\b.{0,45}\b(?:fee|fees|charge|charges|fuel|cost|costs|distance|treatment)\b", text, re.I) and not re.search(r"\b(?:no|without) (?:additional|extra) (?:charges|fees|costs)\b", text, re.I):
            result.update(status="estimate", terms=text[:1200], evidence_quote=(result["evidence_quote"] + " / " + text)[:1600])
    return result


def validate_quote(raw: dict | None, evidence: dict, identity_confirmed: bool) -> dict:
    """Model descriptions can refine scope; numbers must exist in recipient words.

    The latest actual price statement overrides an earlier model-selected quote.
    Missing/mismatched evidence is downgraded instead of guessed.
    """
    grounded = extract_quote(evidence, identity_confirmed)
    if not raw or not identity_confirmed:
        return grounded
    proposed = CostQuote.model_validate(raw).model_dump()
    quote = " ".join(proposed["evidence_quote"].casefold().split())
    supported = len(quote) >= 8 and any(quote in " ".join(t.casefold().split()) for t in texts_from(evidence))
    if supported and proposed["amount"] == grounded["amount"] and proposed["currency"] == grounded["currency"]:
        # Never turn an explicit estimate into a fixed amount through model prose.
        grounded["scope"] = proposed["scope"] or grounded["scope"]
        grounded["terms"] = grounded["terms"] or proposed["terms"]
    return grounded


def describe_quote(quote: dict | None) -> str:
    q = quote or {}
    if q.get("status", "unknown") == "unknown" or q.get("amount") is None:
        return "Price not yet quoted"
    if q["status"] == "free":
        return "No charge (explicitly quoted)"
    return f"{q.get('currency', DEFAULT_CURRENCY)} {q['amount']:,.2f}" + (" estimate" if q["status"] == "estimate" else " quoted")


def cost_summary(requirements: list[dict], *, budget: float | None = None, currency: str = DEFAULT_CURRENCY) -> dict:
    selected = {}
    for n in requirements:
        if n.get("assignment"):
            a = n["assignment"]
            selected[a["contact_id"]] = a.get("quote") or CostQuote().model_dump()
    totals: dict[str, Decimal] = {}
    unknown = estimates = 0
    for q in selected.values():
        if q.get("amount") is None or q.get("status") == "unknown":
            unknown += 1
            continue
        key = q.get("currency", currency)
        totals[key] = totals.get(key, Decimal(0)) + Decimal(str(q["amount"]))
        estimates += q.get("status") == "estimate"
    comparable = len(totals) <= 1 and (not totals or currency in totals)
    known = float(totals.get(currency, Decimal(0)))
    return {"known_total": known, "currency": currency,
            "totals": {k: float(v.quantize(Decimal(".01"))) for k, v in totals.items()},
            "unknown_count": unknown, "estimate_count": estimates,
            "selected_helpers": len(selected), "all_prices_known": bool(selected) and unknown == 0,
            "budget": budget, "over_budget": bool(budget is not None and comparable and known > budget),
            "budget_comparable": comparable,
            "needs_acknowledgment": bool(unknown or estimates or any(q.get("amount", 0) for q in selected.values())),
            "note": "Each selected helper's quoted bundle is counted once. Not a payment or a final invoice."}


def check_callback_price(approved: dict, evidence: dict) -> tuple[bool, dict, str]:
    """A start callback must explicitly reconfirm price; changes need new approval."""
    actual = extract_quote(evidence)
    if actual["status"] == "unknown":
        return False, actual, "The helper did not confirm a final price. Do not treat them as engaged."
    if actual["status"] == "estimate":
        return False, actual, "The helper still gave an estimate or extra charges. A final agreed price is needed before starting."
    if approved.get("status") == "unknown":
        ok = actual["status"] == "free"
    else:
        ok = (actual["currency"] == approved.get("currency") and actual["amount"] <= approved.get("amount", -1))
    return ok, actual, ("The callback reconfirmed a price within the approved ceiling." if ok else "The callback price changed or exceeded the approved amount. No additional charge was accepted.")
