# Worked Examples

> **Notice:** All content in this file is illustrative. Names, company names, invoice
> references, phone numbers, and amounts are entirely fictional. Phone numbers are drawn
> from the NANP reserved fictional range `+1555010xxxx` and cannot be dialled. No real
> client, invoice, or call transcript appears here.

---

## Fictional Invoice Dataset

The table below supplies a small set of example invoices for use in dry-run output,
documentation, and development. Every field is fabricated; any resemblance to real
businesses or individuals is coincidental.

| Invoice ref   | Client (fictional)          | Region | Amount      | Due date   | Days overdue | Phone (fictional) |
|---------------|-----------------------------|--------|-------------|------------|:------------:|-------------------|
| INV-2026-041  | Northgate Digital Ltd        | SG     | USD 4,800   | 2026-06-20 | 37           | +15550100001      |
| INV-2026-038  | Summit Creative AU Pty Ltd   | AU     | AUD 2,200   | 2026-07-05 | 22           | +15550100002      |
| INV-2026-053  | Meridian Tech Solutions Ltd  | GB     | GBP 1,750   | 2026-05-30 | 58           | +15550100003      |
| INV-2026-029  | Harborview Consulting Inc    | US     | USD 6,500   | 2026-07-12 | 15           | +15550100004      |
| INV-2026-067  | Eastfield Partners Sdn Bhd   | MY     | USD 3,100   | 2026-04-27 | 91           | +15550100005      |

### JSON form (for skill input)

```json
[
  {
    "invoice_ref": "INV-2026-041",
    "client_name": "Northgate Digital Ltd",
    "amount": 4800.00,
    "currency": "USD",
    "due_date": "2026-06-20",
    "days_overdue": 37,
    "region": "SG",
    "client_phone": "+15550100001"
  },
  {
    "invoice_ref": "INV-2026-038",
    "client_name": "Summit Creative AU Pty Ltd",
    "amount": 2200.00,
    "currency": "AUD",
    "due_date": "2026-07-05",
    "days_overdue": 22,
    "region": "AU",
    "client_phone": "+15550100002"
  },
  {
    "invoice_ref": "INV-2026-053",
    "client_name": "Meridian Tech Solutions Ltd",
    "amount": 1750.00,
    "currency": "GBP",
    "due_date": "2026-05-30",
    "days_overdue": 58,
    "region": "GB",
    "client_phone": "+15550100003"
  },
  {
    "invoice_ref": "INV-2026-029",
    "client_name": "Harborview Consulting Inc",
    "amount": 6500.00,
    "currency": "USD",
    "due_date": "2026-07-12",
    "days_overdue": 15,
    "region": "US",
    "client_phone": "+15550100004"
  },
  {
    "invoice_ref": "INV-2026-067",
    "client_name": "Eastfield Partners Sdn Bhd",
    "amount": 3100.00,
    "currency": "USD",
    "due_date": "2026-04-27",
    "days_overdue": 91,
    "region": "MY",
    "client_phone": "+15550100005"
  }
]
```

---

## Outcome Categories

| Code | Description |
|------|-------------|
| `paid_now` | Client confirms payment was made or will arrive within 24 hours. |
| `committed_to_date` | Client agrees to a specific date to pay the full amount; `commitment_date` populated. |
| `disputed` | Client disputes the invoice or claims prior payment; `dispute_reason` populated. |
| `refused` | Client declines to pay or engage, or cannot commit to a single date for the full amount (e.g. proposes a partial payment or instalment plan). |
| `no_answer` | Call rang to completion; nobody answered. |
| `voicemail` | Call reached voicemail; brief message left. |
| `wrong_person` | A third party answered; named client was not reached. |

---

## Illustrative Call Transcripts

The four transcripts below demonstrate the four primary conversation branches. They
follow the five-phase flow defined in `SKILL.md` and show the agent script and the
client's response at each decision point.

Formatting key:
- **Agent** lines are what the CALL-E agent says.
- **Client** lines represent a plausible client response.
- `[Internal note]` lines are not spoken; they describe what the agent records or logs.
- Each transcript ends with a structured result block showing the extracted `result_schema` fields.

---

### Transcript A — Branch A: Client Pays Now

> **Illustrative example only — not a real call log.**

**Context:** INV-2026-041, USD 4,800, Northgate Digital Ltd, Singapore, 37 days overdue.

---

**Phase 1 — Opening and Identity Confirmation**

**Agent:** Hello, this is Alex calling on behalf of Devixus Studio. May I please speak
with the accounts contact at Northgate Digital?

**Client:** Yes, speaking — this is Rachel from accounts.

**Agent:** Thank you, Rachel. I want to make sure I have the right contact. Can you
confirm the business name on file with us?

**Client:** Yes, it's Northgate Digital Ltd.

`[Identity confirmed. Proceed to Phase 2.]`

---

**Phase 2 — State the Invoice**

**Agent:** I'm reaching out about invoice INV-2026-041, for USD 4,800, which was due on
20 June 2026 — that's 37 days ago. I wanted to connect with you to understand where
things stand.

