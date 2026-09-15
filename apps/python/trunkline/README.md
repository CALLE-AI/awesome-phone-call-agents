# Trunkline

**An insurer can deny a claim in seconds. Challenging it takes a person 25 minutes on hold. Trunkline is the agent that holds instead, and comes back with an answer that has the representative's own words attached to it.**

Trunkline is a Python app on the CALL-E Developer API for the phone work behind a medical practice's unpaid claims. It calls the health plan's provider-services line, works through the phone menu, waits in the queue, talks to the representative, and returns a schema-checked, evidence-bound answer a biller can act on: claim status, denial reason, prior authorization status, or eligibility.

It gathers and structures. It never files an appeal, never agrees to anything, and never closes a claim without a person approving it.

```text
claims ──► bundle by payer ──► may we call? ──► CALL-E call ──► what did they actually say?
              │                     │                                    │
      up to N per call        thirteen named holds            schema check, then: is the
      one hold, not N                                         quote really in the transcript?
                                                                         │
                                          grounded ──► answered ──► human approves ──► export
                                                                         │
                                       not grounded ──► fields reset to unknown ──► human review
```

## Why this is not "call them and ask"

| Problem with chasing a claim by phone | What Trunkline does about it |
| --- | --- |
| A biller spends 25 minutes on hold per claim inquiry, so most denials are never worked at all. | The agent holds. In the shipped demo call it waits **23m 40s across two queues** and talks for **4m 25s**. The hold is measured, not estimated. |
| Every call re-solves the same phone menu. | The menu path that reached a person is stored on the payer record and given to the next call as a starting point. |
| One call, one claim. | Up to the payer's own cap of claims go on a single call. The demo backlog of 10 claims becomes 7 calls, and the expensive part, reaching a representative, is paid once instead of ten times. |
| An assistant reports a denial code that nobody said. | Every answer carries the representative's words. Trunkline checks that quote against the transcript; a quote it cannot find resets that claim's fields to `unknown` and routes it to a person. |
| A claim quietly ages past its timely-filing deadline while lower-value work goes first. | Priority is claim value multiplied by closeness to the deadline, and a claim inside 14 days preempts everything. Past the deadline it is suppressed: a call can no longer change the outcome. |
| Patient identifiers end up scattered through logs and transcripts. | Identifiers live in a separate vault. The ledger holds an opaque `patient_ref`. Each workflow may disclose only the fields its envelope names, and the transcript is scrubbed before it is written. `trunkline vault-check` proves it. |
| Nobody notices a $200 claim cost $12 of phone time to chase. | A per-call cost cap refuses a bundle whose total value cannot justify the call. |

## Quick start: no calls, no API key

```bash
cd apps/python/trunkline

python3 -m trunkline --data ./data init-demo        # fictional practice, payers, patients, claims
python3 -m trunkline --data ./data status           # the queue, the bundles, and every hold that applies
python3 -m trunkline --data ./data plan --force     # the exact task text CALL-E would receive
python3 -m trunkline --data ./data run --mode fixture --workflow claim_status --force
python3 -m trunkline --data ./data vault-check      # no identifier escaped the vault
python3 -m trunkline --data ./data audit --verify   # the audit chain is intact
python3 -m trunkline --data ./data console          # http://127.0.0.1:8770, loopback only

python3 -m pytest                                   # 102 tests, all offline
```

Python 3.9 or newer, standard library only. `pytest` is the only development dependency.

`--force` ignores the calling-window hold so a fixture demo runs outside business hours. It exists for `preview` and `fixture`; live mode refuses it.

### What a run looks like

Every bundle in the demo has a recording of its own, so any workflow runs. This is the
Meridian claim-status bundle, the one that holds twice:

```bash
python3 -m trunkline --data ./data run --mode fixture \
    --workflow claim_status --payer pay_meridian --force
```

```text
Meridian Health Plan - claim_status - 3 claim(s) - +12*******42
  outcome:   answered
  Hold: 23m 40s of 28m 05s on the call - 2 separate holds (19m 40s, 4m 00s)
  talking:   4m 25s of a 28m 05s call
  reference: MHP-REF-88417203   representative: Marcus
  CLM-2026-004417  claim_status  [grounded]  -> answered
      claim_status             paid
      paid_amount              142.60
      allowed_amount           178.25
      check_number             EFT-5590183
      evidence: "that one processed and paid on August twenty first, one hundred
                 forty two dollars and sixty cents, allowed was one seventy eight
                 twenty five"
```

