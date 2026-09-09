# Nominee — consent-bound Verification of Employment

**Nominee verifies someone's employment by phone: calling only employers the applicant consented to, never the phone number the applicant supplied, and returning a typed answer instead of a voicemail.**

A workflow plugin for Airtable, built on the CALL-E Developer API. Submitted to the **Workflow Plugins** contribution area for *CALL-E: Your Code Is Calling*, targeting **Most Practical Use Case**.

```bash
./run.sh
```

That is the whole setup. It opens the panel in your browser on **sample data**,
so the first thing you see is the product working — no account, no API key, no
environment variables, no install. Connect your own Airtable from the Setup
screen when you are ready; you never return to a terminal.

Python 3.11+, **standard library only**. No install, no build step, no lockfile.

---

## The problem

Every mortgage, most tenancy applications, much consumer lending and a large share of hiring require **Verification of Employment** — an independent confirmation that the employer, the job title and the dates on an application are real.

For large employers there is a database. Equifax's [The Work Number](https://theworknumber.com/) holds **823 million employee records from roughly 5 million employers**, and answers in seconds.

For everyone else there is a phone call. Coverage gaps are concentrated in small and mid-size businesses — [as the industry puts it](https://www.goodhire.com/resources/articles/the-work-number/), if an applicant works for a business with ten employees there is a good chance that employer is not in the database. And when the database misses:

> Someone contacts the employer by phone, fax, or email. **That process takes days or weeks and often fails entirely when the employer does not respond.**

That fallback is a paid product: Equifax sells [manual verification](https://developer.equifax.com/products/apiproducts/verification-employment-and-income) as a waterfall for exactly this case. Its implementation is a human on hold.

**And that is the United States, the one market with a large payroll database.** In the EU, UK, Canada, Australia, India, Southeast Asia and Latin America there is no equivalent, so verification is manual everywhere by default.

Global employment screening was **USD 5.3–8.0 billion in 2026**, heading to roughly **USD 13.7 billion by 2034**, with employment verification as a core segment ([Fortune Business Insights](https://www.fortunebusinessinsights.com/employment-screening-services-market-115476)).

### And the number on the form cannot be trusted

Half of mortgage fraud findings involve potentially fraudulent income or employment. Fake employers are not crude: investigators describe them as having *"legitimate phone numbers and automated call centers... legitimate addresses and call attendants... information on file with the Yellow Pages"* ([The Work Number](https://theworknumber.com/all-blogs/-/post/fakes-frauds-and-phonies-fraudulent-income-and-employment-data-in-mortgage-loan-applications-are-bad-for-the-industry-brokers-lenders-and-borrowers)). [Fannie Mae's red flags](https://singlefamily.fanniemae.com/mortgage-fraud-prevention) include "employer unable to be contacted", and guidance is to check the employer's name, address and phone **using multiple data sources** rather than a single search.

The employer phone number on an application is the one field a fraudulent applicant fully controls. The manual process calls it anyway.

**What is sourced and what is not.** The market figures, the coverage gap, the "days or weeks" description and the fraud characterisation are all cited above. Per-application call volumes and cost-per-verification are **not** published anywhere we could find, so this README makes no claim about them.

---

## Why CALL-E rather than a scripted dialer

- **An employer's verification line is a phone tree.** CALL-E navigates IVR with DTMF tones. A scripted dialer dies at the menu, which is the most common reason manual VOE fails.
- **The first person who answers is never the right one.** The call has to ask to be transferred and keep going.
- **Answers are hedged.** *"He left last month."* *"I can confirm she works here but not the salary."* That has to land in a typed field with an honest `unknown`.
- **Verification is multilingual outside the US**, and CALL-E covers 42 countries.
- **Latency is the whole problem**, and it comes from humans queueing calls one at a time.

---

## The two boundaries

Both are enforced by construction, not by policy a caller can forget.

### 1. Consent is not a checkbox

Ticking one cell and dragging it down a column is the most ordinary gesture in a spreadsheet, and it would authorise every row it touched. So consent is a token derived from the row's own content:

```
token = sha256(request_id | phone | relationship | task_spec_version | consent_receipt_id)
```

`authorize()` recomputes it from the row in front of it. A token copied from another row was derived from a different number and is refused. Editing the questions bumps `task_spec_version`, which invalidates every token gathered under the previous wording — **consent is revoked by construction when the purpose changes.**

Three regulators require this, in their own words:

| | |
|---|---|
| **US** | FCRA — a consumer report requires a permissible purpose; for employment purposes, written consent and disclosure |
| **EU/UK** | GDPR — contacting a third party about a data subject needs a lawful basis and purpose limitation |
| **India** | [RBI Guidelines on Digital Lending](https://rbidocs.rbi.org.in/rdocs/notification/PDFs/GUIDELINESDIGITALLENDINGD5C35A71D8124A0E92AEB940A7D25BB3.PDF) (2 Sep 2022) — data collection must be *"need-based and with prior and explicit consent of the borrower having audit trail"* |

### 2. The number on the application is never dialed

The dialer's only parameter type is a `ConsentedEmployerContact`, which carries a `SourcedNumber` — a number tagged with independent provenance. The number written on the application is an `ApplicantSuppliedNumber`, a separate type with **no conversion path**. `NumberSource` has no `application` member.

If no independent source exists, the request fails closed as **employer unverifiable** — itself a Fannie Mae red flag, not an error.

> A payroll database cannot detect a fake employer, because a fake employer is by construction not in it. The manual process calls the number on the form. Nominee structurally cannot. **This is a control neither existing method performs.**

Tests: `tests/test_boundaries.py` asserts direct construction fails, that no function anywhere accepts an `ApplicantSuppliedNumber`, and that filling a consent token down a column is refused.

---

## The idea that makes it usable

**Nobody writes JSON Schema. They create columns.**

A single select's choices *are* an enum, its description *is* the extraction instruction, and its name *is* the field. So `recipient_result_schema` is read off the table rather than written:

```
single select "Employment confirmed" (Yes | No)
  description: "Use yes only when the employer states the person currently works there."

  →  { "type": "string",
       "enum": ["yes", "no", "unknown"],
       "description": "Use yes only when the employer states..." }
```

Two rules come from [CALL-E's own documentation](https://docs.heycall-e.com/) rather than taste:

- It asks for string enums with an `unknown` value wherever an answer may be unclear, so `unknown` is always appended and an Airtable checkbox becomes `yes/no/unknown` rather than a boolean.
- It reserves `summary`, `status`, `transcript`, `call_id` and timing fields on the recipient result, so a colliding column is refused with the rename spelled out instead of being silently dropped server-side.

Add a question by adding a column. `tests/test_airtable.py` asserts that.

---

## Correctness

**The contact gate.** CALL-E issue **#341** reports the API returning `task_completed: true` when voice-agent setup fails before dialing. For a verification product that means *employment confirmed with no conversation*. Nothing reaches a positive disposition without `reached_employer: yes`, extracted from the call. A table whose columns cannot express it is rejected outright.

**A refusal is terminal.** `declined_to_answer: yes` is a complete answer with `retryable=False`. An HR department declining to confirm has not failed; redialling them is harassment.

**Fails closed, always.** Low confidence, a positive claim with no supporting evidence string, or any internal contradiction all route to human review. `tests/test_calle.py` asserts **no rule can promote a result** — every gate can only move a disposition toward review.

**Hash-chained audit log.** Editing a record, deleting one from the middle, or reordering all break the chain, and `verify_chain()` names the sequence number. Records are fsynced before the call they authorise is dispatched: a record with no call is recoverable, a call with no record is not.

---

## Limits, stated plainly

- **The audit chain cannot detect tail truncation.** Removing records from the end leaves a shorter but internally valid chain. `head()` returns the value to anchor externally; this plugin does not anchor it for you. A test asserts this is a limit rather than pretending otherwise.
- **An attacker with write access and the code can rebuild the log.** The chain makes tampering evident to someone holding an earlier head, not impossible.
- **One writing process per log.** Appends are serialised in-process; two processes would interleave and break the chain.
- **CALL-E has no cancel-in-flight operation.** `POST /v1/calls`, `GET /v1/calls/{id}` and `GET /v1/calls/{id}/events` are the whole surface. Cancelling a request guarantees **nothing further is dispatched**; a call already dialing runs to completion.
- **Spend is estimated, not authoritative.** CALL-E exposes no balance endpoint (issue **#183**), so caps are enforced locally against a published $0.05 per call.
- **Airtable free plan: 1,000 API calls per workspace per month**, 5 requests/second. This plugin uses the Web API rather than an extension or scripted automation precisely so it runs on free, where neither is available.
- **Number provenance is asserted by the operator**, recorded in a `Number source` column and carried into the call metadata. Nominee does not itself source numbers.

---

## Setup

### 1. Start it

```bash
./run.sh
```

Opens on **sample data**: three employers called, one contradiction routed to
review, one employer never reached, one request skipped for having no
independently sourced number. Everything is real except the phone calls.

### 2. Connect your own base

Import `examples/base-template.json` into a new Airtable base, then open
**Setup** in the panel and paste:

| | |
|---|---|
| Airtable token | needs `schema.bases:read` plus record read/write — [create one](https://airtable.com/create/tokens) |
| Airtable base ID | the `app…` segment of your base URL |
| CALL-E API key | only to place calls — [dashboard](https://dashboard.heycall-e.com/account/api-keys) |
| Your organisation | spoken on every call; an unnamed caller asking about an employee is pretexting |

Saved to a local `.env` created **mode 0600**, never written to your base,
never logged, and never returned by any endpoint. The panel only ever shows
the last four characters, so you can tell one key from another without either
being readable. Environment variables still win if you would rather inject
them, and the panel warns if the file's permissions are loose.

With an Airtable token but no CALL-E key it runs **preview only** — reading
your real table, unable to dial.

### 3. Work

The panel shows the rows in scope, the rows being skipped and why, how many
the view's filter is hiding, the estimated spend, and **the verbatim script
that will be spoken**. Then Run, with a confirmation naming the count. Results
land back in your Airtable base, which updates live as they arrive.

Three properties are worth stating, because two PRs in this repository were
blocked for the opposite:

- It binds **loopback only** and refuses any other address.
- Every API request needs a one-off token; the page itself carries no secret.
- **The run endpoint accepts no destination.** It takes a view name and a
  confirmation, and rejects any other field. Numbers come from consented rows
  the server reads itself, so there is no request shape that can introduce a
  phone number. `tests/test_panel.py` asserts that for `phone`, `phones`,
  `to`, `recipients`, `number` and `e164`.

### For scripting and CI

```bash
python3 -m nominee replay      # whole pipeline on fixtures, no credentials
python3 -m nominee preview     # your table; writes nothing, dials nothing
python3 -m nominee run --confirm-consent
python3 -m nominee verify      # walk the audit chain
```

---

## Plugin contract

| | |
|---|---|
| **Platform** | Airtable (Web API v0). Works on the free plan. |
| **Trigger** | An operator pressing Run in the panel (or the `run` command) against a named view. No automatic or scheduled trigger; nothing dials without a person. |
| **Required inputs** | Request ID, applicant name and reference, employer, an independently sourced E.164 number with its source, a consent receipt (id, disclosure version, signed-at) and its derived token |
| **Outputs** | A disposition and reason per row, the call id, and one answer column per derived schema field |
| **Credentials** | Entered in the panel's Setup or supplied as environment variables, stored in a local `.env` created mode 0600. Never written to the table, never logged, never returned by an endpoint. Each is restricted to a single origin: `api.airtable.com` and `api.heycall-e.com`. |
| **Side effects** | `run` places real outbound phone calls to real employers, billed by CALL-E, and writes results back into the base. `preview` and `replay` place none. |
| **Cancellation** | Tick `Cancelled` on a request; nothing further is dispatched for it. In-flight calls cannot be stopped — see Limits. |
| **Rollback** | Dispositions are overwritten by a later run; the audit log is append-only by design and is not rolled back. |
| **Recurrence** | None. This plugin has no scheduler and creates no recurring job. |
| **Tests** | `python3 -m unittest discover -s tests -t .` — 184 tests, no credentials, no outbound network, no call placed. The panel tests bind a loopback socket. |

---

## Safety

Every call discloses that it is automated, on whose behalf, and that the applicant consented, before anything is asked. Eight prohibitions are stored as data and asserted present in the rendered text: never salary or any financial detail, never an opinion about the person, never a question outside employment status and title and dates, never argue after a refusal, never offer expedited handling, never leave the applicant's name on a voicemail or with someone who will not identify their role, never imply an obligation to answer, never give advice.

Phone numbers are masked to the last four digits everywhere — table, console, logs and audit records. Consent tokens are stored in the audit log as a short prefix: enough to correlate, not enough to replay.

All example numbers are in the `+1 555 01xx` range reserved for fiction. No real call transcripts, recordings or screenshots are included.

## What it is not

- Not a collections tool. It never calls anyone about money owed.
- Not a credit decision engine. It returns evidence; a human underwrites.
- Not a background check. It cannot reach anyone the applicant did not consent to.
- Not a salary lookup. It is prohibited from asking, and tested for it.
- Not a replacement for a payroll database. It is the waterfall — the case the database cannot answer.

## Licence

MIT, as the repository.
