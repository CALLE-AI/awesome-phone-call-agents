from app.agent import extract_supplier_quote


call_result = {
    "structured_result": {
        "supplier_name": "Test Supplier",
        "product_available": True,
        "quantity_available": 2000,
        "unit_price": 4000,
        "delivery_available": True,
        "delivery_cost": 14000,
        "delivery_time": "three days",
        "bulk_discount": "No",
    }
}


quote = extract_supplier_quote(call_result)

print("\n📦 EXTRACTED SUPPLIER QUOTE")
print(quote)