### Fixture scenarios

Fixture mode runs the real client against a local fake of the CALL-E Calls API (`trunkline/client.py`, `FakeCalleServer`). The parsing, polling, idempotency, verification, and scrubbing paths are the same ones live mode uses; only the transport is local. Every path has a scenario:

| Scenario | What comes back | What Trunkline does |
| --- | --- | --- |
| `claim_status_paid` | Three claims: paid, denied, still in process, after a transfer into a second queue | All three answered; 23m 40s of hold recorded across two segments |
| `cascade_claim_status` | Two Cascade claims on one call: one paid with an EFT trace, one denied | Both answered after a single 11m 44s hold |
| `claim_status_in_process` | A claim still sitting in medical review, nothing owed by the office | Answered as `in_process` after a 3m 11s hold |
| `denial_reason_co97` | CO-97 with remark N130, appealable, with a deadline and an address | Denial reason recorded with the appeal route |
| `cascade_denial_reason` | CO-16 with remark M51, where a corrected claim is accepted instead of an appeal | Denial recorded with resubmission as the next action, not appeal |
| `prior_auth_pending` | Authorization pending, clinical history missing | Answered as pending, with what the plan is waiting for |
| `eligibility_active` | Coverage active, deductible and cost sharing given | Benefits recorded for the date of service |
| `not_on_file` | The plan has no record of the claim | Recorded as `not_on_file`, which means resubmit, not appeal |
| `rep_refused` | Representative wants the full tax identification number | Ends without claim detail and records what the office must supply |
| `hold_timeout` | Nobody answered inside the hold limit | `hold_timeout`; nothing recorded, claims stay queued |
| `ivr_dead_end` | The menu sends the caller to the portal and hangs up | `ivr_dead_end`; nothing recorded |
| `unreached_busy` | CALL-E reports the call as failed | `unreached`; nothing recorded |
| **`ungrounded_evidence`** | A denial answer whose quote was never spoken on the call | **The guard fires:** that claim's fields reset to `unknown` and it goes to review. The two honest answers on the same call are kept |
| **`schema_violation`** | An extra field and a status outside the enum | **The guard fires:** the whole result is refused and every claim on the call goes to review |

The last two are the point. They are adversarial fixtures whose only job is to make the guardrails fail in a test rather than in a billing office.

## The patient-identifier boundary

A provider calling a health plan about a claim is a payment disclosure, which HIPAA permits without patient authorization, but only the minimum necessary for that purpose. Trunkline treats that as an architectural constraint rather than a policy document.

* **The ledger holds no identifiers.** A claim carries a `patient_ref`. Names, member ids, and dates of birth live in `data/vault/`, one owner-readable file per reference.
* **Each workflow declares an envelope.** `policy.DISCLOSURE_ENVELOPES` names the only fields that workflow may speak aloud. Claim status discloses member id, date of birth, and last name. Eligibility discloses member id and date of birth and nothing else, because a name is not needed to verify coverage. Widening that is a reviewed code change, not a prompt edit.
* **Some fields are never disclosed.** `policy.NEVER_DISCLOSE` covers Social Security fragments, medical record numbers, addresses, and contact details. The resolver drops them even if an envelope names one by mistake, and the planner refuses to return a task whose text contains one.
* **Transcripts are scrubbed before they are stored.** The verifier needs the real transcript to confirm a quote was spoken, so scrubbing happens between verification and persistence. The matcher handles a member id read back digit by digit as `W 8 8 4 2 1 3 0 9 7` and a date of birth written as `March 11, 1984` or `03/11/1984`.
* **The claim number survives.** Short identifiers are matched exactly rather than loosely, so a four-digit fragment does not redact the tail of `CLM-2026-004417`. A redactor that destroys the answer is not a safe redactor.

Two commands make this checkable rather than claimed:

```bash
python3 -m trunkline --data ./data vault-check   # walks every file outside the vault
python3 -m trunkline --data ./data audit --verify
```

`vault-check` reads every identifier in the vault and searches everything Trunkline wrote for it. The test suite runs the same check after a call whose transcript contained the member id out loud.

The audit log records which fields were disclosed, by name. It never records their values.

## What the agent is told, and what it may never do

