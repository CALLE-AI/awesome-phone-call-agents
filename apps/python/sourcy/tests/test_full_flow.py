from app.agent import source_products


request = {
    "product": "cement",
    "quantity": 500,
    "location": "Abuja",
}


suppliers = [
    {
        "name": "Test Supplier",
        "phone": "+2349064207761",
    }
]


result = source_products(
    request=request,
    suppliers=suppliers,
)
print("\n🔍 RAW SOURCY RESULT:")
print(result)

print("\n📊 SOURCY RESULTS")


for quote in result["ranked_quotes"]:
    print(
        f"{quote['supplier_name']} — "
        f"₦{quote['total_cost']:,.0f}"
    )


print("\n🏆 RECOMMENDATION")

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