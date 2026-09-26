"""
Sourcy AI Procurement Agent

Handles:
- Procurement requests
- Supplier questions
- Supplier quotes
- Supplier comparison
- Supplier scoring
- Smart procurement scoring
- Supplier risk detection
- Supplier recommendations
- Decision summaries
- CALL-E supplier calls
"""

import os

from calle import CalleClient


# =========================================================
# PROCUREMENT REQUEST
# =========================================================

def create_procurement_request(
    product: str,
    quantity: int,
    location: str,
):
    return {
        "product": product,
        "quantity": quantity,
        "location": location,
    }


# =========================================================
# SUPPLIER QUESTIONS
# =========================================================

SUPPLIER_QUESTIONS = [
    "Do you have the requested product available?",
    "How much of the product do you currently have available?",
    "What is your price per unit?",
    "Do you offer delivery to the requested location?",
    "How much does delivery cost?",
    "How quickly can you deliver?",
    "Do you offer a discount for bulk orders?",
]


# =========================================================
# SUPPLIER QUOTE
# =========================================================

def create_supplier_quote(
    supplier_name: str,
    product: str,
    quantity_available: int,
    unit_price: float,
    delivery_available: bool,
    delivery_cost: float,
    delivery_time: str,
    bulk_discount: str,
):
    return {
        "supplier_name": supplier_name,
        "product": product,
        "product_available": quantity_available > 0,
        "quantity_available": quantity_available,
        "unit_price": unit_price,
        "delivery_available": delivery_available,
        "delivery_cost": delivery_cost,
        "delivery_time": delivery_time,
        "bulk_discount": bulk_discount,
    }


# =========================================================
# CALL-E TASK
# =========================================================

def create_supplier_call_task(
    request: dict,
    supplier_name: str,
):
    return f"""
You are Sourcy, an AI procurement agent.

Call {supplier_name} and collect factual information
about this procurement request.

Product: {request["product"]}

Quantity needed: {request["quantity"]}

Delivery location: {request["location"]}

Ask the supplier:

1. Is the requested product available?
2. How many units are currently available?
3. What is the price per unit?
4. Can they deliver to {request["location"]}?
5. What is the delivery cost?
6. How long will delivery take?
7. Do they offer a bulk discount?

Do not invent information.

If information is unavailable,
record it as unknown.

Return only information provided by the supplier.
"""


# =========================================================
# CALL SUPPLIER
# =========================================================

def call_supplier(
    request: dict,
    supplier_name: str,
    phone_number: str,
):
    client = CalleClient(
        api_key=os.environ["CALLE_API_KEY"]
    )

    supplier_schema = {
        "type": "object",
        "properties": {
            "supplier_name": {
                "type": "string"
            },
            "product_available": {
                "type": "boolean"
            },
            "quantity_available": {
                "type": "number"
            },
            "unit_price": {
                "type": "number"
            },
            "delivery_available": {
                "type": "boolean"
            },
            "delivery_cost": {
                "type": "number"
            },
            "delivery_time": {
                "type": "string"
            },
            "bulk_discount": {
                "type": "string"
            },
        },
        "required": [
            "supplier_name",
            "product_available",
            "quantity_available",
            "unit_price",
            "delivery_available",
            "delivery_cost",
            "delivery_time",
            "bulk_discount",
        ],
    }

    result = client.calls.create_and_wait(
        task=create_supplier_call_task(
            request,
            supplier_name,
        ),
        recipient={
            "phone": phone_number,
        },
        result_schema=supplier_schema,
    )

    return result


# =========================================================
# PROCESS CALL RESULT
# =========================================================

def process_call_result(
    call_result: dict,
):
    return {
        "status": call_result.get(
            "status",
            "unknown",
        ),
        "task_completed": call_result.get(
            "task_completed",
            False,
        ),
        "evidence": call_result.get(
            "structured_result",
            {},
        ),
    }


# =========================================================
# EXTRACT SUPPLIER QUOTE
# =========================================================

def extract_supplier_quote(
    call_result: dict,
):
    data = (
        call_result.get("structured_result")
        or {}
    )

    return {
        "supplier_name": data.get(
            "supplier_name"
        ),
        "product_available": data.get(
            "product_available",
            False,
        ),
        "quantity_available": data.get(
            "quantity_available",
            0,
        ),
        "unit_price": data.get(
            "unit_price",
            0,
        ),
        "delivery_available": data.get(
            "delivery_available",
            False,
        ),
        "delivery_cost": data.get(
            "delivery_cost",
            0,
        ),
        "delivery_time": data.get(
            "delivery_time",
            "Unknown",
        ),
        "bulk_discount": data.get(
            "bulk_discount",
            "None",
        ),
    }