`trunkline/plan.py` builds the task from the practice's identifiers, the payer record, the claims in the bundle, and one narrowed disclosure per patient. Every task ends with the boundaries in `trunkline/policy.py`:

- it opens by saying it is an AI assistant calling for the provider's billing office, and says so again whenever asked;
- it states that the call may be recorded before asking anything;
- it never files, withdraws, or escalates an appeal, reconsideration, grievance, or peer-to-peer review, and does not accept an offer to start one;
- it never accepts, waives, or disputes an amount, adjustment, refund, offset, or recoupment;
- it never agrees to a corrected claim, a resubmission, or any change to a claim;
- it never gives a Social Security number, a full address, a medical record number, a card, or a password, and ends the call if one is demanded;
- it never discusses clinical care, and never argues that a claim is owed;
- it does not guess: a value not clearly stated is reported as `unknown`;
- it asks for a call reference number and the representative's first name before ending.

Twelve states require all-party consent to record a call. Rather than tracking which state each line sits in, Trunkline discloses recording on every call. Health plans already announce recording on their own provider lines, so the disclosure is symmetric.

## Verification

The result schema is closed and every field is required, and Trunkline does not rely on CALL-E to enforce that. `trunkline/verify.py` validates the returned object locally: no extra fields, every field present, correct type, and enum values inside the enum. A failure marks the call `unusable` and sends every claim on it to review.

Groundedness is the second, independent check. Each claim entry carries `evidence_quote`, the representative's own words. The quote is searched for in the transcript after normalization, with a fallback that tolerates a dropped filler word. A quote shorter than six words is refused however well it matches, because a single common word is a coincidence, not evidence. When a quote cannot be found, that claim's substantive fields become `unknown` and it goes to a person. The other claims on the same call keep their answers.

Completeness is status-aware. A denied claim has no allowed amount and a pending authorization has no authorization number; reporting those as `unknown` is the correct answer, not a half answer. A claim reported as `paid` without a paid amount is not.

## Hold accounting

CALL-E timestamps every transcript turn, and nobody speaks while hold music plays, so hold falls out of the transcript with no extra instrumentation: a gap of 45 seconds or more between consecutive turns is hold. Every such gap is summed, not just the first, because a transfer drops the call into a second queue and a real payer call often holds twice.

That single number drives the hold budget, the receipt on every call record, and the `impact` report, which reports staff minutes measured from the calls in the ledger against the CAQH Index baseline of 25 staff minutes for a phone claim-status inquiry. The report deliberately stops at staff time. It does not claim recovered revenue, because whether a claim is appealed and whether the appeal wins are human decisions Trunkline never makes.

Cost per call is an operator input, not a discovered value: CALL-E's integration documentation does not publish a per-minute rate, and whether hold bills at the talk rate is unverified. `hold.CostModel` holds the estimate and every figure derived from it is labelled an estimate.

## Live mode

1. Create a CALL-E account and put the key in `.env` (copy `.env.example`). The key is read only in live mode and is sent only to `https://api.heycall-e.com`; any other origin is refused, so a redirected base URL cannot exfiltrate it.
2. Point a payer record at a real provider-services number. It must be full E.164 and match the payer's region, and NANP validation refuses premium-rate area codes.
3. Authorize that exact destination:

```bash
python3 -m trunkline --data ./data authorize \
  --payer pay_meridian --phone +12125550142 \
  --until 2026-10-31 --max-calls 6 --note "denial backlog, September"
```

4. Run it: `python3 -m trunkline --data ./data run --mode live --yes`

A live run refuses without that record, after it expires, once its call budget is spent, or if the payer's number no longer matches the authorized destination character for character. `--force` is refused in live mode. Revoke with `trunkline revoke --payer <id>`, or engage `trunkline kill-switch on` to refuse every call at once.

Before the request leaves the machine the claims are marked `pending_call` and written to disk with a fresh idempotency key. If submission fails before Trunkline receives a usable call id, the call becomes `submission_unknown` and its claims move to `pending_reconciliation`; they are never returned to the queue automatically. The live batch stops, and every later live call is refused until an operator reconciles the record. Attach an id found in the CALL-E dashboard with `trunkline reconcile --call <local_id> --provider-call-id <CALL-E_id>`, or use `--clear` only after confirming that no call exists.

