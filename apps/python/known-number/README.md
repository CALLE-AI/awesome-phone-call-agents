# Known Number

**Call the number you already had. Never the number in the email.**

Known Number turns the single most recommended and least performed control against vendor payment fraud into a CALL-E workflow that finance teams will actually run: when a supplier asks to be paid into a different bank account, it dials the phone number that was already in the vendor master, has the vendor read the new details back, and produces a fail-closed verdict with quotable evidence. The call carries no secret, the request's own callback number is never dialed, and a phone number that was itself changed recently cannot be used to anchor the check.

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
  CALL-E call to the KNOWN number, with a task that contains no bank
  name and no digits, and a closed result_schema for the read-back
        │ terminal result (summary, evidence quotes, structured_result)
        ▼
  ┌──────────────── deterministic reconciliation (no model) ─────────┐
  │ CONFIRMED · DENIED_BY_VENDOR · MISMATCH · ESCALATE · INCONCLUSIVE │
  └───────────────────────────────────────────────────────────────────┘
        │
        ▼
  audit record (JSON) + memo (Markdown) filed against the ticket
```

Three design decisions carry the security value:

1. **The call carries no secret.** The task text asks the contact to *state* the bank name and the last four digits of the new account. It never contains them, so CALL-E cannot leak them, a wrong-number answerer learns nothing, and a transcript cannot be mined for the new account. Reconciliation compares locally. `preview` reports `secret_free_task: true` and a test enforces it.
2. **The number on file must be old.** An attacker who can change a vendor's bank details can usually change its phone number first. Gate 1 refuses to anchor a callback on a number recorded less than 30 days before the request (configurable). The request's own "call me on my new direct line" number is logged as an indicator and never dialed.
3. **Only a full match confirms.** Eleven fixture outcomes map to five verdicts and exactly one of them releases the change. A vendor saying "no, we never asked" is a fraud signal. Matching digits with "I never sent that email" is an escalation, because the digits may have come from the vendor's own compromised mailbox. Any attempt to give new details on the call ends in ESCALATE regardless of what else was said.

## Setup

```bash
cd apps/python/known-number
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[test]"
python3 -m pytest -q          # 32 tests, no network
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

Live run. Creates exactly one CALL-E call task for the ticket, records the call id to `state/<ticket>.json` before polling, then reconciles and writes `state/<ticket>.memo.md`.

```bash
set -a; source .env.local; set +a       # CALLE_API_KEY=..., optional CALLE_BASE_URL, KNOWN_NUMBER_COMPANY
known-number verify --live --approver "A. Reviewer" \
  --request examples/change_request.json --vendors examples/vendors.json
```

Resume a live ticket after a crash or timeout (never dials again):

```bash
known-number status --request examples/change_request.json --vendors examples/vendors.json
```

Reconcile any saved call JSON offline, for example one exported from the CALL-E dashboard:

```bash
known-number reconcile --request examples/change_request.json --vendors examples/vendors.json \
  --call-json fixtures/mismatch_last4.json
```

Exit codes: `0` verdict releases the change, `3` verdict holds it, `1` blocked by policy, `2` usage or credential error.

### Inputs

`examples/vendors.json` is the trusted side. Each vendor needs `known_phone` (E.164), `known_phone_since`, `region` and `locale` (see the CALL-E supported-regions table), `authorized_contacts`, and the bank name and last four digits currently on file. Full account numbers are never stored anywhere in this app.

`examples/change_request.json` is the untrusted side, transcribed from the email or portal exactly as it arrived, including any callback number the requester supplied.

### Verdicts

| Verdict | Meaning | Releases change |
| --- | --- | --- |
| `CONFIRMED` | Authorized contact reached, confirms the request, reads back matching bank and last four, confirms normal channel, CALL-E reports completion with non-low confidence and at least one evidence quote | yes |
| `DENIED_BY_VENDOR` | Contact says no change was requested | no, and notify the vendor's security contact |
| `MISMATCH` | Contact reads back different digits or a different bank | no, hold and escalate |
| `ESCALATE` | Contact offered alternate details on the call, or details match but the request did not come through the normal channel | no, hold and escalate |
| `INCONCLUSIVE` | Not reached, voicemail, wrong person, no read-back, low confidence, no evidence, call failed | no, retry or use a second known channel |

