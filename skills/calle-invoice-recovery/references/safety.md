# Safety Contract

This file is the authoritative reference for the safety, consent, and compliance requirements of the `calle-invoice-recovery` skill. The summary in `SKILL.md § Safety, Consent, and Compliance` is derived from this document; if the two conflict, this file wins.

---

## Consent and Outreach Basis

**What authorizes a call?** A genuine overdue invoice issued to the named client, with the payment term expired and no active legal dispute on file. This is a legitimate-interest basis: the operator has a direct commercial relationship with the client and is following up on a specific, documented obligation.

**What does not authorize a call:**

- Speculative or unverified debt with no invoice reference
- Any invoice under active legal proceedings (refer to counsel instead)
- Any written dispute that has not been resolved — the agent must not re-open a dispute by phone
- Any call not tied to a specific invoice reference number (general "outstanding balance" calls are out of scope)

**One authorization, one call.** Each operator approval covers exactly one call to one number about one invoice. A new approval is required for every retry, even if the outcome was `no_answer`.

---

## Phone Number Handling — E.164

### Required format

Accept E.164 format only:

```
+[country code][subscriber number]
^\+[1-9]\d{6,14}$
```

Examples of valid numbers (all fictional/illustrative): `+6598765432` (Singapore — illustrative), `+12015550123` (US — NANP 555-01xx reserved), `+447700900123` (UK — Ofcom 07700 900xxx reserved).

### Why malformed numbers are a real risk

A number submitted without a country code (e.g. `98765432`) is a valid E.164-length string in multiple countries simultaneously. CALL-E routes to the number exactly as given and does not infer a country code. In one documented class of misroute in outbound calling systems, a number formatted for a local dialing context (no leading `+` or country code) matched a valid subscriber in a different country, and the call connected to a stranger. The stranger received the opening of an invoice-recovery script — including the business name and caller ID — before the agent reached the identity-confirmation gate.

This is why:
1. The identity-confirmation gate in Phase 1 exists and is non-optional.
2. The `wrong_person` outcome is tracked as a first-class result (not just an error).
3. E.164 validation must happen **before** the call brief is constructed, not after.

### Validation rule

Reject any number that does not match `^\+[1-9]\d{6,14}$` with a clear, operator-visible error:

```
Error: phone number "98765432" is not in E.164 format.
Expected: +[country code][number], e.g. +6598765432
```

Do not silently prepend a country code or attempt to canonicalize the number — the operator must supply the correct country code explicitly.

### Reserved test numbers

All numbers used in examples, documentation, and dry-run output must come from the reserved fictional range `+1555010xxxx` (555-01xx). These are guaranteed non-dialable under the NANP Fictitious Number Standard. Never use a real subscriber number in documentation.

---

## Human Approval Before Any Call

The skill enforces a **draft-then-approve** pattern at every call dispatch point.

### Draft mode (default)

1. The skill assembles a call brief containing: invoice reference, client identifier, masked phone number, proposed script summary, and estimated call duration.
2. The brief is presented to the operator for review.
3. The operator explicitly clicks Approve or Reject.
4. Only an Approve triggers the CALL-E API call.

The draft is never auto-approved. There is no timeout that causes an auto-approval.

### Dry-run mode

In dry-run mode the full execution path runs — skill input parsing, call brief assembly, script generation — but no request is sent to the CALL-E API and no credit is consumed. Dry-run output is labeled `[DRY RUN]` in every log line.

Dry-run mode is enabled by setting `CALLE_MODE=mock` or by passing `dry_run: true` in the skill input. It cannot be disabled by the skill; it is enforced at the host layer.

### Host-layer requirement

If the host agent framework does not implement a human-in-the-loop approval gate, the skill must refuse to dispatch with:

```
Error: no approval gate detected. This skill requires explicit operator
approval before placing a call. Configure an approval step in your host.
```

---

## No Duplicate Jobs — No Hidden Recurrence

### Duplicate guard

Before dispatching any call, check the `calls` table for an existing record with:
- `invoice_id` matching the current request, AND
- `status` in `('pending', 'in_progress')`

If such a record exists, reject the dispatch:

```
Error: a call for invoice INV-0042 is already in_progress (call_id: cle_xxx).
Wait for it to complete or cancel it before dispatching a new one.
```

### Cooldown window

After a completed call, enforce a per-outcome cooldown before a new call for the same invoice may be dispatched:

| Outcome | Default cooldown |
|---------|----------------|
| `no_answer` | 24 hours |
| `voicemail` | 48 hours |
| `wrong_person` | No automated retry — verify number first |
| `paid_now` | No further calls |
| `committed_to_date` | No further calls until commitment date passes |
| `disputed` | No further calls — refer to written follow-up |
| `refused` | No further automated calls |

Cooldowns are enforced by the skill's pre-dispatch check against the `calls` table. The operator may override the cooldown explicitly, but the override must be a deliberate action (not a default).

### No hidden recurrence

