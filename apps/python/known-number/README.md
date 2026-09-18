# Known Number

**Call the number you already had. Never the number in the email.**

Known Number turns the single most recommended and least performed control against vendor payment fraud into a CALL-E workflow that finance teams will actually run: when a supplier asks to be paid into a different bank account, it dials the phone number that was already in the vendor master, asks three yes/no questions, hands over a callback reference, and holds the change until that reference comes back in writing from the address that was also already on file. The phone leg collects nothing (no bank name, no digits, no code), the request's own callback number is never dialed, and a phone number that was itself changed recently cannot be used to anchor the check. Every outcome lands in one of six fail-closed verdicts with quotable evidence and an audit memo.

Verified live: one real CALL-E call over an international line (India) completed the phone leg with a 0.93 completion confidence, and the written reply closed the ticket as CONFIRMED. The transcript is summarised in [What the call sounds like](#what-the-call-sounds-like).

The included example is fictional and uses NANP-reserved `202-555-01xx` numbers. Preview, demo and tests place no call.

## Why this exists

A supplier's mailbox is compromised, or a look-alike domain is registered, and accounts payable receives a polite note: *we have moved our banking, please update before the next payment run.* The next invoice is paid into the attacker's account. The FBI's Internet Crime Complaint Center recorded 21,442 business email compromise complaints and $2.77 billion in losses for 2024 alone, and the Association for Financial Professionals reports that 74% of US organizations were affected by BEC in 2025. Vendor impersonation is the largest slice of that.

Every advisory on the subject (FBI, AFP, the banks' own fraud pages) prescribes the same control: verify any change in payment instructions by calling a phone number already on file, obtained independently of the request. It works because the attacker controls the email thread but not the vendor's real switchboard.

It is also skipped constantly, for mundane reasons. Somebody has to find the old number, get past reception, reach a person who can answer, avoid reading the new account number out loud to whoever picked up, write down what was said, and file it. That is fifteen minutes of awkward phone work per change, and it lands on the least senior person in the department at month end. Known Number makes the control cheap enough to be mandatory.

## What it does

```text
change request (untrusted)          vendor master (trusted)
        │                                    │
        ▼                                    ▼
  ┌──────────────────── policy gates (no network) ────────────────────┐
  │ vendor exists · phone on file predates request by ≥30 days        │
  │ request's own callback number is discarded · change is real       │
  │ live run needs a named approver                                   │
  └───────────────────────────────────────────────────────────────────┘
        │ allowed
        ▼
  PHONE LEG: CALL-E call to the KNOWN number. Three yes/no questions,
  then the assistant SPEAKS a callback reference. Nothing is collected.
        │ terminal result (summary, evidence quotes, structured_result)
        ▼
  ┌──────────────── deterministic reconciliation (no model) ─────────┐
  │ DENIED_BY_VENDOR · MISMATCH · ESCALATE · INCONCLUSIVE · or        │
  │ PENDING_WRITTEN_REPLY when the phone leg is clean                 │
  └───────────────────────────────────────────────────────────────────┘
        │ PENDING_WRITTEN_REPLY
        ▼
  WRITTEN LEG: the vendor replies from the address on file quoting
  the reference  →  `known-number close --written-reply reply.txt`
        │
        ▼
  CONFIRMED (only here) · audit record (JSON) + memo (Markdown)
```

Three design decisions carry the security value:

1. **The phone leg collects nothing.** The task never contains a bank name or an account digit, and it never asks the contact to read anything out. It asks whether a change was requested, whether the written notice (sent separately to the address on file, restating the change) describes it, and whether it came through the normal channel. Then it *gives* the contact a six-character callback reference derived from the request. A wrong-number answerer learns nothing usable, a transcript cannot be mined for anything, and the reference is only useful to someone who can also send mail from the vendor's address on file. `preview` reports `payment_free_task: true` and a test enforces it.
2. **The number on file must be old.** An attacker who can change a vendor's bank details can usually change its phone number first. Gate 1 refuses to anchor a callback on a number recorded less than 30 days before the request (configurable). The request's own "call me on my new direct line" number is logged as an indicator and never dialed.
3. **Two channels must both close, and only a full match confirms.** Eleven fixture outcomes map to six verdicts and exactly one of them releases the change, and it is only reachable after a written reply quoting the reference. A vendor saying "no, we never asked" is a fraud signal. A confirmed notice with "I never sent that email" is an escalation, because the request may have come from the vendor's own compromised mailbox. Any attempt to give new details on the call ends in ESCALATE regardless of what else was said.

This shape was not the first draft. Two earlier versions asked the contact to read back the last four digits of the new account, then to read back a one-time code from the notice. CALL-E's task planner refused both before dialing: it will not plan a call that asks a recipient to provide or confirm payment details, even partially, and it will not plan a call that asks a recipient to read out a verification code or OTP. Those are the two classic phone-scam scripts and the refusal is the right default. The protocol got stronger for obeying it: nothing sensitive can now cross the voice channel in either direction, and proof of channel control moved to a leg where it can be filed.

## Setup

```bash
cd apps/python/known-number
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[test]"
python3 -m pytest -q          # 36 tests, no network
known-number demo             # verdict table for every fixture, no network
```

Requires Python 3.11+. The only runtime dependency is the official `calle-ai` SDK.

## Usage

Preview the gates and the exact task and schema that would be sent. No network.

```bash
known-number preview --request examples/change_request.json --vendors examples/vendors.json
```

Dry-run (the default). Shows the masked number that would be dialed and stops.

```bash
known-number verify --request examples/change_request.json --vendors examples/vendors.json
```

Live run. Creates exactly one CALL-E call task for the ticket, records the call id to `state/<ticket>.json` before polling, then reconciles and writes `state/<ticket>.memo.md`. A clean phone leg ends at `PENDING_WRITTEN_REPLY`.

```bash
set -a; source .env.local; set +a       # CALLE_API_KEY=..., optional CALLE_BASE_URL, KNOWN_NUMBER_COMPANY, KNOWN_NUMBER_CODE_SECRET
known-number verify --live --approver "A. Reviewer" \
  --request examples/change_request.json --vendors examples/vendors.json
```

Close the ticket when the vendor's written reply arrives from the address on file. The reply must quote the callback reference the assistant spoke on the call.

```bash
known-number close --written-reply examples/written_reply.txt \
  --request examples/change_request.json --vendors examples/vendors.json
```

Resume a live ticket after a crash or timeout (never dials again), or re-dial after a carrier failure with `verify --live --attempt 2`:

```bash
known-number status --request examples/change_request.json --vendors examples/vendors.json
```

Reconcile any saved call JSON offline, for example one exported from the CALL-E dashboard:

```bash
known-number reconcile --request examples/change_request.json --vendors examples/vendors.json \
  --call-json fixtures/mismatch_last4.json
```

Exit codes: `0` verdict releases the change, `3` verdict holds it (including `PENDING_WRITTEN_REPLY`), `1` blocked by policy, `2` usage or credential error.

### Inputs

`examples/vendors.json` is the trusted side. Each vendor needs `known_phone` (E.164), `known_phone_since`, `region` and `locale` (see the CALL-E supported-regions table), `authorized_contacts`, and the bank name and last four digits currently on file. Full account numbers are never stored anywhere in this app.

`examples/change_request.json` is the untrusted side, transcribed from the email or portal exactly as it arrived, including any callback number the requester supplied.

### Verdicts

| Verdict | Meaning | Releases change |
| --- | --- | --- |
| `CONFIRMED` | Phone leg clean and a written reply from the address on file quotes the callback reference | yes |
| `PENDING_WRITTEN_REPLY` | Phone leg clean: authorized contact reached, change acknowledged, notice confirmed, normal channel confirmed, reference delivered, non-low confidence, evidence present. Waiting for the written leg | no, wait |
| `DENIED_BY_VENDOR` | Contact says no change was requested | no, and notify the vendor's security contact |
| `MISMATCH` | Contact says the written notice does not describe their request, or the written reply does not quote the reference | no, hold and escalate |
| `ESCALATE` | Contact offered new details on the call, or the notice is confirmed but the request did not come through the normal channel | no, hold and escalate |
| `INCONCLUSIVE` | Not reached, voicemail, wrong person, notice not seen, reference not delivered, low confidence, no evidence, call failed | no, retry or use a second known channel |

Run `known-number demo` to see all eleven fixtures land in the table above.

## What the call sounds like

The task instructs CALL-E to identify itself as an automated assistant that is not a person, state that the call is recorded and written down, ask for a named authorized contact, and only then explain that a supplier-profile change request was received and that policy requires a callback to the number on file. It asks three questions (was a change requested, does the written notice describe it, did it come through the normal channel), speaks the callback reference letter by letter, asks for a written reply quoting it, and ends. It refuses any details offered, leaves nothing on voicemail, and stays under three minutes. The full text is printed by `preview`.

From the live verification call (Indian mobile, English, 16 turns, ~2 minutes), lightly abridged:

> **Assistant:** This is an automated assistant, not a person, and this call is being recorded and its content written down. May I speak with Priya Raman or Daniel Okafor at Northwind Packaging Supplies?
> **Contact:** Hi, this is Priya.
> **Assistant:** [...] did your organization recently request a supplier profile change?
> **Contact:** Yes, our organization did do this. I had sent it through our normal channel.
> **Assistant:** [...] was the request sent by Priya Raman through your normal channel?
> **Contact:** Correct.
> **Assistant:** Since the change is only applied after a written reply arrives, please reply to the written notice from your usual address and quote reference H, E, four, N, F, five.
> **Contact:** I will reply. Thank you, bye.

Structured result returned by CALL-E: `reached_authorized_contact: true`, `requested_change: yes`, `notice_matches_request: yes`, `request_channel_confirmed: yes`, `reference_delivered: true`, `alternate_details_offered: false`, confidence `high (0.93)`. Verdict `PENDING_WRITTEN_REPLY`, then `CONFIRMED` after `close`.

## Side effects, credentials, cancellation

- **Side effects.** `verify --live` places one real outbound call to the vendor's number on file. Nothing else in this app contacts anyone. `preview`, `verify` without `--live`, `reconcile`, `demo` and the test suite make no network requests.
- **Credentials.** `CALLE_API_KEY` is read from the environment only. Load it from a private file (`chmod 600 .env.local`); do not pass it as a command-line argument. The app never prints it and never writes it to `state/`.
- **Idempotency.** The `Idempotency-Key` sent to CALL-E is `known-number:<ticket_id>:<hash of task text and attempt>`, and the returned call id is persisted before the first poll. A second `verify --live` for the same ticket resumes with `status` instead of dialing again; `--attempt 2` places a fresh call after a carrier failure. The task-text hash is there because CALL-E binds a key to the first body it sees even when the planner rejects that body.
- **Cancellation.** There are no recurring jobs. To stop a call in progress, use the CALL-E dashboard or API; the local ticket state stays as it is and `status` will reconcile whatever terminal state the call reaches. A `canceled` or `failed` status reconciles to `INCONCLUSIVE`.
- **Data handling.** State files are written with mode `0600`. Phone numbers are masked in every printed line and in the memo. The audit record carries a SHA-256 fingerprint of the request as received so the memo can be tied to the original email later without storing the email.
- **What it will not do.** Ask for or accept any payment details, codes, or passwords by phone; verify a request for a vendor that is not in the master; dial a number that came from the request; or say `CONFIRMED` before both legs have closed.

## Running it in India and other "International" line regions

Set the vendor's `region` and `locale` from the CALL-E supported-regions table (for India: `"region": "IN"`, `"locale": "en-IN"`). Nothing else changes; the live verification above was placed to an Indian mobile. One practical note: the first attempt to the same number failed at the carrier with SIP 480 before ringing and the second connected, so `--attempt` exists for a reason.

## Extending

- Wire `verify --live` into the AP ticketing system so the memo is attached to the change ticket automatically.
- Add a second recipient (a second authorized contact) for dual confirmation on changes above a threshold; the reconciliation already reads recipient-level `structured_result` objects.
- Have the ticketing system match inbound replies by reference automatically and call `close` itself; `KNOWN_NUMBER_CODE_SECRET` keeps references unguessable across tickets.
- Feed `DENIED_BY_VENDOR` and `MISMATCH` verdicts to the security team as confirmed BEC attempts against your supply chain.

## Layout

```text
known-number/
├── known_number/
││   ├── models.py      # ChangeRequest, VendorRecord, Verdict, callback reference, masking
│   ├── policy.py      # pre-call gates
│   ├── task.py        # payment-free task text + closed result_schema
│   ├── reconcile.py   # deterministic verdict matrix
│   ├── render.py      # audit record + memo
│   ├── store.py       # per-ticket state, resume, 0600
│   └── cli.py
├── examples/          # fictional vendor master, change requests, a written reply
├── fixtures/          # eleven terminal call results, one per outcome
└── tests/             # 36 tests, no network
```

## Sources

- FBI Internet Crime Complaint Center, *2024 Internet Crime Report* (BEC: 21,442 complaints, $2.77B losses).
- FBI IC3 Public Service Announcement, *Business Email Compromise: The $55 Billion Scam* (PSA240911).
- Association for Financial Professionals, *2026 Payments Fraud and Control Survey* (76% of organizations experienced attempted or actual payments fraud in 2025; 74% affected by BEC).
