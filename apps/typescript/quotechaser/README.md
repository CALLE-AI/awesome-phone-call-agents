# QuoteChaser

QuoteChaser turns the most annoying part of procurement into a small, auditable
phone-call workflow. Give it a buying brief and a short vendor list. It previews
exactly what CALL-E will ask, refuses secrets or payment details, calls each vendor
only after a matching receipt is supplied, and returns one comparable quote row per
vendor.

The narrow use case is intentional: small businesses often need prices from
suppliers who still answer faster by phone than by web form. A bakery, contractor,
restaurant, school club or event planner can spend an afternoon chasing unit prices,
stock status and pickup windows. QuoteChaser makes those calls consistent and leaves
behind structured results an agent can sort, compare and act on.

## What it collects

| Field | Purpose |
| --- | --- |
| outcome | `quote_received`, `not_available`, `callback_needed`, `unreachable` or `outcome_unknown` |
| unit_price and total_price | Numeric values when the vendor gives them |
| currency | Currency code or label from the quote |
| availability | What the vendor said about stock |
| lead_time | Pickup, delivery or order timing |
| minimum_order | Any stated minimum |
| callback_required | Whether a human follow-up is needed |
| evidence | Short support from CALL-E's result |

## Try it without an account

```bash
cd apps/typescript/quotechaser
npm install
npm run check
npm test
npm run demo
```

The demo uses fake CALL-E results. It places no calls, needs no credentials and
prints a quote comparison for the example bakery request.

## Preview

```bash
npm run quotechaser -- preview --request examples/request.example.json
```

Preview prints the buyer, item, vendor list, allowed disclosure and a receipt. No
network request is made. The receipt is a SHA-256 hash of the request file as loaded,
so changing the quantity, vendors or voicemail policy invalidates the approval.

## One live run

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
npm run quotechaser -- preview --request your-request.json
npm run quotechaser -- call --request your-request.json --live --receipt <hash> --report quote-report.json
```

`call` refuses to run without `--live`, a matching receipt and `CALLE_API_KEY`.
The API key is read from the environment only. Reports are written as JSON with file
mode `0600`.

## Request file

| Field | Notes |
| --- | --- |
| request_id | Stable identifier for the buying task |
| buyer.business_name and buyer.contact_name | Spoken only as part of the authorized business request |
| item.name, item.quantity, item.must_haves | The quote brief |
| vendors[] | Up to 8 vendors, with E.164 phone numbers and a source for each number |
| max_disclosure[] | What the automated caller is allowed to say |
| policy.locale | Locale passed through the task text |
| policy.allow_voicemail | If false, the caller does not leave a detailed voicemail |

## Side effects, safety and cancellation

- A live run can place one outbound CALL-E call per vendor.
- There is no recurring job. Stop the process to stop launching further vendor
  calls; calls already handed to CALL-E may continue on the provider side.
- Samples use fictional numbers. Use only numbers a business has published for
  sales or supplier inquiries.
- QuoteChaser refuses request files that appear to contain passwords, PINs, payment
  card numbers, bank details, Social Security numbers or similar regulated
  identifiers.
- It does not buy anything, accept a quote or promise payment. It collects
  information and marks follow-up when a human decision is needed.

This is a demo app for a reusable CALL-E workflow pattern, not a supported SDK or a
procurement system.