This skill does not schedule its own follow-ups. It does not create cron jobs, register webhooks, or enqueue future tasks. Any scheduled follow-up after a `committed_to_date` outcome is the host scheduler's responsibility, configured explicitly by the operator. This boundary prevents call credits from being spent without the operator's knowledge.

### Recurrence when the host schedules it: visible and approval-gated

Recurrence at the host level is permitted and is the intended operating mode, as long as it is **visible** and **approval-gated** — never hidden:

- The host may run a scheduled sweep that **drafts** recovery calls for newly overdue invoices, present them to the operator for **batch approval**, and then dial the approved calls automatically at their scheduled times (one at a time, within calling hours). Every recurring call is drafted on a schedule and human-approved before it dials.
- Recurrence must remain observable and reversible: each queued call is shown on its invoice with a cancel control, a per-destination cap bounds how often a single number is dialed, and drafts that are not approved within a window expire rather than dialing.

The line that must not be crossed is a call dialing **without** having passed a human approval, or scheduling the operator cannot see or stop. Per-call approval (draft mode) remains available as the manual alternative to batch approval.

---

## PII Masking Rules

Apply these rules in all log lines, dry-run output, dashboard summaries, and any data written to a shared or queryable surface.

### Phone numbers

Show the last four digits only. Mask all preceding digits with `*`:

```
Input:   +6598765432
Masked:  +******5432
```

Implementation:
```typescript
function maskPhone(e164: string): string {
  if (e164.length <= 4) return '****';
  return '+' + '*'.repeat(e164.length - 5) + e164.slice(-4);
}
```

### Client names

Replace with initials or a reference ID. Use initials when the name is known at masking time; use the reference ID when the name is unavailable:

```
"Acme Design Pte Ltd"  →  "A.D."  or  "CLT-0042"
"Jane Smith"           →  "J.S."
```

### Email addresses

Mask the local part, preserve the domain for operator reference:

```
jane.smith@acmedesign.com  →  j***@acmedesign.com
```

### What is not masked

Invoice amount and currency are financial data, not personal data, and may appear in full in logs. Invoice reference numbers are internal identifiers and may appear in full.

### Dry-run output

No PII appears in dry-run output under any circumstances. If the skill is invoked with real client data in dry-run mode, masking is applied before any output is written.

---

## Credential Hygiene

- `CALLE_API_KEY` — never logged, never committed, never returned in an API response to the client.
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only. Never exposed to browser clients, never included in client-side bundles, never logged.
- No credential of any kind in log lines, dry-run output, or transcript references.
- CALL-E call IDs (e.g. `cle_01jxyz...`) returned in API responses are opaque references, not credentials — they may be stored and logged safely.
- The `.env` file is `.gitignore`d. Never commit it. Never include it in build artifacts.

---

## Jurisdiction Warning

Debt-collection law varies significantly by country. This skill is a **communication and record-keeping tool**, not a licensed collections system.

Before placing any call, the operator — not the skill maintainers — is solely responsible for:

1. **Confirming legality.** Verifying that outbound debt-collection calls are lawful in the client's jurisdiction. In some jurisdictions (e.g. Germany), unsolicited commercial calls are restricted even for existing commercial relationships.

2. **Required disclosures.** Adding any jurisdiction-mandated disclosures to the script. Under the US FDCPA, for example, the agent must state: "This is an attempt to collect a debt, and any information obtained will be used for that purpose." This statement is not in the default script — US operators must add it.

3. **Timing restrictions.** Complying with local rules on when calls may be placed. FDCPA: no calls before 8 am or after 9 pm in the client's local timezone. Other jurisdictions have similar rules.

4. **Data protection.** Ensuring the call and any resulting data handling comply with applicable data-protection law (GDPR, Singapore PDPA, Australia Privacy Act, etc.).

5. **Licensing.** Confirming whether a third-party debt-collection license is required in the client's jurisdiction. In the US, a third-party collector must hold a license in many states; a first-party collector (the business that issued the invoice) is generally exempt, but state rules vary.

6. **Automated-call disclosure.** The call is placed by an AI voice agent, and the voice is convincing enough that a listener may not realise it is automated. The generated script therefore opens with an automated-call disclosure ("this is an automated call from Devixus Finance on behalf of a client") *before* any invoice is discussed. Disclosure obligations for automated, AI, or prerecorded calls vary by jurisdiction — the required wording, its timing, and whether prior consent is needed differ (for example US TCPA rules on prerecorded/autodialed calls, and automated-call/robocall identification rules in a number of countries). Operators must confirm the automated-call disclosure that applies in the client's jurisdiction and adjust the opening line accordingly; the default disclosure is a starting point, not a legal guarantee.

**The maintainers of this skill make no legal representations.** Use of this skill in a regulated context — including but not limited to the US, EU member states, Australia, Singapore, and Canada — is entirely at the operator's risk. When in doubt, consult a lawyer in the relevant jurisdiction before placing calls.
