# Worked examples

Every phone number below is in the `+1-555-01xx` range reserved for fiction.

## 1. A full run

**Request**

> "A pallet of insulated shipping boxes arrived crushed on order BK-7741. Get a replacement
> before Friday, under $500."

**Parsed, and shown back to the user before anything is dialled**

```json
{
  "goal": "Get a replacement pallet of 500 insulated shipping boxes for the crushed delivery on order BK-7741.",
  "constraints": [
    {"kind": "budget",   "description": "Total cost at or under USD 500", "value": 500, "hard": true},
    {"kind": "deadline", "description": "Delivered on or before Friday 11 September", "value": "2026-09-11", "hard": true},
    {"kind": "required_fact", "description": "A reference number", "value": "reference", "hard": false}
  ],
  "organizations": [
    {"name": "Halden Packaging", "phone": "+15550100001", "role": "Original supplier on order BK-7741"}
  ],
  "budget": {"max_calls": 6, "max_calls_per_org": 2}
}
```

One phone number. The user does not know who else to call, which is why they asked.

**The run**

| # | Party | Verdict | What it produced |
|---|---|---|---|
| 1 | Halden Packaging `+*******0001` | `no_answer` | Voicemail, no hold option |
| 2 | Halden Packaging `+*******0001` | `blocked` | Out of stock until the 30th. **Referral: Northgate Distribution `+15550100002`** |
| 3 | Northgate Distribution `+*******0002` | `offer` | $612 next-day courier — **rejected, $112 over the limit**. **Referral: Brightwater Depot `+15550100003`** |
| 4 | Brightwater Depot `+*******0003` | `offer` | $438, local van, 2026-09-10 — **satisfies both hard constraints** |
| — | *user* | — | *Accept $438 from Brightwater Depot?* → **Approve** |
| 5 | Brightwater Depot `+*******0003` | `confirmed` | Booked. Reference `BWD-48291` |

Two of the three organisations were never supplied by the user. Both came out of a call.

**Evidence from call 2**, which is where the run actually turns:

```json
{
  "reached": "yes",
  "verdict": "blocked",
  "facts": [
    "Order BK-7741 is confirmed damaged in their system.",
    "The insulated box line is out of stock until the end of the month.",
    "They will credit the original order but cannot supply a replacement."
  ],
  "blockers": ["No stock of insulated shipping boxes until 30 September."],
  "referrals": [{
    "org_name": "Northgate Distribution",
    "phone": "+15550100002",
    "role": "Regional distributor carrying the same line",
    "reason": "Halden say Northgate hold stock of the identical box."
  }],
  "offer": {
    "what_is_offered": "",
    "price": "",
    "currency": "",
    "eta": "",
    "reference": ""
  }
}
```

**Report**

```text
RESOLVED
500 insulated shipping boxes, local van delivery with Brightwater Depot
for USD 438.00, 2026-09-10.
Reference BWD-48291

  satisfied  USD 438.00 is within the USD 500.00 limit.
  satisfied  2026-09-10 is on or before the 2026-09-11 deadline.
  satisfied  reference=BWD-48291

5 of 6 calls used.

  Halden Packaging       +*******0001  2 calls  blocked
  Northgate Distribution +*******0002  1 call   offer      found by the agent
  Brightwater Depot      +*******0003  2 calls  confirmed  found by the agent

Turned down: 500 insulated shipping boxes, next-day courier, USD 612.00
             (USD 112.00 over the USD 500.00 limit)
```

The turned-down offer is in the report on purpose. An outcome that shows only the winner
reads like luck.

## 2. Stopping on budget

Same request, `max_calls: 2`.

| # | Party | Verdict |
|---|---|---|
| 1 | Halden Packaging | `no_answer` |
| 2 | Halden Packaging | `blocked` — referral to Northgate |

```text
NOT RESOLVED
Call budget reached (2 of 2 calls). Stopping rather than dialling on.

Established:
  Order BK-7741 is confirmed damaged in their system.
  The insulated box line is out of stock until 30 September.

Blockers:
  No stock of insulated shipping boxes until 30 September.

Untried lead: Northgate Distribution +*******0002
  "Halden say Northgate hold stock of the identical box."

2 of 2 calls used. Raise the budget to continue.
```

The agent does **not** widen its own budget to chase the lead it just found. It hands the
user a decision with everything needed to make it.

## 3. Declining at the approval gate

Same run to call 4, then the user declines the $438 offer — say Thursday does not work.

The offer is recorded as declined, and the planner goes back out. In this scenario there is
nothing left to try: Halden is blocked and at its per-party cap, Northgate is over budget,
Brightwater's offer was just refused.

```text
NOT RESOLVED
Every lead has been followed and nothing meets the requirements.
4 of 6 calls used.
```

The important property is what did **not** happen: the planner did not re-propose the $438
offer. Without recording the decline, "no" is an infinite loop.

## Two failure modes this pattern gets wrong

### Treating a completed call as a completed outcome

Call 3 completed. The recipient was helpful. A structured result came back with a real
price and a real date. Every telephony-level signal says success — and the outcome is a
failure, because $612 breaks a limit the user stated.

If the loop routes on call status, it stops here and reports a $612 solution to someone who
said $500. Route on the **constraint verdict**.

### Flagging every call as a commitment

The gathering script ends with "you are NOT authorised to agree to anything, accept any
price, or cancel anything". A keyword backstop that reads `agree`, `accept` and `cancel`
without noticing the negation flags all five calls.

The user then approves five times. By the fifth they have stopped reading, and the approval
that actually mattered — the one that spends $438 — gets the same reflexive click as the
four that asked a depot about its van schedule.

A safety net that fires constantly trains the behaviour it exists to prevent. Exclude
negated lines before matching.
