---
name: calle-invoice-recovery
description: Places a polite outbound invoice-recovery call via CALL-E, conducts a structured multi-turn conversation about a specific unpaid invoice, offers a payment arrangement when the client is receptive, and logs the structured outcome — designed for freelancers and small agencies chasing overdue payments from overseas clients in CALL-E-supported regions.
license: MIT
---

# CALL-E Invoice Recovery Skill

A reusable phone-call skill that contacts a named client about an unpaid invoice via CALL-E, holds a multi-turn conversation to understand the client's situation, offers a payment arrangement when appropriate, and records the outcome (paid, committed-to-date, escalated, or unresponsive) for human review. Every action is draft-then-approve: the operator reviews the call script and any proposed arrangement before the call is placed or any commitment is logged.

## When To Use

Use this skill when a freelancer or small agency needs to follow up on an overdue invoice with an overseas client via a phone call placed through CALL-E. The client must be reachable in a CALL-E-supported region (US, SG, MY, IN, AE, AU, CA, GB, VN, DE, JP, FR, MX, BR, ID, PH, KE, BD) and the conversation must be conducted in a CALL-E-supported language for that region (default: English; Bengali is not supported, so calls to Bangladesh are placed in English).

## When Not To Use

- The client requires a language CALL-E does not support (e.g. Bengali), or is in a region CALL-E does not support.
- The operator has not explicitly authorized the call.
- No invoice reference number and amount are available to anchor the conversation.
- The debt is disputed or involves active legal proceedings — refer to a collections attorney.

## Conversation Flow

The flow has five sequential phases. Every phase must complete before the call closes; every branch must terminate in one of the four defined outcomes (`paid`, `committed_to_date`, `escalated`, `unresponsive`). The agent never closes the call in an undefined state.

### Outcomes

| Code | Meaning | Next action |
|------|---------|-------------|
| `paid_now` | Client confirms payment was made or will arrive within 24 hours. | Log and close. Operator verifies receipt; if not received within 24 h, escalate manually. |
| `committed_to_date` | Client agrees to a specific date or instalment schedule; `commitment_date` is populated. | Log `commitment_date`. Operator schedules a follow-up for that date + 1 business day. |
| `disputed` | Client disputes the amount, claims prior payment, or raises an unresolvable objection; `dispute_reason` is populated. | Log `dispute_reason` verbatim. Contact client by email within 1 business day. No further call until resolved. |
| `refused` | Client declines to pay or engage; no date offered and no dispute articulated. | No further automated calls. Operator decides: write-off, settlement offer, or collections referral. |
| `no_answer` | Phone rang to completion; nobody answered. | Retry after 24 h cooldown. Retire after 3 consecutive `no_answer` results. |
| `voicemail` | Call reached voicemail; agent left a brief professional message. | No retry for 48 h. Operator may send a written follow-up instead. |
| `wrong_person` | A third party answered; the named client was not reached. | Retry during business hours after 24 h. Verify contact number before retrying. |

---

## result_schema

CALL-E extracts a structured outcome from every call using this schema. The declared fields are exact — CALL-E rejects any field not listed here, so the shape must not be extended without updating this section.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `outcome` | string | yes | One of the seven outcome codes (see table below). |
| `commitment_date` | string \| null | yes | ISO 8601 date (`YYYY-MM-DD`) on which the client committed to pay. Populated only when `outcome` is `committed_to_date`; null for all other outcomes. |
| `dispute_reason` | string \| null | yes | Brief verbatim summary of the client's objection. Populated only when `outcome` is `disputed`; null for all other outcomes. |
| `confidence` | number | yes | Agent confidence in the outcome classification, 0.0 (uncertain) to 1.0 (certain). |

### Outcome enum

| Value | DB value | Meaning |
|-------|----------|---------|
| `paid_now` | `paid` | Client confirms payment was made or will arrive within 24 hours. |
| `committed_to_date` | `committed` | Client agreed to pay on a specific date; `commitment_date` must be populated. |
| `disputed` | `disputed` | Client disputes the amount, claims prior payment, or raises an unresolvable objection; `dispute_reason` must be populated. |
| `refused` | `refused` | Client declines to pay or engage; no date offered and no dispute articulated. |
| `no_answer` | `no_answer` | Phone rang to completion; nobody answered. |
| `voicemail` | `callback` | Call reached voicemail; agent left a brief message. |
| `wrong_person` | `callback` | A third party answered; the named client was not reached. |