# =========================================================
# COMPARE SUPPLIER QUOTES
# =========================================================

def compare_supplier_quotes(
    quotes: list,
    quantity_needed: int,
):
    valid_quotes = []

    for quote in quotes:

        if not quote.get(
            "product_available",
            False,
        ):
            continue

        if quote.get(
            "quantity_available",
            0,
        ) < quantity_needed:
            continue

        if not quote.get(
            "delivery_available",
            False,
        ):
            continue

        unit_price = quote.get(
            "unit_price",
            0,
        )

        delivery_cost = quote.get(
            "delivery_cost",
            0,
        )

        quote["total_cost"] = (
            quantity_needed * unit_price
        ) + delivery_cost

        valid_quotes.append(
            quote
        )

    return sorted(
        valid_quotes,
        key=lambda quote: quote["total_cost"],
    )


# =========================================================
# SUPPLIER SCORE
# =========================================================

def calculate_supplier_score(
    quote: dict,
    quantity_needed: int,
    all_quotes: list,
):
    if not quote.get(
        "product_available",
        False,
    ):
        return 0

    if quote.get(
        "quantity_available",
        0,
    ) < quantity_needed:
        return 0

    if not quote.get(
        "delivery_available",
        False,
    ):
        return 0

    score = 70

    valid_costs = [
        q.get(
            "total_cost",
            0,
        )
        for q in all_quotes
        if q.get(
            "total_cost",
            0,
        ) > 0
    ]

    if valid_costs:

        lowest_cost = min(
            valid_costs
        )

        if quote.get(
            "total_cost",
            0,
        ) == lowest_cost:
            score += 15

    if quote.get(
        "quantity_available",
        0,
    ) >= quantity_needed:
        score += 5

    if quote.get(
        "delivery_available",
        False,
    ):
        score += 5

    if str(
        quote.get(
            "bulk_discount",
            "",
        )
    ).lower() in [
        "yes",
        "true",
    ]:
        score += 5

    return min(
        score,
        100,
    )


# =========================================================
# DAY 12 — SMART PROCUREMENT SCORE
# =========================================================

def calculate_smart_supplier_score(
    quote: dict,
    quantity_needed: int,
    all_quotes: list,
    budget: float = None,
    urgency: str = "Normal",
):
    """
    Calculate a context-aware supplier score.

    Sourcy considers:
    - Product availability
    - Stock sufficiency
    - Total cost
    - Delivery availability
    - Bulk discounts
    - Procurement budget
    - Delivery urgency
    """

    # -----------------------------------------------------
    # BASIC VALIDATION
    # -----------------------------------------------------

    if not quote.get(
        "product_available",
        False,
    ):
        return 0

    if quote.get(
        "quantity_available",
        0,
    ) < quantity_needed:
        return 0

    if not quote.get(
        "delivery_available",
        False,
    ):
        return 0

    # -----------------------------------------------------
    # START WITH BASE SCORE
    # -----------------------------------------------------

    score = 70

    # -----------------------------------------------------
    # LOWEST COST
    # -----------------------------------------------------

    valid_costs = [
        q.get(
            "total_cost",
            0,
        )
        for q in all_quotes
        if q.get(
            "total_cost",
            0,
        ) > 0
    ]

    if valid_costs:

        lowest_cost = min(
            valid_costs
        )

        if quote.get(
            "total_cost",
            0,
        ) == lowest_cost:

            score += 15

    # -----------------------------------------------------
    # STOCK
    # -----------------------------------------------------

    if quote.get(
        "quantity_available",
        0,
    ) >= quantity_needed:

        score += 5

    # -----------------------------------------------------
    # DELIVERY
    # -----------------------------------------------------

    if quote.get(
        "delivery_available",
        False,
    ):

        score += 5

    # -----------------------------------------------------
    # BULK DISCOUNT
    # -----------------------------------------------------

    if str(
        quote.get(
            "bulk_discount",
            "",
        )
    ).lower() in [
        "yes",
        "true",
    ]:

        score += 5

    # =====================================================
    # BUDGET AWARENESS
    # =====================================================

    if budget is not None and budget > 0:

        total_cost = quote.get(
            "total_cost",
            0,
        )

        # Within budget
        if total_cost <= budget:

            score += 10

        # Slightly above budget
        elif total_cost <= budget * 1.10:

            score -= 5

        # Significantly above budget
        else:

            score -= 15

    # =====================================================
    # URGENCY AWARENESS
    # =====================================================

    urgency_normalized = str(
        urgency
    ).strip().lower()

    delivery_text = str(
        quote.get(
            "delivery_time",
            "",
        )
    ).lower()

    # -----------------------------------------------------
    # URGENT PROCUREMENT
    # -----------------------------------------------------

    if urgency_normalized == "urgent":

        if (
            "same day" in delivery_text
            or "today" in delivery_text
        ):

            score += 15

        elif "1 day" in delivery_text:

            score += 10

        elif "2 day" in delivery_text:

            score += 5

        else:

            score -= 5

    # -----------------------------------------------------
    # NORMAL PROCUREMENT
    # -----------------------------------------------------

    elif urgency_normalized == "normal":

        if (
            "same day" in delivery_text
            or "today" in delivery_text
            or "1 day" in delivery_text
            or "2 day" in delivery_text
        ):

            score += 5

    # -----------------------------------------------------
    # LOW URGENCY
    # -----------------------------------------------------

    elif urgency_normalized in [
        "low",
        "flexible",
    ]:

        # Cost matters more when delivery is flexible.
        if valid_costs:

            if quote.get(
                "total_cost",
                0,
            ) == min(valid_costs):

                score += 5

    return max(
        0,
        min(
            score,
            100,
        ),
    )


