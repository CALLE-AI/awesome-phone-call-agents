---
name: pharmacy-stock-check
description: Call a list of pharmacies to find out which one has a specific medication in stock, at what price, and whether they will hold it. Use when someone needs to locate a medication nearby and would otherwise ring round manually. Returns one structured record per pharmacy with a confidence score and the call transcript as evidence.
---

# Pharmacy stock check

Finding a medication that is actually in stock means calling pharmacies one at a
time and asking the same four questions. This skill does the calling and returns
a ranked answer.

It is a good fit for CALL-E's design: low-frequency, personal, high-stakes phone
work that was never worth automating with a traditional call platform.

## Before you start

**This skill places real phone calls to real businesses.** Confirm with the user:

- the medication, dosage and quantity
- which pharmacies to call, as E.164 numbers
- that they want calls placed now

Never infer a phone number. Never call a number the user did not supply or
approve.

## Safety boundaries

This skill gathers **availability and pricing information only**.

- It does not give medical advice, recommend a medication, or suggest a
  substitute. If a pharmacist offers an alternative, report it verbatim as
  something the pharmacist said — never as a recommendation.
- It does not place an order, reserve stock, or commit to a purchase on the
  user's behalf.
- It is not for emergencies. If someone needs medication urgently, they should
  contact emergency services or an urgent care provider, not wait on an agent.
- Prescription requirements are reported, never worked around.
- Report the pharmacist's answer and the confidence score. Do not present a
  low-confidence result as fact — the user may travel somewhere while unwell on
  the strength of it.

## Workflow

### 1. Collect the request

Required: medication name, dosage, quantity, recipient region, and the list of
pharmacy phone numbers in E.164 format.

**Validate every number before anything else happens.** E.164 is a plus, a
non-zero country code digit, then 7–14 more digits — `^\+[1-9]\d{7,14}$`.
Reject anything else and ask the user; never guess a country code. A local
number silently reaching the planner is how the wrong person gets called.

### 2. Build the goal

CALL-E's MCP surface has no `result_schema` parameter, so the fields you want
must be named in the `goal` text. CALL-E honours them reliably and emits them in
`result.summary`.

```text
You are calling a pharmacy on behalf of a patient looking for a medication.
Identify yourself as an automated assistant immediately, and keep the call
brief and polite.

Find out whether they currently have {drug} {dosage} in stock. The patient
needs {quantity}.

Capture these fields in the structured result, using exactly these key names:
- in_stock: yes, no, partial, or unknown. Use partial if they have some but
  fewer than the patient needs.
- form_available: brand, generic, both, or unknown
- quantity_available: integer units they have
- unit_price: number, price per unit
- currency: three-letter currency code
- requires_prescription: yes, no, or unknown
- can_hold: yes, no, or unknown
- hold_duration_hours: number of hours they will hold it
- alternative_suggested: any alternative or other branch they mention
- pharmacist_notes: anything else useful, one short sentence

If they do not have it, still ask about alternatives or another branch. Do not
place an order or commit to anything on the patient's behalf. Thank them and
end the call. If nobody answers, report that the pharmacy could not be reached;
do not treat that as a successful stock check.
```

Identifying as an automated assistant in the first line is not optional. It is
the difference between a pharmacist answering and a pharmacist hanging up.

### 3. One run per pharmacy

`to_phones` accepts an array, but batching returns an **aggregated** summary for
the whole batch. This workflow needs per-pharmacy attribution — which pharmacy
has 10 units at £5 — so place one run per pharmacy and run them concurrently.
The call cost is identical.

### 4. Execute

```text
plan_call    → ready_to_run + confirm_token   (free, places no call)
run_call     → run_id                          (spends len(to_phones))
get_call_run → poll until terminal, following next_step.action
```

`plan_call` is free. Iterate on the goal text as much as you like before
spending anything.

### 5. Read the result — but only if the call actually completed

**Check `result.outcome.task_completed` and the run status first.** A call that
failed, went to voicemail or was cut off can still carry a partially filled
summary. Treating that as a stock check is how a patient gets sent somewhere on
the strength of a sentence nobody finished.

If the run did not reach `COMPLETED` with `task_completed: true`, report *"could
not be reached"* and emit **no stock fields at all**. Do not scrape what's there.

Only when the call completed, parse the extracted fields from `result.summary`
as `key=value` pairs — **not** from `result.extracted`, see
`references/calle-mcp-integration.md`. Values contain commas and the separator
is not stable (both `, ` and `; ` observed), so split on `key=` boundaries.

`result.outcome` also gives a confidence score and specific evidence strings.

### 6. Report

