from app.agent import run_sourcing_workflow


request = {
    "product": "cement",
    "quantity": 500,
    "location": "Abuja",
}


supplier_quote = {
    "supplier_name": "Test Supplier",
    "product_available": True,
    "quantity_available": 2000,
    "unit_price": 4000,
    "delivery_available": True,
    "delivery_cost": 14000,
    "delivery_time": "three days",
    "bulk_discount": "No",
}

result = run_sourcing_workflow(
    request=request,
    supplier_quotes=[supplier_quote],
)


print("\n🏆 SOURCY RECOMMENDATION")

recommendation = result["recommendation"]

if recommendation:
    print("Supplier:", recommendation["supplier"])
    print("Total cost:", recommendation["total_cost"])

    print("\nWhy:")
    for reason in recommendation["reasons"]:
        print("-", reason)
else:
    print("No suitable supplier found.")