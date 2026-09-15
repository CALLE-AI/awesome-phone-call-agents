import os
import streamlit as st

from app.suppliers import get_suppliers

from app.agent import (
    create_procurement_request,
    extract_supplier_quote,
    run_smart_sourcing_workflow,
    generate_decision_summary,
)

from calle import CalleClient


# =========================================================
# PAGE CONFIG
# =========================================================

st.set_page_config(
    page_title="Sourcy | AI Procurement Agent",
    page_icon="🛒",
    layout="centered",
)


# =========================================================
# SESSION STATE
# =========================================================

if "procurement_history" not in st.session_state:
    st.session_state.procurement_history = []


# =========================================================
# HEADER
# =========================================================

st.title("🛒 Sourcy")
st.subheader("AI Procurement Agent")

st.write(
    "Sourcy helps you find the best supplier by collecting "
    "supplier information, comparing prices, checking "
    "availability, evaluating supplier risk, and recommending "
    "the best option for your procurement situation."
)

st.divider()


# =========================================================
# MODE
# =========================================================

demo_mode = st.checkbox(
    "🧪 Demo Mode",
    value=True,
    help="Test Sourcy without making a real phone call.",
)

if demo_mode:

    st.caption(
        "Demo Mode is ON — no phone calls will be made."
    )

else:

    st.warning(
        "⚠️ Live Mode is ON. This will make a real supplier phone call."
    )


# =========================================================
# PROCUREMENT REQUEST
# =========================================================

st.write("## 📋 Procurement Request")

product = st.text_input(
    "What do you need?",
    value="cement",
    placeholder="e.g. cement, laptops, office chairs",
)

quantity = st.number_input(
    "Quantity",
    min_value=1,
    value=500,
    step=1,
)

location = st.text_input(
    "Delivery Location",
    value="Abuja",
    placeholder="e.g. Abuja",
)


# =========================================================
# BUDGET
# =========================================================

st.write("### 💰 Procurement Budget")

budget = st.number_input(
    "Maximum Budget (₦)",
    min_value=0.0,
    value=5000000.0,
    step=100000.0,
    help="Enter the maximum amount you want to spend. Enter 0 if there is no budget limit.",
)

if budget > 0:

    st.caption(
        f"Sourcy will prioritize suppliers that fit within "
        f"your ₦{budget:,.0f} budget."
    )

else:

    st.caption(
        "No budget limit set."
    )


# =========================================================
# URGENCY
# =========================================================

st.write("### 🚚 Delivery Urgency")

urgency = st.selectbox(
    "How urgent is this procurement?",
    options=[
        "Normal",
        "Urgent",
        "Low",
    ],
    index=0,
)


# =========================================================
# SUPPLIER PHONE — LIVE MODE ONLY
# =========================================================

supplier_phone = None

if not demo_mode:

    supplier_phone = st.text_input(
        "Supplier Phone Number",
        value="",
        placeholder="+234...",
    )


# =========================================================
# FIND BEST SUPPLIER
# =========================================================