# =========================================================
# DAY 12.4 — SUPPLIER RISK DETECTION
# =========================================================

def detect_supplier_risk(
    quote: dict,
    quantity_needed: int,
    all_quotes: list,
    urgency: str = "Normal",
):
    """
    Detect procurement risks associated with a supplier.

    Sourcy checks:
    - Very limited stock buffer
    - Slow delivery
    - Higher-than-average cost
    - No bulk discount for larger orders
    - Slow delivery during urgent procurement

    Returns a structured risk assessment.
    """

    risks = []

    # -----------------------------------------------------
    # BASIC VALUES
    # -----------------------------------------------------

    quantity_available = quote.get(
        "quantity_available",
        0,
    )

    total_cost = quote.get(
        "total_cost",
        0,
    )

    delivery_time = str(
        quote.get(
            "delivery_time",
            "Unknown",
        )
    ).lower()

    urgency_normalized = str(
        urgency
    ).strip().lower()

    # -----------------------------------------------------
    # RISK 1 — LOW STOCK BUFFER
    # -----------------------------------------------------

    if quantity_needed > 0:

        stock_buffer = (
            quantity_available
            - quantity_needed
        )

        stock_ratio = (
            quantity_available
            / quantity_needed
        )

        # Supplier has only 0–20% extra stock.
        if (
            stock_buffer >= 0
            and stock_ratio <= 1.20
        ):

            risks.append(
                "Low stock buffer: supplier has "
                "very little stock beyond the requested quantity."
            )

    # -----------------------------------------------------
    # RISK 2 — SLOW DELIVERY
    # -----------------------------------------------------

    if (
        "7 day" in delivery_time
        or "8 day" in delivery_time
        or "9 day" in delivery_time
        or "10 day" in delivery_time
        or "week" in delivery_time
    ):

        risks.append(
            "Slow delivery: supplier may take "
            "a long time to deliver the order."
        )

    # -----------------------------------------------------
    # RISK 3 — HIGHER COST
    # -----------------------------------------------------

    valid_costs = [
        q.get(
            "total_cost",
            0,
        )
        for q in all_quotes
        if q.get(
            "total_cost",
            0,
        ) > 0
    ]

    if valid_costs and total_cost > 0:

        average_cost = (
            sum(valid_costs)
            / len(valid_costs)
        )

        # More than 10% above the average supplier cost.
        if total_cost > average_cost * 1.10:

            risks.append(
                "Higher cost: this supplier is "
                "significantly more expensive than the average quote."
            )

    # -----------------------------------------------------
    # RISK 4 — NO BULK DISCOUNT
    # -----------------------------------------------------

    if quantity_needed >= 100:

        if str(
            quote.get(
                "bulk_discount",
                "",
            )
        ).lower() not in [
            "yes",
            "true",
        ]:

            risks.append(
                "No bulk discount: the supplier does "
                "not offer a bulk-order discount."
            )

    # -----------------------------------------------------
    # RISK 5 — URGENT + SLOW DELIVERY
    # -----------------------------------------------------

    if urgency_normalized == "urgent":

        if (
            "same day" not in delivery_time
            and "today" not in delivery_time
            and "1 day" not in delivery_time
            and "2 day" not in delivery_time
        ):

            risks.append(
                "Urgency risk: delivery may be too slow "
                "for an urgent procurement request."
            )

    # =====================================================
    # DETERMINE OVERALL RISK LEVEL
    # =====================================================

    risk_count = len(risks)

    if risk_count == 0:

        risk_level = "Low"

    elif risk_count == 1:

        risk_level = "Medium"

    else:

        risk_level = "High"

    return {
        "risk_level": risk_level,
        "risk_count": risk_count,
        "risks": risks,
    }