The "DB value" column shows how the outcome is stored in the `calls` table after the `mapCalleOutcome` translation layer runs. The `commitment_date` and `dispute_reason` fields are stored in the `arrangements` record linked to the call.

---

### Phase 1 — Opening and Identity Confirmation

**Goal:** Establish who the agent is, who it represents, and confirm the identity of the person on the line before stating any financial information.

**Agent opens:**
> "Hello, this is [Agent Name] calling on behalf of [Operator / Business Name]. May I please speak with [Client Name]?"

If the person confirms they are the client, proceed to Phase 2.

**Third party answers** (receptionist, colleague, family member):
> "Thank you. Could you let [Client Name] know I called? My name is [Agent Name] from [Operator / Business Name]. They can reach us at [Callback Number] at their convenience — no emergency, just a routine matter."
> → Outcome: `wrong_person`. Log the name of the person who answered if given.

**No answer:**
> [Call rings to completion without being answered. Do not leave a message.]
> → Outcome: `no_answer`.

**Voicemail:**
> "Hello, this is [Agent Name] calling for [Client Name] on behalf of [Operator / Business Name]. Please call us back at [Callback Number] at your convenience. Thank you."
> → Outcome: `voicemail`.

**Identity in doubt:** If there is any uncertainty about whether the correct person has been reached, ask one verification question (e.g. confirm the business name or email address on file) before proceeding. Do not state the invoice reference or amount to an unconfirmed third party.

---

### Phase 2 — State the Invoice

**Goal:** Name the specific invoice, state the amount owed, and note how long it has been outstanding. State the facts once, clearly, then stop.

**Script:**
> "I'm reaching out about invoice [Invoice Reference], for [Currency][Amount], which was due on [Due Date] — that's [N] days ago. I wanted to connect with you to understand where things stand."

Operator-supplied variables: `invoice_ref`, `amount`, `currency`, `due_date`, `days_overdue`.

Do not lead with a demand. State the facts and pause.

---

### Phase 3 — Pause for Response

After stating the invoice, stop and wait for the client to respond. This is the pivot point for all four branches. Do not fill the silence or repeat the amount; give the client time to speak.

If the client is silent for several seconds:
> "I'm happy to wait if you need a moment to check your records."

The client's first substantive response determines which branch applies.

---

### Phase 4 — Branch Handling

#### Branch A — Client Will Pay Now

**Signals:** Client says payment has already been sent, or commits to paying the same day or within 24 hours.

**Response:**
> "That's great to hear, thank you. Could you let me know the approximate date you sent — or plan to send — the payment, so we can watch for it on our end?"

Capture: expected arrival date and general method (bank transfer, cheque, etc. — not payment credentials).

Do not ask for card numbers, account numbers, sort codes, CVVs, or any payment credential over the phone (see Prohibited Behaviours).

**Close:**
> "Wonderful. We'll look out for it. If anything doesn't match up on our end, the right person will follow up. Thank you for your time."
> → Outcome: `paid_now`. Log the expected arrival date.

---

#### Branch B — Client Wants a Payment Date

**Signals:** Client acknowledges the invoice is outstanding and indicates intent to pay but needs more time.

**Initial response:**
> "Understood. What date works best for you to make the payment?"

If the client gives a vague timeframe ("next week," "end of the month"):
> "That's helpful. Could we pin down a specific date? Even a rough target helps us plan on our end."

**Confirm the date:**
> "So just to make sure I have this right — you're planning to pay [Currency][Amount] on [Date]. Does that sound correct?"

**If the client wants to split the payment:**
> "Would it work to pay [Amount A] by [Date A] and the remainder by [Date B]? I can pass that proposal to [Operator Name] for their consideration."

Note: the agent offers the arrangement but does not confirm it. All instalment proposals are reviewed by the operator before being logged as agreed (draft-then-approve).

**Close:**
> "Thank you. We'll note that and be in touch if we don't see the payment by then. Is there anything else I can help clarify?"
> → Outcome: `committed_to_date`. Log the agreed date(s) and any instalment structure, marked pending operator review.

---

#### Branch C — Client Disputes the Amount

**Signals:** Client says the amount is wrong, claims they have already paid, references a credit note or change order, or expresses surprise at the figure.

**Initial response:**
> "I understand — it's important to get this right. Could you tell me briefly what you believe the correct position is?"

Listen and capture the client's stated objection fully without interrupting or arguing.

