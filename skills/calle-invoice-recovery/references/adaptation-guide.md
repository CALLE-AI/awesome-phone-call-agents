# Adaptation Guide

This guide describes every change an operator must make to deploy the
`calle-invoice-recovery` skill in their own context. The skill is intentionally
generic; the fields below are the seams where your business-specific details go.

---

## 1. Business Name and Callback Contact

The skill inserts an operator-supplied business name and callback contact into the
agent script at every point where SKILL.md uses the placeholder `[Operator / Business Name]`
or `[Callback Contact]`. You supply these as skill input parameters; they are not
hard-coded.

| Parameter | What to supply |
|-----------|---------------|
| `operator_name` | The trading name your clients know you by (e.g. "Acme Studio"). Keep it short — the agent speaks it aloud. |
| `agent_name` | The first name the agent introduces itself with (e.g. "Alex", "Sam"). Choose a name that sounds natural to your client base. |
| `callback_contact` | The phone number or email address the client should use to reach you with questions. This is read aloud at the close of every call; make sure it is correct and answered. |

Example:

```json
{
  "operator_name": "Acme Studio",
  "agent_name": "Sam",
  "callback_contact": "accounts@acme.example"
}
```

---

## 2. Invoice Data Source

The skill expects invoice data as a structured input object. This skill folder does
not ship a database schema, an ORM, or a datastore — wiring invoice storage to
Supabase, Postgres, or any other system is a host-implementation decision. Wherever
your invoices live, you need to supply the fields below.

**Required fields per invoice:**

| Field | Type | Description |
|-------|------|-------------|
| `invoice_ref` | string | Your internal invoice reference number. Spoken to the client. Must be meaningful to them (e.g. "INV-2026-041"). |
| `amount` | number | Invoice amount as a decimal. |
| `currency` | string | ISO 4217 currency code (e.g. `"USD"`, `"GBP"`, `"AUD"`). |
| `due_date` | string | ISO 8601 date the invoice was due (e.g. `"2026-06-20"`). |
| `days_overdue` | number | Days elapsed since `due_date`. Compute server-side; do not pass a client-computed value. |
| `client_phone` | string | E.164 number (e.g. `"+6598765432"`). See section 4 on validation. |
| `region` | string | CALL-E recipient region code (see section 5). |

**Pulling from a different invoice system:** If your invoices live in QuickBooks,
Xero, FreshBooks, or a custom ERP, write a thin adapter that queries your system
and maps the result to the fields above. The skill does not care where the data
comes from, only that the shape matches. Do not pass fields the `result_schema`
does not declare — CALL-E will reject them.

---

## 3. Tone and Script Adjustments

The default script in SKILL.md is professional and neutral — appropriate for a
first-contact invoice chase between businesses (B2B). If your client relationships
or industry norms call for a different register, adjust the script phrases in
SKILL.md Phase 2-5 before deploying.

**Things you can change without breaking the skill logic:**

- Opening greeting ("Hello, this is..." can become more formal or warmer)
- Phrasing of the invoice statement in Phase 2
- Closing line templates in Phase 5
- The agent name (see section 1)

**Things you must not change:**

- The Phase 1 identity-confirmation gate — it must run before any financial information is disclosed.
- The draft-then-approve requirement — removing the approval gate violates the skill's safety contract.
- The `result_schema` field names — CALL-E validates these exactly; changes will cause API errors.
- The `wrong_person` path — this must remain a first-class outcome (do not merge it into `no_answer`).

**Jurisdiction-required disclosures:** Some regions require specific wording that is
not in the default script. See `references/safety.md § Jurisdiction Warning` for a
list of known requirements. The most common:

- **United States:** FDCPA requires "This is an attempt to collect a debt, and any information obtained will be used for that purpose." Add this to the Phase 2 opening for US clients.
- **Australia:** ASIC and ACCC guidance generally permits B2B invoice follow-up calls; no specific mandatory disclosure, but timing rules apply (reasonable business hours).
- **United Kingdom:** FCA rules cover consumer credit, not B2B trade debt — most freelancer/agency contexts are B2B and outside FCA scope, but confirm with your legal counsel.
- **European Union:** GDPR requires a lawful basis for processing. Legitimate interest covers a genuine overdue invoice; add a brief statement if your legal counsel recommends it.

---

## 4. Phone Number Validation

All recipient numbers must be in E.164 format before being passed to the skill.
The required regex is:

```
^\+[1-9]\d{6,14}$
```

Examples of valid E.164 numbers (all fictional, for illustration only):
- `+12015550123` (United States — NANP 555-01xx reserved range)
- `+447700900123` (United Kingdom — Ofcom 07700 900xxx drama range)
- `+61491570156` (Australia — ACMA 0491 570 xxx fiction range)
- `+6598765432` (Singapore — illustrative; Singapore publishes no reserved range)

**What to change in your system:**