---

**Phase 3 — Pause for Response**

**Client:** Oh, yes — actually, we processed that transfer a few days ago. I think it
went out on the 25th. Let me double-check... yes, 25 July, international wire.

---

**Phase 4 — Branch A: Client Will Pay Now**

**Agent:** That's great to hear, thank you. We'll keep an eye out for it on our end.

**Client:** Sounds good, thanks.

**Agent:** Wonderful. We'll look out for it. If anything doesn't match up on our end,
the right person will follow up. Thank you for your time.

`[Client volunteered a sent-date and method in Phase 3, but neither is captured — the
result_schema has no field for expected arrival date or payment method on this
outcome.]`

---

**Phase 5 — Closing**

**Agent:** Just to recap — Northgate Digital has confirmed payment for invoice
INV-2026-041 has been sent. If you have any questions, the team can be reached at
accounts@devixus.example. Thank you very much for your time, Rachel. Have a good day.

**Client:** Thanks, bye.

`[Call ends. Total duration: approximately 2 minutes 10 seconds.]`

---

**Extracted result_schema:**

```json
{
  "outcome": "paid_now",
  "commitment_date": null,
  "dispute_reason": null,
  "confidence": 0.97
}
```

---

### Transcript B — Branch B: Client Commits to a Payment Date

> **Illustrative example only — not a real call log.**

**Context:** INV-2026-038, AUD 2,200, Summit Creative AU Pty Ltd, Australia, 22 days overdue.

---

**Phase 1 — Opening and Identity Confirmation**

**Agent:** Hello, this is Alex calling on behalf of Devixus Studio. May I please speak
with the accounts team at Summit Creative AU?

**Client:** Yes, hi, this is Tom. I handle invoices here.

**Agent:** Hi Tom, thanks for picking up. Just to confirm — is this Summit Creative AU
Pty Ltd?

**Client:** Yes, that's us.

`[Identity confirmed. Proceed to Phase 2.]`

---

**Phase 2 — State the Invoice**

**Agent:** I'm reaching out about invoice INV-2026-038, for AUD 2,200, which was due on
5 July 2026 — that's 22 days ago. I wanted to connect to understand where things stand
on our end.

---

**Phase 3 — Pause for Response**

**Client:** Right, yes. Sorry about that. We've had a bit of a slow month and it slipped
through. I definitely want to sort it out.

---

**Phase 4 — Branch B: Client Wants a Payment Date**

**Agent:** Understood. What date works best for you to make the payment?

**Client:** Could we do end of the month? Around the 31st?

**Agent:** That's helpful. Could we pin down a specific date? Even a rough target helps
us plan on our end.

**Client:** Yes, let's say 31 July.

**Agent:** So just to make sure I have this right — you're planning to pay AUD 2,200 on
31 July 2026. Does that sound correct?

**Client:** Yes, that works.

`[Commitment captured: AUD 2,200 by 31 July 2026. Mark as pending operator review.]`

---

**Phase 5 — Closing**

**Agent:** Thank you, Tom. We'll note that and follow up if we don't see the payment by
then. Is there anything else I can help clarify?

**Client:** No, that's all, thanks.

**Agent:** Just to recap — Summit Creative has committed to paying invoice INV-2026-038
for AUD 2,200 by 31 July 2026. If you have any questions, the team can be reached at
accounts@devixus.example. Thank you very much for your time. Have a good day.

`[Call ends. Total duration: approximately 2 minutes 45 seconds.]`

---

**Extracted result_schema:**

```json
{
  "outcome": "committed_to_date",
  "commitment_date": "2026-07-31",
  "dispute_reason": null,
  "confidence": 0.94
}
```

---

### Transcript C — Branch C: Client Disputes the Amount

> **Illustrative example only — not a real call log.**

**Context:** INV-2026-053, GBP 1,750, Meridian Tech Solutions Ltd, United Kingdom, 58 days overdue.

---

**Phase 1 — Opening and Identity Confirmation**

**Agent:** Hello, this is Alex calling on behalf of Devixus Studio. May I please speak
with the accounts contact at Meridian Tech Solutions?

**Client:** Yes, this is Sandra from finance.

**Agent:** Hi Sandra, thank you. Can you confirm the company name I have on file —
Meridian Tech Solutions Ltd?

**Client:** Yes, that's correct.

`[Identity confirmed. Proceed to Phase 2.]`

---

**Phase 2 — State the Invoice**

**Agent:** I'm reaching out about invoice INV-2026-053, for GBP 1,750, which was due on
30 May 2026 — that's 58 days ago. I wanted to connect to understand where things stand.

---

**Phase 3 — Pause for Response**

**Client:** Hold on — GBP 1,750? That doesn't sound right. We agreed a revised scope
with your team back in May, and I was told the invoice would be adjusted accordingly.
I'm surprised we're getting chased on this amount.

---

**Phase 4 — Branch C: Client Disputes the Amount**

**Agent:** I understand — it's important to get this right. Could you tell me briefly
what you believe the correct position is?

