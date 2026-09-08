import os

from app.agent import (
    call_supplier,
    extract_supplier_quote,
    run_sourcing_workflow,
)
request = {
    "product": "cement",
    "quantity": 500,
    "location": "Abuja",
}

result = call_supplier(
    request=request,
    supplier_name="Test Supplier",
    phone_number="+2349064207761",
)

quote = extract_supplier_quote(result)
workflow = run_sourcing_workflow(
    request=request,
    supplier_quotes=[quote],
)

print("\nSOURCY RECOMMENDATION:")

recommendation = workflow["recommendation"]

if recommendation:
    print("Supplier:", recommendation["supplier"])
    print("Total cost:", recommendation["total_cost"])

    print("\nWhy:")
    for reason in recommendation["reasons"]:
        print("-", reason)
else:
    print("No suitable supplier found.")