if st.button(
    "🔎 Find Best Supplier",
    use_container_width=True,
    type="primary",
):

    # -----------------------------------------------------
    # VALIDATION
    # -----------------------------------------------------

    if not product.strip():

        st.error(
            "Please enter a product."
        )

        st.stop()


    if not location.strip():

        st.error(
            "Please enter a delivery location."
        )

        st.stop()


    if not demo_mode and not supplier_phone:

        st.error(
            "Please enter a supplier phone number."
        )

        st.stop()


    # -----------------------------------------------------
    # CREATE PROCUREMENT REQUEST
    # -----------------------------------------------------

    with st.spinner(
        "Creating procurement request..."
    ):

        request = create_procurement_request(
            product=product.strip(),
            quantity=quantity,
            location=location.strip(),
        )


    st.success(
        "✅ Procurement request created."
    )


    # =====================================================
    # REQUEST SUMMARY
    # =====================================================

    st.write("### 📋 Request Summary")

    col1, col2, col3 = st.columns(3)

    with col1:

        st.metric(
            "Product",
            request["product"].title(),
        )

    with col2:

        st.metric(
            "Quantity",
            f"{request['quantity']:,}",
        )

    with col3:

        st.metric(
            "Location",
            request["location"],
        )


    # =====================================================
    # PROCUREMENT CONDITIONS
    # =====================================================

    col1, col2 = st.columns(2)

    with col1:

        st.metric(
            "Budget",
            (
                f"₦{budget:,.0f}"
                if budget > 0
                else "No Limit"
            ),
        )

    with col2:

        st.metric(
            "Urgency",
            urgency,
        )


    st.divider()


    # =====================================================
    # DEMO MODE
    # =====================================================

    if demo_mode:

        st.info(
            "🧪 Demo Mode: Using sample supplier quotes. "
            "No phone call was made."
        )

        suppliers = get_suppliers()

        supplier_quotes = []

        for supplier in suppliers:

            quote = supplier["demo_quote"].copy()

            quote["supplier_name"] = supplier["name"]

            supplier_quotes.append(quote)


    # =====================================================
    # LIVE CALL-E MODE
    # =====================================================

    else:

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


        # -------------------------------------------------
        # CALL-E CLIENT
        # -------------------------------------------------

        try:

            client = CalleClient(
                api_key=os.environ["CALLE_API_KEY"]
            )

        except Exception as e:

            st.error(
                f"❌ Could not initialize CALL-E: {e}"
            )

            st.stop()


        # -------------------------------------------------
        # CALL SUPPLIER
        # -------------------------------------------------

        with st.spinner(
            "📞 Calling supplier..."
        ):

            try:

                result = client.calls.create_and_wait(

                    task=f"""
You are Sourcy, an AI procurement agent.

Call the supplier and collect factual information about this procurement request.

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

Do not invent or assume any information.

If the supplier does not know or does not provide an answer,
record the information as unknown.
""",

                    recipient={
                        "phone": supplier_phone,
                    },

                    result_schema=supplier_schema,

                )

            except Exception as e:

                st.error(
                    f"❌ Could not contact the supplier: {e}"
                )

                st.stop()


        st.success(
            "☎️ Supplier contacted successfully."
        )


        quote = extract_supplier_quote(
            result
        )

        supplier_quotes = [quote]


    # =====================================================
    # RUN SMART SOURCY WORKFLOW
    # =====================================================

    with st.spinner(
        "🤖 Sourcy is analyzing suppliers..."
    ):

        workflow_result = run_smart_sourcing_workflow(
            request=request,
            supplier_quotes=supplier_quotes,
            budget=(
                budget
                if budget > 0
                else None
            ),
            urgency=urgency,
        )


    # =====================================================
    # EXTRACT FINAL DECISION
    # =====================================================

    ranked_quotes = workflow_result.get(
        "ranked_quotes",
        [],
    )

    recommendation = workflow_result.get(
        "recommendation"
    )


    # =====================================================
    # IDENTIFY WINNER
    # =====================================================

    winner = (
        ranked_quotes[0]
        if ranked_quotes
        else None
    )


    # =====================================================
    # EXTRACT WINNER RISK
    # =====================================================

    winner_risk = (
        winner.get("risk", {})
        if winner
        else {}
    )

    winner_risk_level = winner_risk.get(
        "risk_level",
        "Unknown",
    )

    winner_risk_reasons = winner_risk.get(
        "risks",
        [],
    )


    # =====================================================
    # SAVE COMPLETE PROCUREMENT HISTORY
    # =====================================================

    history_item = {

        "product": request["product"],

        "quantity": request["quantity"],

        "location": request["location"],

        "budget": (
            budget
            if budget > 0
            else None
        ),

        "urgency": urgency,

        "supplier": (
            recommendation["supplier"]
            if recommendation
            else None
        ),

        "score": (
            winner.get("smart_score", 0)
            if winner
            else 0
        ),

        "total_cost": (
            winner.get("total_cost", 0)
            if winner
            else 0
        ),

        "delivery": (
            winner.get("delivery_time", "Unavailable")
            if winner
            else "Unavailable"
        ),

        "risk": winner_risk_level,

        "risk_reasons": winner_risk_reasons,

        "reasons": (
            recommendation.get("reasons", [])
            if recommendation
            else []
        ),

        "status": (
            "Recommended"
            if recommendation
            else "No suitable supplier"
        ),

    }


    st.session_state.procurement_history.append(
        history_item
    )


    # =====================================================
    # SUPPLIER COMPARISON
    # =====================================================

    st.write("## 📦 Supplier Comparison")

    if ranked_quotes:

        for index, quote in enumerate(ranked_quotes):

            if index == 0:

                st.success(
                    f"🏆 #{index + 1} — "
                    f"{quote['supplier_name']}"
                )

            else:

                st.write(
                    f"### #{index + 1} — "
                    f"{quote['supplier_name']}"
                )


            col1, col2, col3 = st.columns(3)

            with col1:

                st.metric(
                    "Stock",
                    f"{quote['quantity_available']:,} units",
                )

            with col2:

                st.metric(
                    "Price / Unit",
                    f"₦{quote['unit_price']:,.0f}",
                )

            with col3:

                st.metric(
                    "Smart Score",
                    f"{quote['smart_score']}/100",
                )


            st.write(
                f"💰 **Total Cost:** "
                f"₦{quote['total_cost']:,.0f}"
            )


            # -------------------------------------------------
            # BUDGET STATUS
            # -------------------------------------------------

            if budget > 0:

                if quote["total_cost"] <= budget:

                    st.success(
                        f"✅ Within budget — "
                        f"₦{budget - quote['total_cost']:,.0f} remaining"
                    )

                else:

                    st.error(
                        f"⚠️ Over budget by "
                        f"₦{quote['total_cost'] - budget:,.0f}"
                    )


            # -------------------------------------------------
            # SMART EXPLANATION
            # -------------------------------------------------

            with st.expander("🔍 Why this score?"):

                st.write(
                    "Sourcy considers:"
                )

                if quote["total_cost"] == min(
                    q["total_cost"]
                    for q in ranked_quotes
                ):

                    st.write(
                        "✅ Lowest total cost"
                    )

                if quote["quantity_available"] >= request["quantity"]:

                    st.write(
                        "✅ Enough stock available"
                    )

                if quote["delivery_available"]:

                    st.write(
                        "✅ Delivery available"
                    )

                if str(
                    quote["bulk_discount"]
                ).lower() in ["yes", "true"]:

                    st.write(
                        "✅ Bulk discount available"
                    )

                if budget > 0:

                    if quote["total_cost"] <= budget:

                        st.write(
                            "✅ Within procurement budget"
                        )

                    else:

                        st.write(
                            "⚠️ Above procurement budget"
                        )


                if urgency == "Urgent":

                    st.write(
                        "🚨 Delivery speed prioritized "
                        "because procurement is urgent"
                    )


                # -------------------------------------------------
                # RISK EXPLANATION
                # -------------------------------------------------

                risk = quote.get(
                    "risk",
                    {},
                )

                risk_level = risk.get(
                    "risk_level",
                    "Unknown",
                )

                if risk_level == "Low":

                    st.success(
                        "🛡️ Supplier Risk: Low"
                    )

                elif risk_level == "Medium":

                    st.warning(
                        "⚠️ Supplier Risk: Medium"
                    )

                elif risk_level == "High":

                    st.error(
                        "🚨 Supplier Risk: High"
                    )

                else:

                    st.info(
                        "🛡️ Supplier Risk: Unknown"
                    )


                risk_reasons = risk.get(
                    "risks",
                    [],
                )

                if risk_reasons:

                    st.write(
                        "**Risk factors detected:**"
                    )

                    for risk_reason in risk_reasons:

                        st.write(
                            f"⚠️ {risk_reason}"
                        )

                else:

                    st.write(
                        "✅ No significant supplier risks detected."
                    )


            col4, col5 = st.columns(2)

            with col4:

                st.write(
                    f"🚚 **Delivery:** "
                    f"{quote['delivery_time']}"
                )

            with col5:

                st.write(
                    f"💸 **Bulk Discount:** "
                    f"{quote['bulk_discount']}"
                )


            st.divider()


    else:

        st.warning(
            "No suppliers can fulfill this procurement request."
        )


    # =====================================================
    # AI DECISION SUMMARY
    # =====================================================

    if recommendation:

        st.write("## 🧠 Sourcy AI Decision")

        decision_summary = generate_decision_summary(
            request,
            recommendation,
        )

        st.info(
            decision_summary
        )


        # =================================================
        # SMART RECOMMENDATION
        # =================================================

        st.write("## 🏆 Sourcy Recommendation")

        st.success(
            f"### {recommendation['supplier']}"
        )


        winner = ranked_quotes[0]

        col1, col2, col3 = st.columns(3)

        with col1:

            st.metric(
                "Smart Score",
                f"{winner['smart_score']}/100",
            )

        with col2:

            st.metric(
                "Total Cost",
                f"₦{winner['total_cost']:,.0f}",
            )

        with col3:

            st.metric(
                "Delivery",
                winner["delivery_time"],
            )


        # =================================================
        # WHY SOURCY CHOSE THIS SUPPLIER
        # =================================================

        st.write(
            "### 🧠 Why Sourcy chose this supplier"
        )

        st.caption(
            "Sourcy combines procurement requirements, "
            "cost, budget, delivery urgency, stock, "
            "and supplier risk before making its recommendation."
        )


        for reason in recommendation["reasons"]:

            st.write(
                f"✅ {reason}"
            )


        # =================================================
        # SUPPLIER RISK EXPLANATION
        # =================================================

        st.write(
            "### 🛡️ Supplier Risk Assessment"
        )

        if winner_risk_level == "Low":

            st.success(
                "🟢 Low Risk — Sourcy detected no "
                "significant supplier risk factors."
            )

        elif winner_risk_level == "Medium":

            st.warning(
                "🟡 Medium Risk — Sourcy identified "
                "some factors that should be considered "
                "before placing the order."
            )

        elif winner_risk_level == "High":

            st.error(
                "🔴 High Risk — Sourcy identified multiple "
                "supplier risk factors that should be reviewed "
                "before placing the order."
            )

        else:

            st.info(
                "Risk level could not be determined."
            )


        if winner_risk_reasons:

            st.write(
                "**Why this supplier has this risk level:**"
            )

            for risk_reason in winner_risk_reasons:

                st.write(
                    f"⚠️ {risk_reason}"
                )

        else:

            st.write(
                "✅ No significant risk factors were detected."
            )


        # =================================================
        # DECISION FACTORS
        # =================================================

        with st.expander(
            "🔎 View Sourcy's decision factors"
        ):

            st.write(
                "Sourcy evaluated the recommendation using:"
            )

            st.write(
                f"📦 **Quantity:** "
                f"{request['quantity']:,} units"
            )

            if budget > 0:

                st.write(
                    f"💰 **Maximum Budget:** "
                    f"₦{budget:,.0f}"
                )

            else:

                st.write(
                    "💰 **Budget:** No limit"
                )

            st.write(
                f"🚚 **Urgency:** {urgency}"
            )

            st.write(
                f"📦 **Available Stock:** "
                f"{winner['quantity_available']:,} units"
            )

            st.write(
                f"💵 **Estimated Total Cost:** "
                f"₦{winner['total_cost']:,.0f}"
            )

            st.write(
                f"🚚 **Delivery:** "
                f"{winner['delivery_time']}"
            )

            st.write(
                f"💸 **Bulk Discount:** "
                f"{winner['bulk_discount']}"
            )

            st.write(
                f"🛡️ **Supplier Risk:** "
                f"{winner_risk_level}"
            )

            st.write(
                f"⭐ **Smart Score:** "
                f"{winner['smart_score']}/100"
            )


        # =================================================
        # COST BREAKDOWN
        # =================================================

        st.write("### 💰 Cost Breakdown")

        product_cost = (
            request["quantity"]
            * winner["unit_price"]
        )

        delivery_cost = winner["delivery_cost"]

        total_cost = (
            product_cost
            + delivery_cost
        )


        col1, col2, col3 = st.columns(3)

        with col1:

            st.metric(
                "Products",
                f"₦{product_cost:,.0f}",
            )

        with col2:

            st.metric(
                "Delivery",
                f"₦{delivery_cost:,.0f}",
            )

        with col3:

            st.metric(
                "Total",
                f"₦{total_cost:,.0f}",
            )


        # -------------------------------------------------
        # BUDGET SUMMARY
        # -------------------------------------------------

        if budget > 0:

            st.write("### 💰 Budget Analysis")

            if total_cost <= budget:

                st.success(
                    f"✅ The recommended supplier is within "
                    f"budget with ₦{budget - total_cost:,.0f} remaining."
                )

            else:

                st.warning(
                    f"⚠️ The recommended supplier exceeds "
                    f"your budget by ₦{total_cost - budget:,.0f}."
                )


        # =================================================
        # PROCUREMENT SUMMARY
        # =================================================

        st.write("### 📄 Procurement Summary")

        st.info(
            f"""
**Decision:** Purchase **{request['quantity']:,} {request['product']}**
from **{recommendation['supplier']}**.

**Sourcy Smart Score:** {winner['smart_score']}/100

**Estimated Total:** ₦{winner['total_cost']:,.0f}

**Budget:** {
    f"₦{budget:,.0f}"
    if budget > 0
    else "No Limit"
}

**Urgency:** {urgency}

**Delivery:** {winner['delivery_time']}

**Bulk Discount:** {winner['bulk_discount']}

**Supplier Risk:** {winner_risk_level}
"""
        )


    else:

        st.warning(
            "⚠️ Sourcy could not find a suitable supplier "
            "for this request."
        )