Do not attempt to resolve the dispute on the call. The agent's role is to capture the objection, not adjudicate it.

**Close:**
> "Thank you for explaining that. I'll make sure [Operator Name] reviews their records and comes back to you directly. Would email or a phone call be the easiest way for them to reach you?"

Capture: preferred follow-up method and best time if offered.
> → Outcome: `disputed`. Log the stated objection verbatim in `dispute_reason` and the preferred follow-up channel.

---

#### Branch D — Client Cannot Pay

**Signals:** Client acknowledges the debt but says they are currently unable to pay (cash-flow difficulty, business problem, waiting on their own receivable).

**Initial response:**
> "I appreciate you being upfront about that. Is there a timeframe when you expect the situation to change, or a partial amount that might be possible sooner?"

**If the client offers a partial amount or a future date:**
> "Thank you. I'll pass that to [Operator Name] so they can consider whether a payment plan works for both sides. Just to confirm what I'll be passing on: [partial amount] by [date]. Does that sound right?"
> → Outcome: `committed_to_date`. Log the offered terms and flag them pending operator approval.

**If the client gives no usable timeframe and cannot commit to anything:**
> "I understand. I'll let [Operator Name] know that you're aware of the invoice and working through some difficulty at the moment. They'll be in touch when they've had a chance to consider the options."
> → Outcome: `refused`. Log that the client acknowledged the debt but could not commit to a date or amount.

**If the client becomes distressed or hostile:**
> "I completely understand — this is not a pleasant call to receive. There's no pressure from me today. I'll pass your situation back to [Operator Name] and they'll be in touch with options."
> → Outcome: `refused`. Do not re-raise the debt. Close immediately after this line.

---

### Phase 5 — Closing

Every branch ends here. Before ending the call, the agent must:

1. Confirm the outcome and any agreed item (date, escalation note, or no commitment) in one sentence.
2. Provide a callback number or email the client can use to reach the operator.
3. Thank the client for their time.
4. End the call — do not re-raise the debt after the closing confirmation.

**Closing template:**
> "Just to recap — [one-sentence summary of outcome]. If you have any questions, [Operator Name] can be reached at [Callback Contact]. Thank you very much for your time, [Client Name]. Have a good day."

---

## Prohibited Behaviours

The agent must never do any of the following, regardless of how the conversation unfolds:

| Prohibited | Reason |
|-----------|--------|
| Threaten legal action, collections, or credit reporting | Unlawful in most jurisdictions without specific licensing; creates liability for the operator. |
| Claim or imply legal consequences ("we will sue," "this will affect your credit") | Same as above. |
| Negotiate a discount or write-off on the outstanding amount | Only the operator can offer a discount; agreeing on the call creates an unauthorized commitment. |
| Accept card numbers, bank account numbers, sort codes, CVVs, or any payment credential | Payment credentials over the phone are a security and compliance risk. The agent is not a payment processor. |
| Contact the client more than once per authorized run | Duplicate calls within a cooldown window are blocked at the scheduler level. |
| Impersonate a legal authority, bailiff, or official body | Fraudulent misrepresentation. |
| Disclose invoice details to a third party before identity is confirmed | Privacy and data-protection requirement. |
| Agree to any waiver, settlement, or binding arrangement without operator approval | All arrangements are draft-until-approved by a human (draft-then-approve). |

---

## Safety, Consent, and Compliance

### Outreach Basis

Use this skill only when a genuine unpaid invoice exists. Before placing any call, the operator must confirm:

- A real invoice was issued to the named client.
- The invoice is overdue under the agreed payment terms.
- No active legal proceedings or written dispute is on file that would make a phone approach inappropriate.

The outreach basis is **legitimate-interest follow-up on a specific, verified overdue invoice**. This skill is not a general-purpose collections tool. Do not use it for speculative debt, disputed receivables, or any call not tied to a specific invoice reference number.

### Phone Number Formatting — E.164

Accept E.164 format only (e.g. `+6598765432`, a fictional example). The `+` prefix and full country code are required. Do not accept local, national-format, or extension-only numbers.

Why this matters: a malformed number (e.g. `98765432` with no country code) can silently match a valid subscriber in a different country. CALL-E routes to the number exactly as given — it does not infer a missing country code. A misrouted call reaches the wrong person and may disclose invoice details to someone with no relation to the debt. There is a documented real-world case of this type of misroute in outbound calling systems, and `wrong_person` is already tracked as a first-class outcome in this skill's result schema for that reason.