**Client:** We approved a scope reduction after the initial brief changed. I have emails
from someone on your team saying the invoice would come in under a thousand pounds.
I was waiting for a revised invoice, not chasing.

**Agent:** Thank you for explaining that. I don't want to cut across anything that's
already been discussed with the team. I'll make sure the right person at Devixus Studio
reviews the correspondence and comes back to you directly with the corrected position.

**Client:** Thank you, I appreciate that.

`[Capture objection verbatim: client claims a scope reduction was agreed in May and a revised invoice at below GBP 1,000 was promised, and is waiting for a revised invoice. Preferred follow-up channel is not asked or logged — the result_schema has no field for it.]`

---

**Phase 5 — Closing**

**Agent:** Just to recap — Meridian Tech Solutions has raised a query about the invoice
amount, citing a scope reduction agreed in May. The team will review the correspondence
and come back to you directly. We won't be chasing further by phone until that's
resolved. If you have any questions in the meantime, please reach us at
accounts@devixus.example. Thank you for your time, Sandra. Have a good day.

**Client:** Thank you, I appreciate it.

`[Call ends. Total duration: approximately 3 minutes 20 seconds.]`

---

**Extracted result_schema:**

```json
{
  "outcome": "disputed",
  "commitment_date": null,
  "dispute_reason": "Client states scope was reduced in May and a revised invoice below GBP 1,000 was promised. Client is waiting for revised invoice, not aware of current amount.",
  "confidence": 0.96
}
```

---

### Transcript D — Branch D: Client Cannot Pay

> **Illustrative example only — not a real call log.**

**Context:** INV-2026-067, USD 3,100, Eastfield Partners Sdn Bhd, Malaysia, 91 days overdue.

---

**Phase 1 — Opening and Identity Confirmation**

**Agent:** Hello, this is Alex calling on behalf of Devixus Studio. May I please speak
with the accounts contact at Eastfield Partners?

**Client:** Yes, speaking. This is David, I'm one of the directors.

**Agent:** Hi David, thank you. Can you confirm your company name — Eastfield Partners
Sdn Bhd?

**Client:** Yes, that's right.

`[Identity confirmed. Proceed to Phase 2.]`

---

**Phase 2 — State the Invoice**

**Agent:** I'm reaching out about invoice INV-2026-067, for USD 3,100, which was due on
27 April 2026 — that's 91 days ago. I wanted to connect with you to understand where
things stand.

---

**Phase 3 — Pause for Response**

**Client:** Yes, I know. I'm really sorry about this. We've been going through a very
difficult period — we lost a couple of clients at the start of the year and it's hit our
cash flow hard. I haven't forgotten about it.

---

**Phase 4 — Branch D: Client Cannot Pay**

**Agent:** I appreciate you being upfront about that. Is there a date when you expect to
be able to pay the full amount?

**Client:** Honestly, I'm hoping things will improve by September. I could possibly
manage half of it then — around USD 1,500 — and the rest by end of October. But I can't
promise anything right now.

**Agent:** I understand. I'm not able to set up a payment plan on this call, but I'll
make sure the team at Devixus Studio knows you'd like to discuss a partial arrangement,
and they'll follow up with you directly about the details.

**Client:** That's fair, thank you.

`[Client cannot commit to a single date for the full amount and proposes a partial arrangement instead. The result_schema has no field for partial amounts or multiple dates, so none is captured — outcome is refused, with commitment_date left null. The operator follows up manually to discuss a payment plan.]`

---

**Phase 5 — Closing**

**Agent:** I understand, and I appreciate your honesty, David. We'll pass this back to
the team and they'll be in touch to discuss options, including whether a payment plan is
possible. There's no further pressure from me today. If you have any questions, the team
can be reached at accounts@devixus.example. Thank you for your time. Have a good day.

**Client:** Thank you for being understanding. Sorry again about the delay.

`[Call ends. Total duration: approximately 3 minutes 50 seconds.]`

---

**Extracted result_schema:**

```json
{
  "outcome": "refused",
  "commitment_date": null,
  "dispute_reason": null,
  "confidence": 0.85
}
```

> **Note on Branch D outcome coding:** A client who cannot commit to a single date to pay
> the full invoice amount — including one who proposes a partial payment or an
> instalment schedule — is coded as `refused`, not `committed_to_date`, even though the
> client is engaging rather than declining. `refused` is overloaded in this version to
> mean "no single-date, full-amount commitment obtained" (see SKILL.md, "Out of Scope
> for This Version"). The `result_schema` has no field for partial amounts or multiple
> dates, so the call does not attempt to capture them; the operator follows up manually
> if a payment plan is worth pursuing.

---

## Phone Number Notes

- All numbers in this file use the NANP reserved fictional range `+1555010xxxx`.
  These numbers cannot be dialled and will never reach a real subscriber.
- Numbers are formatted in E.164: `+` followed by country code followed by subscriber
  number, no spaces, no dashes. The required regex is `^\+[1-9]\d{6,14}$`.
- When building a real dataset, replace every `+1555010xxxx` number with the actual
  E.164 number of the intended recipient. Do not strip the `+` or omit the country code.
