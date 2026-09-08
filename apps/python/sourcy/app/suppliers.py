"""
Sourcy Supplier Data

Demo supplier directory used for testing
and development.
"""


SUPPLIERS = [
    {
        "name": "ABC Building Materials",
        "phone": "+2349064207761",
        "demo_quote": {
            "product_available": True,
            "quantity_available": 1000,
            "unit_price": 9200,
            "delivery_available": True,
            "delivery_cost": 30000,
            "delivery_time": "2–3 days",
            "bulk_discount": "Yes",
        },
    },
    {
        "name": "BuildPro Supplies",
        "phone": "+2349064207761",
        "demo_quote": {
            "product_available": True,
            "quantity_available": 1000,
            "unit_price": 8900,
            "delivery_available": True,
            "delivery_cost": 20000,
            "delivery_time": "3 days",
            "bulk_discount": "Yes",
        },
    },
    {
        "name": "MegaBuild",
        "phone": "+2349064207761",
        "demo_quote": {
            "product_available": True,
            "quantity_available": 300,
            "unit_price": 8500,
            "delivery_available": True,
            "delivery_cost": 15000,
            "delivery_time": "2 days",
            "bulk_discount": "No",
        },
    },
]


def get_suppliers():
    """
    Return the available suppliers.
    """
    return SUPPLIERS