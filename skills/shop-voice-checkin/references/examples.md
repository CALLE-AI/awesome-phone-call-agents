# Examples — shop voice check-in

All phone numbers below are **fictional or reserved** samples. Do not commit live numbers or API keys.

## Preview request (no call)

Use `assets/example-request.template.json` with the Python app in preview mode:

```bash
cd apps/python/shop-voice-manager
python client.py --request path/to/local-request.json
```

Expected: masked task text, result schema attached, no network request.

## Morning inventory — sample structured result

```json
{
  "check_in_completed": true,
  "products": [
    {
      "name": "Rice",
      "quantity_estimate": 8,
      "unit": "bags",
      "running_low": false,
      "supplier_mentioned": "Supplier A",
      "last_purchase_price": 45000
    },
    {
      "name": "Indomie",
      "quantity_estimate": 12,
      "unit": "cartons",
      "running_low": true
    }
  ],
  "owner_notes": "Market slow yesterday but rice still moving."
}
```

## Evening sales — sample structured result

```json
{
  "sales_day_completed": true,
  "estimated_revenue": 85000,
  "currency": "NGN",
  "top_sellers": ["Indomie", "Cooking oil", "Milo"],
  "procurement_spend": 120000,
  "procurement_items": [
    {
      "name": "Rice",
      "amount": 90000,
      "supplier": "Supplier A"
    }
  ],
  "owner_notes": "Bought rice in the morning before shop open."
}
```

## MCP workflow (Cursor / agent host)

```text
plan_call(task, phone, schema) -> inspect plan -> run_call (user confirms) -> get_call_run
```

Wait ~60 seconds before first poll, then every 5–10 seconds until terminal status. Persist `run_id`; do not call `run_call` again on retry.

## Bad outcomes

| Outcome | Action |
| --- | --- |
| Owner busy / call back later | Do not retry same day without user approval |
| Voicemail | Mark incomplete; reconcile manually |
| Refused consent on call | Stop; do not retry |
| Low-confidence structured result | Do not write to ledger; flag for human review |

## India pilot (INR)

Use `assets/sample-shop-profile-inr.json` and
`assets/example-request-inr.template.json` with Hinglish task text from
`references/call-scripts-hindi-english.md`:

```bash
cd apps/python/shop-voice-manager
python client.py --request example_request_inr.json
```

Expected: masked preview for `demo-pune-corner-shop` (`region: IN`, `currency: INR`). No network.

## Weekly summary (local app, no call)

After several days of stored check-ins, the app may print:

```text
This week you sold about ₦425,000. You spent about ₦310,000 restocking.
Products running low: Indomie, Sugar.
```

See `apps/python/shop-voice-manager/` for the runnable demo app.