Run `known-number demo` to see all eleven fixtures land in the table above.

## What the call sounds like

The task instructs CALL-E to identify itself as an automated assistant that is not a person, state that the call is recorded and written down, ask for a named authorized contact, and only then explain that a payment-detail change request was received and that policy requires a callback to the number on file. It asks three questions: was a change requested, what bank and which last four digits, and did it go through the normal channel. It refuses any new details, interrupts a full account number being read out, leaves no details on voicemail, and stays under three minutes. The full text is printed by `preview`.

## Side effects, credentials, cancellation

- **Side effects.** `verify --live` places one real outbound call to the vendor's number on file. Nothing else in this app contacts anyone. `preview`, `verify` without `--live`, `reconcile`, `demo` and the test suite make no network requests.
- **Credentials.** `CALLE_API_KEY` is read from the environment only. Load it from a private file (`chmod 600 .env.local`); do not pass it as a command-line argument. The app never prints it and never writes it to `state/`.
- **Idempotency.** The `Idempotency-Key` sent to CALL-E is `known-number:<ticket_id>`, and the returned call id is persisted before the first poll. A second `verify --live` for the same ticket resumes with `status` instead of dialing again.
- **Cancellation.** There are no recurring jobs. To stop a call in progress, use the CALL-E dashboard or API; the local ticket state stays as it is and `status` will reconcile whatever terminal state the call reaches. A `canceled` or `failed` status reconciles to `INCONCLUSIVE`.
- **Data handling.** State files are written with mode `0600`. Phone numbers are masked in every printed line and in the memo. The audit record carries a SHA-256 fingerprint of the request as received so the memo can be tied to the original email later without storing the email.
- **What it will not do.** Accept new bank details by phone, read any account digits, verify a request for a vendor that is not in the master, dial a number that came from the request, or say `CONFIRMED` on partial evidence.

## Running it in India and other "International" line regions

Set the vendor's `region` and `locale` from the CALL-E supported-regions table (for India: `"region": "IN"`, English, Hindi or Tamil). Nothing else changes. The read-back protocol was designed with Indian payments in mind, where an IFSC code plus account number is the norm: asking for only the last four digits of the account, and the bank name, is enough to detect substitution without ever moving a full account number across a voice channel.

## Extending

- Wire `verify --live` into the AP ticketing system so the memo is attached to the change ticket automatically.
- Add a second recipient (a second authorized contact) for dual confirmation on changes above a threshold; the reconciliation already reads recipient-level `structured_result` objects.
- Feed `DENIED_BY_VENDOR` and `MISMATCH` verdicts to the security team as confirmed BEC attempts against your supply chain.

## Layout

```text
known-number/
├── known_number/
│   ├── models.py      # ChangeRequest, VendorRecord, Verdict, masking
│   ├── policy.py      # pre-call gates
│   ├── task.py        # secret-free task text + closed result_schema
│   ├── reconcile.py   # deterministic verdict matrix
│   ├── render.py      # audit record + memo
│   ├── store.py       # per-ticket state, resume, 0600
│   └── cli.py
├── examples/          # fictional vendor master + change requests
├── fixtures/          # eleven terminal call results, one per outcome
└── tests/             # 32 tests, no network
```

## Sources

- FBI Internet Crime Complaint Center, *2024 Internet Crime Report* (BEC: 21,442 complaints, $2.77B losses).
- FBI IC3 Public Service Announcement, *Business Email Compromise: The $55 Billion Scam* (PSA240911).
- Association for Financial Professionals, *2026 Payments Fraud and Control Survey* (76% of organizations experienced attempted or actual payments fraud in 2025; 74% affected by BEC).