1. Ensure your invoice database or CRM stores phone numbers in E.164. If they are
   stored in local format (e.g. `0491 570 156` for Australia), write a normalizer
   that prepends the correct country code and strips whitespace/formatting before
   the number reaches the skill.
2. Do not attempt to auto-correct a missing country code at call time — the skill
   rejects malformed numbers with a visible error, by design. The operator must
   supply the correct country code explicitly (see `references/safety.md` for why).

---

## 5. Supported Recipient Regions and Languages

CALL-E places calls only to the regions and in the languages it supports. Before
adding a client to your invoice dataset, confirm their country is in the table below.

**Supported recipient regions** (the CALL-E region table, plus Bangladesh — enabled 2026-07-28):

| Region code | Country | Default call language |
|-------------|---------|----------------------|
| US | United States | English |
| SG | Singapore | English |
| MY | Malaysia | English |
| IN | India | English, Hindi |
| AE | United Arab Emirates | English |
| AU | Australia | English |
| CA | Canada | English |
| GB | United Kingdom | English |
| VN | Vietnam | English |
| DE | Germany | English |
| JP | Japan | English |
| FR | France | English |
| MX | Mexico | English |
| BR | Brazil | English |
| ID | Indonesia | English |
| PH | Philippines | English |
| KE | Kenya | English |
| BD | Bangladesh | English (Bengali not supported) |

**If your client is in a region not listed**, CALL-E cannot place the call.
Do not attempt to route calls to unsupported regions — the API will reject the request.
Use a different outreach channel (email, written notice) for clients in unlisted countries.

**Language note:** CALL-E's default language for all listed regions is English.
If a specific region supports additional languages (e.g. Hindi for IN), pass the
`language` parameter explicitly in the skill input. The skill defaults to English
if no language is specified.

**Bangladesh (+880) is supported — English only; Bengali is NOT supported.** A
Bangladesh-based operator can call local Bangladesh clients (in English) or clients in
other supported regions — CALL-E routes by the *recipient's* country, not the operator's.

---

## 6. API Keys and Environment Setup

**Environment variables the CALL-E integration needs, at minimum:**

| Variable | Where to get it | Notes |
|----------|----------------|-------|
| `CALLE_API_KEY` | Your CALL-E dashboard | Never commit; set via your deployment environment. |
| `CALLE_MODE` | Set yourself | `mock` for development and dry-run; `live` only when placing real calls with real credits. |

If your host implementation uses Supabase (or any other datastore) to back invoice and
call records, add the corresponding connection variables (e.g. `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`) to your own environment configuration. This skill folder
does not ship a datastore or an environment-variable template — how you store and load credentials is
a host-implementation decision. Whatever mechanism you use, never commit real
credentials to version control.

---

## 7. Dry-Run Before Going Live

Before placing any real call, run the standalone dry-run script shipped in this skill
folder to preview the exact payload and agent script CALL-E would receive:

```bash
npx tsx skills/calle-invoice-recovery/scripts/dry-run.ts
npx tsx skills/calle-invoice-recovery/scripts/dry-run.ts --invoice-ref INV-2026-038
```

This script makes no network request and consumes no CALL-E credit. It prints the
request payload, the generated agent script, and the result-schema shape for one of the
fictional sample invoices in `references/examples.md`, with all output labelled
`[DRY RUN]`. It previews the call-generation logic only — it does not exercise your own
host's invoice lookup, approval gate, or storage layer. Test those separately in your
own implementation before going live.

Only set `CALLE_MODE=live` in your host when you have confirmed your integration
behaves correctly, the approval gate is wired up, and you are ready to spend a real call
credit.

---

## 8. Outcome Handling

Each outcome from the `result_schema` requires a different next action from the
operator. See the outcome table in SKILL.md for the full list. The actions you need
to wire up in your host scheduler or notification system:

| Outcome | Operator action to configure |
|---------|------------------------------|
| `paid_now` | No date or arrival window is captured (see SKILL.md, "Out of Scope for This Version"), so nothing here can drive an automated trigger. The operator reconciles receipt against the invoice manually. |
| `committed_to_date` | Schedule a follow-up call or email for `commitment_date + 1 business day`. |
| `disputed` | Route to the account manager by email within 1 business day. |
| `refused` | Route to the operator for a write-off, settlement offer, or collections referral — this outcome also covers an engaged partial-payment or instalment offer the schema can't capture (see SKILL.md, "Out of Scope for This Version"). |
| `no_answer` | Schedule a retry after the configured cooldown (default: 24 hours). |
| `voicemail` | Optional: send a written follow-up. Retry after 48 hours if no response. |
| `wrong_person` | Verify the contact number before any retry. Do not retry automatically. |

The skill does not schedule any of these follow-ups itself. It fires one call, logs
the outcome, and stops. All recurrence is the host scheduler's responsibility.
