import argparse
import json

from calle_client import call_customer
from call_store import save_call_result
from retention_engine import load_config


def load_customers():
    with open(
        "customers.json",
        "r",
        encoding="utf-8",
    ) as file:
        data = json.load(file)

    if not isinstance(data, list):
        raise ValueError(
            "customers.json must contain a JSON list."
        )

    return data


def get_customer(
    customer_id,
    customers,
):
    for customer in customers:

        if customer.get(
            "customer_id"
        ) == customer_id:

            return customer

    return None


def main():

    parser = argparse.ArgumentParser(
        description=(
            "Run one Customer Churn Rescue "
            "CALL-E call for an at-risk customer."
        )
    )

    parser.add_argument(
        "--customer-id",
        required=True,
        help="Customer ID from customers.json.",
    )

    args = parser.parse_args()

    customers = load_customers()

    customer = get_customer(
        args.customer_id,
        customers,
    )

    if customer is None:

        raise SystemExit(
            f"Customer '{args.customer_id}' "
            "was not found in customers.json."
        )

    config = load_config()

    company_name = config[
        "company"
    ][
        "name"
    ]

    print()
    print("=" * 70)
    print("CUSTOMER CHURN RESCUE")
    print("=" * 70)

    print(
        f"Company  : {company_name}"
    )

    print(
        f"Customer : {customer['name']}"
    )

    print(
        f"ID       : {customer['customer_id']}"
    )

    print(
        f"Plan     : {customer['plan']}"
    )

    print(
        f"Tenure   : {customer['tenure_months']} months"
    )

    print(
        f"Phone    : {customer['phone']}"
    )

    print("=" * 70)
    print()

    print(
        "WARNING: This will attempt a REAL CALL-E phone call."
    )

    print(
        "Only continue if this customer and phone number "
        "are authorized for your test."
    )

    print()

    confirmation = input(
        "Type YES to place the call: "
    ).strip().upper()

    if confirmation != "YES":

        print(
            "Call cancelled."
        )

        return

    print()
    print(
        "Starting CALL-E..."
    )
    print()

    try:

        result = call_customer(
            customer,
            config,
        )

    except Exception as exc:

        print()
        print("=" * 70)
        print("CALL-E ERROR")
        print("=" * 70)
        print(str(exc))
        print()

        return

    save_call_result(
        result,
        source="live",
    )

    print()
    print("=" * 70)
    print("CALL-E RESULT")
    print("=" * 70)

    print(
        json.dumps(
            result,
            indent=2,
            ensure_ascii=False,
        )
    )

    print()
    print("=" * 70)
    print("RESULT SAVED")
    print("=" * 70)

    print(
        "data/calls.json"
    )


if __name__ == "__main__":
    main()