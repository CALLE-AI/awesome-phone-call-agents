# Examples

Every phone number below is from the NANP `555-0100` to `555-0199` range, reserved for
fiction. Every pharmacy, price, and quotation is invented for this file.

## A clean quote

Task text sent to CALL-E, abbreviated:

> You are calling a retail pharmacy on behalf of an independent price comparison. Open by
> saying you are an automated AI assistant calling on behalf of that comparison, and that
> the call is recorded. Your single goal is one number: the cash price, with no insurance
> and no discount card, for 30 metformin hcl 500 mg tablets.

Recipient `+12025550142`. What came back:

```json
{
  "answered_by": "human",
  "quote_status": "quoted",
  "cash_price_usd": "12.99",
  "quantity_quoted": "30",
  "requires_prescription_on_file": "no",
  "is_generic": "generic",
  "discount_program_mentioned": "no",
  "notes": "Twelve ninety-nine for the generic, thirty count."
}
```

Counts toward the comparison.

## A refusal, which is a result

Recipient `+12025550157`.

```json
{
  "answered_by": "human",
  "quote_status": "refused",
  "cash_price_usd": "unknown",
  "quantity_quoted": "unknown",
  "requires_prescription_on_file": "yes",
  "is_generic": "unknown",
  "discount_program_mentioned": "unknown",
  "notes": "Cannot price it until a prescription is on file here."
}
```

Do not drop this row. Reported as "9 of 12 pharmacies gave a price", the refusals are part
of the finding: a cash price is hard to obtain, which is the reason the survey exists.

## A price for a different bottle

Recipient `+12025550163`. You asked for 30 and were quoted 90.

```json
{
  "answered_by": "human",
  "quote_status": "quoted",
  "cash_price_usd": "24.00",
  "quantity_quoted": "90",
  "notes": "Only dispensed in ninety-count bottles."
}
```

Report it, never rescale it. Dividing by three to get a 30-count price assumes pharmacy
pricing is linear in quantity, and it is not: dispensing fees do not scale and larger
bottles are usually cheaper per tablet. Keep it in its own section of the report.

## A completed call that answered nothing

Recipient `+12025550171`. The call task returned `status: "completed"` and
`task_completed: true`, which looks like success at the call level:

```json
{
  "answered_by": "voicemail",
  "quote_status": "unknown",
  "cash_price_usd": "unknown",
  "quantity_quoted": "unknown",
  "notes": "Reached an after-hours voicemail box."
}
```

This is the failure mode worth designing against. Branch on `quote_status`, never on
`status` or `task_completed`.

## Turning four answers into a finding

| Pharmacy | Price for 30 | vs national average cost |
| --- | --- | --- |
| Lakeside Community Drug | $9.40 | 22x |
| Cedar Street Pharmacy | $12.99 | 30x |
| Northgate Drug | $18.50 | 43x |
| Union Square Pharmacy | $147.25 | 342x |

Acquisition cost from CMS NADAC: `METFORMIN HCL 500 MG TABLET` at $0.01419 per tablet,
so $0.43 for thirty. Cite the effective date, because the figure is republished weekly.

Report the spread (15.7x), the count that answered, and the count that refused. Do not
report an average across pharmacies that quoted different quantities, and do not present
the cheapest pharmacy as a recommendation.

## A batch worth running

Twelve pharmacies inside one ZIP, one drug, one quantity, one morning. That is enough for
a spread to mean something and small enough that no counter is called twice. Note that
CALL-E's default outbound concurrency is one call at a time per account, so a batch queues
rather than dialling at once. Budget the wall-clock time accordingly.

Questions to answer before the batch, not after:

- Which exact numbers has a person authorized? (Not: which did discovery return.)
- What is the maximum number of calls this run may place?
- What happens on an ambiguous create? (Halt, not retry.)
- Where do the results go, and are phone numbers masked there?