# =========================================================
# PROCUREMENT INTELLIGENCE DASHBOARD
# =========================================================

st.divider()

st.write("## 📊 Procurement Intelligence Dashboard")

st.caption(
    "A live overview of your procurement activity, "
    "supplier performance, spending, and recommendations."
)


if st.session_state.procurement_history:

    history = st.session_state.procurement_history

    recommended_items = [
        item
        for item in history
        if item["status"] == "Recommended"
        and item["supplier"]
    ]


    # =====================================================
    # OVERALL PROCUREMENT METRICS
    # =====================================================

    total_requests = len(history)

    total_units = sum(
        item["quantity"]
        for item in history
    )

    total_spending = sum(
        item["total_cost"]
        for item in recommended_items
    )

    scores = [
        item["score"]
        for item in recommended_items
        if item["score"] > 0
    ]

    average_score = (
        sum(scores) / len(scores)
        if scores
        else 0
    )


    st.write("### 📈 Overview")

    col1, col2 = st.columns(2)

    with col1:

        st.metric(
            "Procurement Requests",
            f"{total_requests:,}",
        )

        st.metric(
            "Total Units Requested",
            f"{total_units:,}",
        )

    with col2:

        st.metric(
            "Total Procurement Spend",
            f"₦{total_spending:,.0f}",
        )

        st.metric(
            "Average Supplier Score",
            f"{average_score:.1f}/100",
        )


    st.divider()


    # =====================================================
    # SUPPLIER PERFORMANCE CALCULATIONS
    # =====================================================

    supplier_performance = {}

    for item in recommended_items:

        supplier = item["supplier"]

        if supplier not in supplier_performance:

            supplier_performance[supplier] = {
                "times_recommended": 0,
                "scores": [],
                "total_spending": 0,
            }


        supplier_performance[supplier][
            "times_recommended"
        ] += 1


        if item["score"] > 0:

            supplier_performance[supplier][
                "scores"
            ].append(
                item["score"]
            )


        supplier_performance[supplier][
            "total_spending"
        ] += item["total_cost"]


    # =====================================================
    # SUPPLIER PERFORMANCE DASHBOARD
    # =====================================================

    st.write("### 🏆 Supplier Performance")

    if supplier_performance:

        for supplier, performance in (
            supplier_performance.items()
        ):

            supplier_scores = performance[
                "scores"
            ]

            average_supplier_score = (
                sum(supplier_scores)
                / len(supplier_scores)
                if supplier_scores
                else 0
            )


            with st.container(
                border=True
            ):

                st.write(
                    f"#### 🏢 {supplier}"
                )

                col1, col2, col3 = st.columns(3)

                with col1:

                    st.metric(
                        "Recommended",
                        f"{performance['times_recommended']}x",
                    )

                with col2:

                    st.metric(
                        "Average Score",
                        f"{average_supplier_score:.1f}/100",
                    )

                with col3:

                    st.metric(
                        "Spend",
                        f"₦{performance['total_spending']:,.0f}",
                    )


    else:

        st.info(
            "No supplier performance data yet."
        )


    st.divider()


    # =====================================================
    # PROCUREMENT INSIGHT CALCULATIONS
    # =====================================================

    average_units = (
        total_units / total_requests
        if total_requests
        else 0
    )

    average_spending = (
        total_spending / len(recommended_items)
        if recommended_items
        else 0
    )


    supplier_counts = {}

    supplier_scores = {}

    supplier_spending = {}


    for item in recommended_items:

        supplier = item["supplier"]


        supplier_counts[supplier] = (
            supplier_counts.get(
                supplier,
                0,
            )
            + 1
        )


        if supplier not in supplier_scores:

            supplier_scores[supplier] = []


        if item["score"] > 0:

            supplier_scores[
                supplier
            ].append(
                item["score"]
            )


        supplier_spending[supplier] = (
            supplier_spending.get(
                supplier,
                0,
            )
            + item["total_cost"]
        )


    # -----------------------------------------------------
    # MOST RECOMMENDED
    # -----------------------------------------------------

    most_recommended_supplier = None

    if supplier_counts:

        most_recommended_supplier = max(
            supplier_counts,
            key=supplier_counts.get,
        )


    # -----------------------------------------------------
    # BEST SCORE
    # -----------------------------------------------------

    best_score_supplier = None

    best_average_score = 0


    for supplier, supplier_score_list in (
        supplier_scores.items()
    ):

        if not supplier_score_list:

            continue

        supplier_average = (
            sum(supplier_score_list)
            / len(supplier_score_list)
        )

        if supplier_average > best_average_score:

            best_average_score = supplier_average

            best_score_supplier = supplier


    # -----------------------------------------------------
    # HIGHEST SPEND
    # -----------------------------------------------------

    highest_spending_supplier = None

    highest_spending = 0


    if supplier_spending:

        highest_spending_supplier = max(
            supplier_spending,
            key=supplier_spending.get,
        )

        highest_spending = (
            supplier_spending[
                highest_spending_supplier
            ]
        )


    # =====================================================
    # INTELLIGENCE CARDS
    # =====================================================

    st.write("### 🧠 Procurement Intelligence")

    col1, col2 = st.columns(2)

    with col1:

        with st.container(
            border=True
        ):

            st.write(
                "#### 📦 Average Order"
            )

            st.metric(
                "Units / Request",
                f"{average_units:,.0f}",
            )

            st.caption(
                "Average quantity requested per procurement."
            )


    with col2:

        with st.container(
            border=True
        ):

            st.write(
                "#### 💰 Average Procurement"
            )

            st.metric(
                "Spend / Request",
                f"₦{average_spending:,.0f}",
            )

            st.caption(
                "Average spending for successful procurement requests."
            )


    col3, col4 = st.columns(2)

    with col3:

        with st.container(
            border=True
        ):

            st.write(
                "#### 🏆 Most Recommended"
            )

            if most_recommended_supplier:

                st.success(
                    most_recommended_supplier
                )

                st.caption(
                    f"Recommended "
                    f"{supplier_counts[most_recommended_supplier]} time(s)."
                )

            else:

                st.info(
                    "Not enough data yet."
                )


    with col4:

        with st.container(
            border=True
        ):

            st.write(
                "#### ⭐ Best Performing"
            )

            if best_score_supplier:

                st.success(
                    best_score_supplier
                )

                st.caption(
                    f"Average Sourcy Score: "
                    f"{best_average_score:.1f}/100"
                )

            else:

                st.info(
                    "Not enough data yet."
                )


    # =====================================================
    # SPENDING INSIGHT
    # =====================================================

    st.write("### 💰 Spending Intelligence")

    if highest_spending_supplier:

        with st.container(
            border=True
        ):

            st.write(
                f"**Highest supplier spending:** "
                f"{highest_spending_supplier}"
            )

            st.metric(
                "Supplier Spend",
                f"₦{highest_spending:,.0f}",
            )

            if total_spending > 0:

                spending_percentage = (
                    highest_spending
                    / total_spending
                    * 100
                )

                st.caption(
                    f"This supplier represents "
                    f"{spending_percentage:.1f}% "
                    f"of total procurement spending."
                )

    else:

        st.info(
            "No spending intelligence available yet."
        )


    # =====================================================
    # SOURCY INTELLIGENCE SUMMARY
    # =====================================================

    st.write("### 💡 Sourcy Intelligence Summary")

    if (
        most_recommended_supplier
        and best_score_supplier
        and most_recommended_supplier
        == best_score_supplier
    ):

        st.success(
            f"{most_recommended_supplier} is currently "
            f"Sourcy's strongest supplier. It is both the "
            f"most frequently recommended supplier and the "
            f"highest-performing supplier based on average "
            f"Sourcy Score."
        )


    elif (
        most_recommended_supplier
        and best_score_supplier
    ):

        st.info(
            f"{most_recommended_supplier} is recommended "
            f"most frequently, while {best_score_supplier} "
            f"has the strongest average supplier score. "
            f"Sourcy can use these patterns to support "
            f"future procurement decisions."
        )


    elif most_recommended_supplier:

        st.info(
            f"{most_recommended_supplier} is currently "
            f"the supplier Sourcy recommends most often."
        )


    else:

        st.info(
            "Complete more procurement requests to generate "
            "stronger procurement intelligence."
        )