Rules:
- Validate the number matches `^\+[1-9]\d{6,14}$` before passing it to CALL-E.
- Reject and surface a clear error on any number that does not match.
- Numbers in examples and documentation use the reserved fictional range `+1555010xxxx` — never real subscriber numbers.

### Human Approval Before Any Call

Every call must be reviewed and approved by a human operator before it is placed. The skill operates in two modes:

- **Draft mode** (default): the skill composes a call brief — invoice reference, amount, client identifier, destination number, and proposed script — and surfaces it for operator review. The operator explicitly approves or rejects before any CALL-E credit is consumed.
- **Dry-run mode**: the full script path executes but no call is dispatched and no credit is consumed. Use for development and testing.

No call is ever placed autonomously. The approval gate is enforced at the host layer. If the host does not implement an approval step, the skill must refuse to dispatch.

### No Duplicate Jobs — No Hidden Recurrence

The skill places one call per authorized run. It does not schedule retries, follow-ups, or recurrence independently.

- **Duplicate guard**: if a call for the same `invoice_id` is already in `pending` or `in_progress` state, reject the new request with a clear error. Do not place a second call.
- **Cooldown window**: do not dispatch a new call for the same invoice within the configured cooldown (default: 24 hours after `no_answer`; 48 hours after `voicemail`; no automated retry after `wrong_person` — verify the number before retrying).
- **No hidden recurrence**: scheduled follow-ups after a `committed_to_date` or other outcome are the host scheduler's responsibility, not this skill's. This boundary prevents the skill from accumulating state or spending call credits without the operator's knowledge.

#### Recurrence: visible and approval-gated (intended operating mode)

The host application **may** schedule recovery calls to recur — this is the intended operating mode — provided recurrence is **visible** and **approval-gated**, never hidden:

- **Batch approval (recommended).** A scheduled sweep *drafts* recovery calls for invoices crossing overdue thresholds; the operator reviews and approves them as a batch in one review moment; approved calls dial themselves at their scheduled times — one at a time, within calling hours for the client's region. Every recurring call is drafted on a schedule and human-approved before it dials, so recurrence is deliberate, auditable, and stoppable: any queued call is shown on its invoice with a cancel control, and a per-destination cap bounds how often one number can be dialed.
- **Per-call approval (manual alternative).** Draft mode above — the operator approves each individual call before it is placed.

What stays prohibited is *hidden* recurrence: a call that dials without passing a human approval, or scheduling the operator cannot see or cancel. The duplicate guard, cooldown, and per-destination cap apply within either mode.

### PII Masking in Logs and Summaries

Logs, dry-run output, and any summary written to a shared surface must mask personal data:

| Field | Masking rule |
|-------|-------------|
| Phone number | Last four digits only: `+*******4321` |
| Client full name | Initials or reference ID: `A.B.` or `CLT-0042` |
| Email address | Mask local part: `m***@example.com` |
| Invoice amount | May be shown in full (financial data, not personal data) |

No PII appears in dry-run output. Operators who store unmasked data in their own systems are responsible for their own data-handling obligations.

### Credential Hygiene

- Never commit `CALLE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or any credential to version control or log output.
- The Supabase service-role key is server-side only; it never reaches a browser client.
- Log lines must not contain API keys, session tokens, or auth headers.
- CALL-E call IDs returned in API responses may be stored as opaque references — they are not credentials.

### Jurisdiction Warning

Debt-collection law varies significantly by country. This skill is a communication and record-keeping tool, not a regulated collections system. Before placing any call, the operator is solely responsible for confirming that:

- Outbound debt-collection calls are lawful in the recipient's jurisdiction.
- The call complies with applicable consumer-protection and data-protection law (e.g. FDCPA and the Telephone Consumer Protection Act in the US; GDPR-derived rules in the EU; PDPA in Singapore; Privacy Act in Australia).
- Any jurisdiction-required disclosures (e.g. "this is an attempt to collect a debt" under FDCPA) are added to the script before the call is placed.
- Call timing and frequency comply with local restrictions (e.g. no calls before 8 am or after 9 pm local time under FDCPA).

The maintainers of this skill make no legal representations. Use in a regulated context is entirely at the operator's risk.

For the full safety contract including worked examples of masking and E.164 validation, see `references/safety.md`.

## References

- `references/safety.md` — consent, E.164, masking, jurisdiction
- `references/examples.md` — worked conversation examples and outcome patterns
