# Phone Approval Gate

Automation that can do something irreversible needs a way to ask a person, and
the person is usually not at a keyboard. This app puts one phone call in the
path. It rings the change owner, reads the change out, asks for a decision, and
reports approval only when a live person reads back a one-time code that was
printed on the request. The caller gets an exit code and the run leaves an
approval record that can be checked later.

Three entry points, one core: a CLI, a GitHub Action and an exit-code contract
any script or agent can gate on.

## The problem

A pipeline stops in front of something it should not do alone: a production
deploy, a database restore, a refund batch, a migration an agent proposed at
02:00. The owner is asleep, in a car or nowhere near a laptop. Two things then
go wrong in practice. The change waits hours for someone to open a laptop, or
someone taps approve on a phone screen without reading what they approved.

A phone call fixes the first problem. It reaches a person in about thirty seconds
with nothing to install. It does not fix the second one by itself, which is why
this gate never accepts a bare yes.

## Why a phone call and not a chat message

- **Reach.** A ringing phone interrupts. A chat message waits for attention.
- **Out of band.** The request goes out on one channel and the decision comes
  back on another, so a pipeline cannot approve itself by writing to its own
  queue.
- **Evidence.** A spoken decision, a returned code, a transcript and a CALL-E
  call id is better change-approval evidence than a click.

## Try it without an account

`npm run demo` runs the gate end to end against a local fake CALL-E. No
credentials, no network beyond localhost, nothing rings.

```text
1. The release owner picks up and approves
  Approval code for Alice Okafor (release-owner): 4 7 2 9 1 3
  Calling Alice Okafor (release-owner), attempt 1.
  Attempt for release-owner: approved.
Verdict  approved

2. A yes with no code, then a backup who does not pick up
  Attempt for release-owner: not_approved (code_mismatch).
  Attempt for backup-owner: not_approved (no_answer).
Verdict  not_approved (no_answer)

3. The owner does not pick up, the backup approves
  Attempt for release-owner: not_approved (no_answer).
  Attempt for backup-owner: approved.
Verdict  approved

4. The record chain
3 record(s): chain and verdicts hold

5. Same chain, one verdict rewritten from not_approved to approved, hash recomputed
   verified: false
   record 2: verdict approved does not follow from the recorded attempts (not_approved)
```

Case 2 is the point of the whole app. Somebody answered and sounded willing, and
that is not an approval.

## Setup

Node 20 or later.

```bash
cd apps/typescript/phone-approval-gate
npm install
npm run check   # tsc --noEmit
npm test        # 72 tests, no credentials, no outbound calls
npm run demo    # the full flow against the local fake CALL-E
```

## Preview, which is the default

Preview prints the exact call script, the ladder, the masked numbers and the
result contract. It contacts nothing.

```bash
npm run gate -- preview --request examples/request.example.json
```

## One live run

Live mode needs a CALL-E API key in the environment and the `--live` flag. The
gate never reads a key from the request file.

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
npm run gate -- request --request your-request.json --live --audit approvals.jsonl
npm run gate -- verify --audit approvals.jsonl
```

Copy `examples/request.example.json`, replace the reserved 555-01xx numbers with
a phone you own or are authorized to call and keep the enrolment fields honest.
One run places at most one call per approver, in order and stops at the first
decision.

## In GitHub Actions

`action.yml` wraps the CLI. The step fails when nobody approves, so the deploy
step never runs. Full workflow in `examples/github-workflow.example.yml`.

```yaml
- name: Phone the release owner
  id: approval
  uses: CALLE-AI/awesome-phone-call-agents/apps/typescript/phone-approval-gate@main
  with:
    request-file: gate-request.json
    audit-file: approvals.jsonl
    api-key: ${{ secrets.CALLE_API_KEY }}

- name: Deploy
  run: ./scripts/deploy.sh
```

Outputs: `verdict`, `reason`, `approved-by`, `audit-record-hash`. The approval
code is printed to the step log, which is the request channel the approver reads.

## From an agent

An agent that is about to do something irreversible can write a request file and
shell out to the same CLI, then act on the exit code. The
[`deployment-approval-call`](../../../skills/deployment-approval-call/) skill
packages that flow, including the part where the agent stops and says nothing was
changed.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | approved |
| 10 | a person rejected the change |
| 20 | no approval: no answer, voicemail, wrong code, window closed |
| 30 | usage or request file error |
| 40 | audit verification failed (`verify` only) |

## What blocks an approval

Every path other than a live person returning the code lands on `not_approved`
with a reason: `no_answer`, `voicemail`, `call_failed`, `timed_out`,
`not_reached`, `code_mismatch`, `no_decision`, `no_transcript_evidence`,
`low_confidence`, `disagreement`, `window_expired`, `attempt_limit`,
`quorum_not_met`, `api_error`.

`disagreement` is worth calling out. The gate reads the recipient turns itself
and treats CALL-E's extracted `structured_result` as corroboration. When the two
disagree, it refuses. It can decline an approval a person really gave. It will
not invent one.

## The request file

| Field | Notes |
| --- | --- |
| `request_id` | Stable per change. Used in the idempotency key, so a retried step reuses the call instead of ringing twice. |
| `change.title`, `change.summary` | Read out loud. Capped at 120 and 600 characters, because a call cannot read an essay. |
| `change.environment` | Must appear in each approver's `authorized_for`. |
| `approvers[]` | Ladder order. E.164 phone, `enrolled_at`, `authorized_for`. Unique ids and unique numbers. |
| `policy.mode` | `single` or `dual` for two approvals from two handsets. |
| `policy.binding` | `code_from_request` (default) or `liveness_phrase` when the approver has no screen. |
| `policy.window_seconds` | Capped at 600. The whole decision expires with it. |
| `policy.min_confidence` | Floor on CALL-E's task completion confidence. |
| `policy.max_failed_attempts` | Stops the ladder walking a list of numbers. |
| `policy.allow_structured_only` | Off by default. On, an approval can rest on the extracted result when no transcript came back. Lower assurance, recorded as such. |

## Side effects, cancellation, credentials

- One CALL-E call task per approver per run. Nothing recurring is ever created,
  so there is no schedule to clean up. Stopping the process stops the ladder, and
  a call already in flight finishes on the CALL-E side.
- Preview and `verify` place no calls and need no credentials.
- `CALLE_API_KEY` is read from the environment only. `CALLE_BASE_URL` selects the
  environment so a staging job cannot dial from a production project.
- Records are appended to the file you name, with mode `0600`. Numbers are masked,
  transcripts are trimmed to the decisive turns and the code is never stored.

## Reading further

- [`docs/threat-model.md`](docs/threat-model.md): what the gate proves, what it
  does not and why NIST SP 800-63B calls the phone channel restricted.
- [`docs/audit-format.md`](docs/audit-format.md): the record fields and the three
  checks `verify` runs.
- [`examples/audit.example.jsonl`](examples/audit.example.jsonl): the records the
  demo produced, unedited.

This is a demo app for a workflow pattern, not a CALL-E SDK and not a supported
product API.