**Verification outranks stock status.** Rank verified results first — those that
completed with confidence at or above 0.6 — then by stock, then price, then
hold. A low-confidence "yes" must never outrank a high-confidence "no". Someone
may travel while unwell on the strength of this, which makes an unreliable
positive worse than a reliable negative.

Mark anything unverified as such, visibly.

Mask phone numbers in summaries — show the pharmacy name and the last four
digits.

Offer the transcript. Every claim should be checkable against what was said.

## Cost and safety controls

- **Count phones, not calls.** `to_phones` is an array, so one plan can spend N
  calls. Charge `len(to_phones)` against any budget before dialling.
- **Reserve atomically, under the same lock as the ledger read.** A
  check-then-write budget is not a ceiling: two processes read the same
  `spent`, both pass the check, and both dial. The up-front whole-batch check
  is a convenience so a batch fails before the first call rather than halfway;
  the per-call atomic reserve is what actually enforces the limit.
- **Deduplicate recipients before dispatch.** The same number listed twice is a
  data-entry mistake, not a request to ring someone twice — and rows are
  dispatched concurrently, so nothing downstream spaces them out. A file lock
  won't catch this: both rows run in one process and share a pid, so the
  in-flight set has to be tracked in-process as well.
- **Store credentials and transcripts owner-only (0600), and ignore them.** The
  ledger holds `confirm_token`s that authorise placing a call; run dumps hold a
  third party's recorded voice. Default umask leaves both readable by every
  account on the machine, and file permissions are no protection at all against
  being committed. Write them to a dedicated directory and add that directory to
  `.gitignore` — this skill ships one covering its own runtime state.
- **Bind the auth token to the endpoint you are calling, and refuse if you
  can't.** A bearer token is issued for one origin; sending it elsewhere hands
  a working credential to a party it was never meant for. That's a disclosure,
  not a routing mistake.

  Ask the CLI which endpoint it authenticated against (`calle auth status`
  reports `server_url` and `cache_path`) rather than inferring it from the
  cache directory hash. Refuse on mismatch.

  **A single cache with no endpoint recorded is not acceptable either.** "Only
  one exists" is not evidence that it belongs to this provider. If nothing
  binds the credential, stop and make the operator name it explicitly.

- **Keep the exclusion claim separate from the reconciliation identity.** These
  are two different questions and they need different granularity.

  *"Is there an unresolved call to this person about this thing?"* must be
  answered on **recipient and purpose alone**. Fold endpoint, account or region
  into that key and changing any of them makes a live call look absent — which
  permits a second dial to someone already being rung.

  *"Can I resume this particular plan?"* needs the full configuration. So nest
  it: a coarse claim keyed on `sha256(phone|goal)`, with the attempt's endpoint,
  principal, region, `plan_id` and `run_id` recorded underneath.

  On a configuration mismatch, do **neither**. Don't resume — a `plan_id` from
  one endpoint or account is meaningless under another. Don't redial — the
  earlier call may still be live. Surface it and let a human resolve it.

- **Bind unfinished state to a stable principal, or fail closed.** Don't
  namespace on the credential cache directory: CALL-E derives that from the
  server URL, so re-authenticating as a different account on the same endpoint
  reuses it — and an account-A run could be resumed with account-B credentials.

  Derive the principal from the account itself (an id recorded in the cache, or
  the `sub` claim of a JWT). If it can't be established, new calls may proceed,
  but an unresolved call can no longer be confirmed as yours — so refuse to
  reconcile it rather than guessing. `CALLE_ACCOUNT_ID` overrides.

  Version the ledger. When claim keys change, old entries won't match anything
  you compute, so unfinished ones must be refused rather than read as absent.
- **Persist `plan_id` and `run_id` to disk as soon as you receive them.**
  `plan_id` is CALL-E's idempotency key, but it only protects you if it survives
  a crash. On restart, resume the stored run instead of re-planning.

  The ledger is the thing standing between a crash and a second call to a real
  person, so it has to be written like one:

  - **Lock it.** Read-modify-write under an exclusive file lock. Without it,
    two processes both see "no entry" and both dial.
  - **Write atomically.** Temp file, fsync, then rename. A partial write must
    never replace a good ledger.
  - **Fail loudly on corruption.** An unreadable ledger means quarantine it and
    stop. Substituting an empty one presents every in-flight run as new and
    redials the lot.
  - **Record the terminal result before retiring the entry.** Clearing first
    opens a window where a crash loses both the result and the claim.
  - **Treat an ambiguous create as un-retryable.** If `run_call` was sent and
    the response was lost, whether the phone rang is unknown. Mark that state
    before the call, and require a human decision to clear it — never retry
    automatically.
- **Never re-dial to recover data you already paid for.**
- **No recurring schedules.** This is a one-shot workflow. If a user wants
  repeat checks, create them explicitly and tell the user how to cancel.

## Dry run

