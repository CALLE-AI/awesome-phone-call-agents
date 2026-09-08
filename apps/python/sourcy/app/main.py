from app.agent import (
    create_procurement_request,
    run_sourcing_workflow,
)


request = create_procurement_request(
    product="cement",
    quantity=500,
    location="Abuja",
)


supplier_quotes = [
    {
        "supplier_name": "ABC Building Materials",
        "quantity_available": 1000,
        "unit_price": 9200,
        "delivery_cost": 30000,
    },
    {
        "supplier_name": "BuildPro Supplies",
        "quantity_available": 1000,
        "unit_price": 8900,
        "delivery_cost": 20000,
    },
    {
        "supplier_name": "MegaBuild",
        "quantity_available": 1000,
        "unit_price": 9400,
        "delivery_cost": 15000,
    },
]


result = run_sourcing_workflow(
    request=request,
    supplier_quotes=supplier_quotes,
)


print("SOURCY SOURCING RESULT")
print("======================")

print("\nREQUEST:")
print(result["request"])

print("\nSUPPLIERS CONTACTED:")
print(result["suppliers_contacted"])

print("\nRANKED SUPPLIERS:")

for quote in result["ranked_quotes"]:
    print(
        quote["supplier_name"],
        "→ ₦",
        quote["total_cost"],
    )

print("\nRECOMMENDATION:")
print(result["recommendation"]["supplier"])

print("\nWHY:")
for reason in result["recommendation"]["reasons"]:
    print("-", reason)