else:

    st.info(
        "Your procurement intelligence dashboard will appear "
        "after you complete your first procurement request."
    )


# =========================================================
# PROCUREMENT HISTORY
# =========================================================

st.divider()

st.write("## 🕘 Procurement History")

if st.session_state.procurement_history:

    st.caption(
        f"{len(st.session_state.procurement_history)} "
        f"procurement decision(s) this session."
    )

    for index, item in enumerate(
        reversed(
            st.session_state.procurement_history
        ),
        start=1,
    ):

        with st.expander(
            f"#{index} — "
            f"{item['quantity']:,} "
            f"{item['product'].title()} "
            f"→ "
            f"{item['supplier'] or 'No supplier'}"
        ):

            col1, col2, col3 = st.columns(3)

            with col1:

                st.write(
                    f"**Product:** "
                    f"{item['product'].title()}"
                )

                st.write(
                    f"**Quantity:** "
                    f"{item['quantity']:,}"
                )

                st.write(
                    f"**Budget:** "
                    f"₦{item['budget']:,.0f}"
                    if item["budget"] is not None
                    else "**Budget:** No Limit"
                )

            with col2:

                st.write(
                    f"**Location:** "
                    f"{item['location']}"
                )

                st.write(
                    f"**Supplier:** "
                    f"{item['supplier'] or 'None'}"
                )

                st.write(
                    f"**Urgency:** "
                    f"{item['urgency']}"
                )

            with col3:

                st.write(
                    f"**Score:** "
                    f"{item['score']}/100"
                )

                st.write(
                    f"**Total:** "
                    f"₦{item['total_cost']:,.0f}"
                )

                st.write(
                    f"**Risk:** "
                    f"{item['risk']}"
                )


            st.write(
                f"🚚 **Delivery:** "
                f"{item['delivery']}"
            )

            st.write(
                f"📌 **Status:** "
                f"{item['status']}"
            )


            if item["reasons"]:

                st.write(
                    "**Why Sourcy recommended this supplier:**"
                )

                for reason in item["reasons"]:

                    st.write(
                        f"✅ {reason}"
                    )


            if item["risk_reasons"]:

                st.write(
                    "**Risk factors:**"
                )

                for risk_reason in item["risk_reasons"]:

                    st.write(
                        f"⚠️ {risk_reason}"
                    )


else:

    st.info(
        "No procurement decisions yet. "
        "Run a procurement request to create history."
    )


# =========================================================
# CLEAR HISTORY
# =========================================================

if st.session_state.procurement_history:

    st.divider()

    if st.button(
        "🗑️ Clear Procurement History",
        use_container_width=True,
    ):

        st.session_state.procurement_history = []

        st.rerun()