**Side effects.** One outbound phone call per bundle, to the payer number on the payer record, disclosed at the open as an AI assistant calling for a provider billing office. Nothing else: no appeals, no resubmissions, no writes to any practice system, no email.

## Scheduling and cancellation

Trunkline has no scheduler of its own. Run one cycle from a host scheduler and let the suppression reasons decide whether a call actually happens; the schedule carries no approval, only a pointer to the authorization record a person wrote. See [`docs/scheduler.md`](docs/scheduler.md).

To stop: delete the authorization record, engage the kill switch, or remove the scheduler entry. A call already accepted by CALL-E completes and is folded in by `reconcile`.

## Human approval and the console

Nothing leaves Trunkline on its own. An answered claim sits in `answered` until a person approves it, in the console or with `trunkline approve <claim_id>`. Only then is it `closed` and exportable. The export carries claim numbers and plan answers and no patient identifiers.

`trunkline console` serves a review console on `http://127.0.0.1:8770` with four views:

| View | What it is for |
| --- | --- |
| **Overview** | The operating summary: urgent review work, groundedness, pending reconciliation, hold time returned to staff, recent calls, and live counts through the claim path |
| **Claims** | Every claim, highest priority first, with searchable action, exception, and closed views |
| **Call history** | Every call with its measured hold receipt, cost estimate, reference number, findings, and scrubbed transcript |
| **Review** | A focused split view with the queue on the left and extracted fields, supporting evidence, and the human approval action on the right |

The console is local by default. It has no authentication, so it refuses to bind anything but loopback, rejects a request whose `Host` is not loopback, requires a header on writes that a cross-site form post cannot set, and cannot place a live call. `TRUNKLINE_PUBLIC_DEMO=1` is a separate synthetic mode: it ignores the configured ledger, creates a fresh temporary copy of the committed fictional records, disables claim intake, and removes the copy when the server stops. It can never publish an operator's ledger. The page is a shell: every value a reader sees is fetched as JSON and written into the document as text rather than as markup, so a sentence spoken on a phone call can never become part of the page.

## Layout

```text
trunkline/policy.py      disclosure envelopes, agent boundaries, destination and window rules
trunkline/vault.py       the identifier store and the only way out of it
trunkline/redact.py      the scrubber applied before anything is written
trunkline/workflows.py   four workflows, their closed schemas, and what completeness means
trunkline/plan.py        task text, plus the pre-flight check that refuses a leaky task
trunkline/client.py      CALL-E Calls API client (urllib) and FakeCalleServer
trunkline/verify.py      local schema validation and the groundedness check
trunkline/hold.py        hold derivation from transcript offsets, and the cost governor
trunkline/workqueue.py   bundling, priority, the deadline guardrail
trunkline/engine.py      one call end to end, and reconciliation
trunkline/audit.py       hash-chained, append-only audit log
trunkline/console.py     local review console and isolated synthetic public demo
trunkline/ui.py          the operations workspace, stylesheet, and browser client
fixtures/                fourteen terminal call fixtures, two of them adversarial
tests/                   102 tests, offline, no credentials
docs/safety.md, docs/scheduler.md, docs/architecture.md
```

## Limitations

- **Cost per call is an assumption.** See "Hold accounting". Nothing in the repository claims a verified rate.
- **The hold limit is instruction-following, not a hard stop.** CALL-E exposes no `max_hold_seconds` parameter, so the limit is stated in the task and the agent is asked to honour it. The wall-clock poll deadline in `client.wait` is the outer bound.
- **A date of birth spelled out in words** ("March eleventh nineteen eighty four") is not caught by the scrubber, which handles digit and written forms. Speech transcripts normally return digits.
- **The redactor is a matcher, not a classifier.** It removes the identifiers it was given plus Social Security and email patterns. It does not detect an identifier that is in neither the vault nor those patterns.
- **Callbacks are out of reach.** Payers often offer to call back rather than hold. CALL-E is outbound-only, so Trunkline declines and stays in the queue.
- **Region validation covers the United States, Canada, and Australia** with explicit country-code and length rules. NANP destinations also receive prefix validation. This is not a full numbering-plan library; add any other region to `policy.REGIONS` deliberately before dialling it.
- **One recipient per call task.** Conference and three-way calls are out of scope.
- **The learned menu path is a hint, not a map.** A payer that changes its phone tree makes the stored path stale; the agent is told to adapt, and nothing depends on the path being right.
