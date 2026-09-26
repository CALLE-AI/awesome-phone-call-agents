from app.agent import run_sourcing_workflow


request = {
    "product": "cement",
    "quantity": 500,
    "location": "Abuja",
}


supplier_quotes = [
    {
        "supplier_name": "BuildPro Supplies",
        "product_available": True,
        "quantity_available": 1000,
        "unit_price": 9000,
        "delivery_available": True,
        "delivery_cost": 20000,
        "delivery_time": "2 days",
        "bulk_discount": "None",
    },
    {
        "supplier_name": "Abuja Materials Ltd",
        "product_available": True,
        "quantity_available": 800,
        "unit_price": 8500,
        "delivery_available": True,
        "delivery_cost": 30000,
        "delivery_time": "3 days",
        "bulk_discount": "None",
    },
    {
        "supplier_name": "MegaBuild Wholesale",
        "product_available": True,
        "quantity_available": 300,
        "unit_price": 8000,
        "delivery_available": True,
        "delivery_cost": 10000,
        "delivery_time": "1 day",
        "bulk_discount": "5%",
    },
]


result = run_sourcing_workflow(
    request=request,
    supplier_quotes=supplier_quotes,
)


print("\n📊 SUPPLIER RANKING")

for index, quote in enumerate(result["ranked_quotes"], start=1):
    print(
        f"{index}. {quote['supplier_name']} — "
        f"₦{quote['total_cost']:,.0f}"
    )


print("\n🏆 SOURCY RECOMMENDATION")

recommendation = result["recommendation"]

if recommendation:
    print("Supplier:", recommendation["supplier"])
    print(
        "Total cost:",
        f"₦{recommendation['total_cost']:,.0f}"
    )

    print("\nWhy:")
    for reason in recommendation["reasons"]:
        print("-", reason)
else:
    print("No suitable supplier found.")