`scripts/pharmacy_search.py` is dry-run by default, and the dry run is **fully
offline**: it reads no credentials, opens no socket, and sends nothing anywhere.
It validates every number and prints the exact payload it would send.

That matters here. A dry run that still transmits the recipient's phone number
and the medication being sought — by calling the planning endpoint — is not a
dry run. In a medical-adjacent workflow it leaks who is looking for what.

Numbers are masked in the printed payload too. Masking covers anything printed
or logged, not just what reaches the user: terminal output ends up in
scrollback, CI logs and screen recordings.

```bash
python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv        # offline
python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv --live # calls
```

## Verifying end to end without a real pharmacy

CALL-E publishes an inbound testing hotline — **+1 276-322-9632** — that answers
with a general-purpose conversational prompt. It's the recommended target for
exercising this skill live without calling a business.

```bash
printf 'name,phone,address\nCALL-E Hotline,+12763229632,Inbound testing hotline\n' \
  > pharmacies.hotline.csv

python3 scripts/pharmacy_search.py --pharmacies pharmacies.hotline.csv           # offline
python3 scripts/pharmacy_search.py --pharmacies pharmacies.hotline.csv --live    # 1 call
```

The hotline isn't role-playing a pharmacist, so the extracted fields will be
sparse or `unknown`. That's the expected result and it's still a useful check —
it exercises plan, run, poll, the completion gate and the ledger, and confirms
an incomplete stock check reports as one rather than inventing fields.

**To verify the durable-run behaviour**, interrupt a live call mid-poll
(`Ctrl+C`) and run the same command again:

```
  …9632: resuming run 4BJPgjIFv3gZ
```

It polls the existing run instead of planning a new one. Inspect
`.pharmacy_runs.json` between the two invocations to see the entry sitting in
`running` with its `run_id` recorded.

This number is published by CALL-E for testing, so it is not masked here — the
masking rule protects private numbers, not a public test endpoint.

## Example

Request: amoxicillin 500mg, 21 capsules, three pharmacies in GB.

Result from one pharmacy:

```json
{
  "pharmacy": "Test Pharmacy (…0100)",
  "in_stock": "partial",
  "quantity_available": 10,
  "unit_price": 5.0,
  "currency": "GBP",
  "requires_prescription": "yes",
  "can_hold": "yes",
  "hold_duration_hours": 48,
  "pharmacist_notes": "They have only 10 units available, less than the requested 21 capsules.",
  "confidence": 0.82
}
```

Worth noting what CALL-E got right there: the pharmacist said "10 units" against
a request for 21, and the result is `partial` rather than `yes`. It also
converted "just two days" into `hold_duration_hours: 48`.

## Known limitations

Stated rather than discovered, because each one is a boundary on a guarantee
this skill otherwise makes.

**The exclusion lock is single-host.** It uses `flock` on a sidecar file, which
coordinates processes on one machine. It does not coordinate across machines,
and its behaviour on NFS and some network filesystems is unreliable. Two
operators running this against a shared drive get no mutual exclusion, and the
duplicate-dial protection is only as good as the lock. A multi-host deployment
needs a real lease — a database row, or a lock service.

**Principal resolution currently returns nothing on CALL-E, so resume needs
`CALLE_ACCOUNT_ID`.** Identity is looked for in an id recorded alongside the
credential, then in the `sub` claim of a JWT. As of writing, the CALL-E CLI
cache records `server_url`, `auth_base_url`, `issued_at`, `expires_at` and
`token` — no account identifier — and the token is opaque rather than a JWT.

So no principal can be established, and unfinished state fails closed rather
than risk resuming one account's run under another's credentials. That is the
safe behaviour, but it means **cross-process resume does not work out of the box**:

```bash
export CALLE_ACCOUNT_ID=me@example.com    # any stable value you control
```

Any consistent string works — it only has to change when the authenticated
account changes. Endpoint binding is unaffected: `server_url` *is* recorded, so
credentials are still bound to the right origin automatically.

This resolves itself if the provider exposes an account identifier in the
credential cache or issues a token with a subject claim.

**Verification is manual, not automated.** There is a runnable end-to-end path
(see the testing hotline above) and the dry run is fully offline, but there is
no committed test suite. The concurrency, crash and credential behaviours were
verified with throwaway scripts rather than tests a reviewer can re-run.

**The budget ceiling is local.** It counts what this installation has spent. It
does not know the provider-side balance, so it protects against a runaway loop,
not against a quota consumed elsewhere.

## References

Read `references/calle-mcp-integration.md` for MCP surface behaviour, including
where extraction actually lands.

Read `references/safety.md` for boundaries on medical-adjacent phone workflows.

See `references/examples.md` for worked conversations, including when to decline
to call.