# =========================================================
# RECOMMEND SUPPLIER
# =========================================================

def recommend_supplier(
    quotes: list,
    quantity_needed: int,
):
    if not quotes:
        return None

    best = quotes[0]

    reasons = []

    if best.get(
        "quantity_available",
        0,
    ) >= quantity_needed:

        reasons.append(
            f"has enough stock to fulfill "
            f"the requested {quantity_needed} units"
        )

    if all(
        best.get("total_cost", 0)
        <= quote.get("total_cost", 0)
        for quote in quotes
    ):

        reasons.append(
            f"has the lowest estimated "
            f"total cost of ₦"
            f"{best['total_cost']:,.0f}"
        )

    if best.get(
        "delivery_available",
        False,
    ):

        reasons.append(
            "can deliver the requested order"
        )

    if str(
        best.get(
            "bulk_discount",
            "",
        )
    ).lower() in [
        "yes",
        "true",
    ]:

        reasons.append(
            "offers a bulk discount"
        )

    return {
        "supplier": best.get(
            "supplier_name"
        ),
        "reasons": reasons,
    }


# =========================================================
# PREPARE SUPPLIER CALLS
# =========================================================

def prepare_supplier_calls(
    request: dict,
    suppliers: list,
):
    calls = []

    for supplier in suppliers:

        calls.append({
            "supplier_name": supplier["name"],
            "phone": supplier["phone"],
            "task": create_supplier_call_task(
                request,
                supplier["name"],
            ),
        })

    return calls


# =========================================================
# SOURCING WORKFLOW
# =========================================================

def run_sourcing_workflow(
    request: dict,
    supplier_quotes: list,
):
    ranked_quotes = compare_supplier_quotes(
        supplier_quotes,
        request["quantity"],
    )

    for quote in ranked_quotes:

        quote["score"] = calculate_supplier_score(
            quote=quote,
            quantity_needed=request["quantity"],
            all_quotes=ranked_quotes,
        )

    ranked_quotes = sorted(
        ranked_quotes,
        key=lambda quote: quote["score"],
        reverse=True,
    )

    recommendation = recommend_supplier(
        ranked_quotes,
        request["quantity"],
    )

    return {
        "request": request,
        "suppliers_contacted": len(
            supplier_quotes
        ),
        "ranked_quotes": ranked_quotes,
        "recommendation": recommendation,
    }


# =========================================================
# DAY 12 — SMART SOURCING WORKFLOW
# =========================================================

