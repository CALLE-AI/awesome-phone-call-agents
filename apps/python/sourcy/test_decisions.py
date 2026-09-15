from app.agent import compare_supplier_quotes


# =========================================================
# TEST 1 — CHEAPEST VALID SUPPLIER
# =========================================================

quotes = [
    {
        "supplier_name": "Expensive Supplier",
        "product_available": True,
        "quantity_available": 1000,
        "unit_price": 10000,
        "delivery_available": True,
        "delivery_cost": 50000,
    },
    {
        "supplier_name": "Cheap Supplier",
        "product_available": True,
        "quantity_available": 1000,
        "unit_price": 9000,
        "delivery_available": True,
        "delivery_cost": 20000,
    },
]

result = compare_supplier_quotes(
    quotes,
    500,
)

assert result[0]["supplier_name"] == "Cheap Supplier"

print("✅ TEST 1 PASSED — Cheapest valid supplier selected")


# =========================================================
# TEST 2 — NOT ENOUGH STOCK
# =========================================================

quotes = [
    {
        "supplier_name": "Low Stock Supplier",
        "product_available": True,
        "quantity_available": 100,
        "unit_price": 5000,
        "delivery_available": True,
        "delivery_cost": 10000,
    },
]

result = compare_supplier_quotes(
    quotes,
    500,
)

assert result == []

print("✅ TEST 2 PASSED — Supplier with insufficient stock rejected")


# =========================================================
# TEST 3 — NO DELIVERY
# =========================================================

quotes = [
    {
        "supplier_name": "No Delivery Supplier",
        "product_available": True,
        "quantity_available": 1000,
        "unit_price": 5000,
        "delivery_available": False,
        "delivery_cost": 0,
    },
]

result = compare_supplier_quotes(
    quotes,
    500,
)

assert result == []

print("✅ TEST 3 PASSED — Supplier without delivery rejected")


# =========================================================
# ALL TESTS
# =========================================================

print()
print("🎉 ALL SOURCY DECISION TESTS PASSED!")