def run_smart_sourcing_workflow(
    request: dict,
    supplier_quotes: list,
    budget: float = None,
    urgency: str = "Normal",
):
    """
    Run Sourcy's context-aware procurement workflow.

    Considers:
    - Procurement budget
    - Delivery urgency
    - Supplier risk
    """

    ranked_quotes = compare_supplier_quotes(
        supplier_quotes,
        request["quantity"],
    )

    # -----------------------------------------------------
    # CALCULATE SMART SCORES AND RISK
    # -----------------------------------------------------

    for quote in ranked_quotes:

        quote["smart_score"] = (
            calculate_smart_supplier_score(
                quote=quote,
                quantity_needed=request["quantity"],
                all_quotes=ranked_quotes,
                budget=budget,
                urgency=urgency,
            )
        )

        quote["risk"] = detect_supplier_risk(
            quote=quote,
            quantity_needed=request["quantity"],
            all_quotes=ranked_quotes,
            urgency=urgency,
        )

    # -----------------------------------------------------
    # RANK BY SMART SCORE
    # -----------------------------------------------------

    ranked_quotes = sorted(
        ranked_quotes,
        key=lambda quote: (
            quote["smart_score"],
            -quote["total_cost"],
        ),
        reverse=True,
    )

    # -----------------------------------------------------
    # RECOMMEND TOP SUPPLIER
    # -----------------------------------------------------

    recommendation = None

    if ranked_quotes:

        best = ranked_quotes[0]

        recommendation = {
            "supplier": best.get(
                "supplier_name"
            ),
            "reasons": [],
            "smart_score": best.get(
                "smart_score",
                0,
            ),
        }

        # -------------------------------------------------
        # BUILD SMART REASONS
        # -------------------------------------------------

        if best.get(
            "quantity_available",
            0,
        ) >= request["quantity"]:

            recommendation["reasons"].append(
                f"has enough stock to fulfill "
                f"the requested {request['quantity']} units"
            )

        if budget is not None and budget > 0:

            if best.get(
                "total_cost",
                0,
            ) <= budget:

                recommendation["reasons"].append(
                    "fits within the procurement budget"
                )

            else:

                recommendation["reasons"].append(
                    "is above the procurement budget"
                )

        if urgency.lower() == "urgent":

            recommendation["reasons"].append(
                "was evaluated with delivery speed "
                "prioritized because the request is urgent"
            )

        if best.get(
            "delivery_available",
            False,
        ):

            recommendation["reasons"].append(
                "can deliver the requested order"
            )

        if str(
            best.get(
                "bulk_discount",
                "",
            )
        ).lower() in [
            "yes",
            "true",
        ]:

            recommendation["reasons"].append(
                "offers a bulk discount"
            )

        # -------------------------------------------------
        # LOWEST COST REASON
        # -------------------------------------------------

        if all(
            best.get("total_cost", 0)
            <= quote.get("total_cost", 0)
            for quote in ranked_quotes
        ):

            recommendation["reasons"].append(
                f"has the lowest estimated total cost "
                f"of ₦{best['total_cost']:,.0f}"
            )

        # -------------------------------------------------
        # RISK INFORMATION
        # -------------------------------------------------

        best_risk = best.get(
            "risk",
            {},
        )

        if best_risk.get(
            "risk_level"
        ) == "Low":

            recommendation["reasons"].append(
                "has a low supplier risk level"
            )

        elif best_risk.get(
            "risk_level"
        ) == "Medium":

            recommendation["reasons"].append(
                "has a medium supplier risk level"
            )

        elif best_risk.get(
            "risk_level"
        ) == "High":

            recommendation["reasons"].append(
                "has a high supplier risk level"
            )

    return {
        "request": request,
        "budget": budget,
        "urgency": urgency,
        "suppliers_contacted": len(
            supplier_quotes
        ),
        "ranked_quotes": ranked_quotes,
        "recommendation": recommendation,
    }


# =========================================================
# DECISION SUMMARY
# =========================================================

def generate_decision_summary(
    request: dict,
    recommendation: dict,
):
    """
    Generate a natural-language procurement decision.
    """

    if not recommendation:

        return (
            f"Sourcy could not find a supplier "
            f"that can fulfill the request for "
            f"{request['quantity']} units of "
            f"{request['product']}."
        )

    supplier = recommendation["supplier"]
    reasons = recommendation["reasons"]

    if not reasons:

        return (
            f"Sourcy recommends purchasing "
            f"{request['quantity']} units of "
            f"{request['product']} from "
            f"{supplier}."
        )

    # -----------------------------------------------------
    # BUILD NATURAL REASON SENTENCE
    # -----------------------------------------------------

    reason_parts = []

    for reason in reasons:

        if reason.startswith("has "):

            reason_parts.append(
                "it " + reason
            )

        elif reason.startswith("can "):

            reason_parts.append(
                reason
            )

        elif reason.startswith("offers "):

            reason_parts.append(
                reason
            )

        else:

            reason_parts.append(
                reason
            )

    if len(reason_parts) == 1:

        reason_text = reason_parts[0]

    elif len(reason_parts) == 2:

        reason_text = (
            f"{reason_parts[0]} and "
            f"{reason_parts[1]}"
        )

    else:

        reason_text = (
            ", ".join(reason_parts[:-1])
            + ", and "
            + reason_parts[-1]
        )

    return (
        f"Sourcy recommends purchasing "
        f"{request['quantity']} units of "
        f"{request['product']} from "
        f"{supplier} because {reason_text}."
    )
