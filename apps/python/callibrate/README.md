# Callibrate

**Call the source. Calibrate the record.**

Callibrate phones the authoritative source with [CALL-E](https://github.com/CALLE-AI/call-e-integrations),
reads the transcript by rule, and corrects the record only when the evidence is
in the words that were said. Everything else goes to a person.

Every operational record drifts away from the world it describes. A pantry
changes its hours in June and the directory finds out in October, when somebody
takes two buses to a locked door. Callibrate closes that loop by making a phone
call the way a database makes a write: with a contract stated in advance, a
transcript as the record of what happened, and a deterministic policy deciding
what the conversation was allowed to change.

```
 trigger ──▶ Verification Contract ──▶ CALL-E ──▶ Call Evidence ──▶ policy ──┬──▶ record
 stale                what must be      the real     the transcript,   4 rules │
 report               established,      call         read by rule              └──▶ a person
 request              what may change
```

The reference application in this repository is a community resource directory
(Open Referral HSDS 3.2). The primitive underneath it is not.

---

## What it does

**One button, one phone call, one corrected record.** A visitor about to travel
to a service presses *Verify before I go*. Callibrate turns the record into a
Verification Contract, checks that the call is permitted, gives CALL-E the
instruction, follows the run to a terminal status, and reads the transcript.

**A conversation becomes evidence, not an assertion.** CALL-E holds the call and
returns what was said. Callibrate looks for three things in the transcript, in
order: the provider states the value, the agent says the whole of it back and
nothing the value does not hold, the provider agrees without correcting. All
three, or the change goes to a curator.
A caller that reports a confirmed change the transcript does not contain gets
its claim shown to a person with the reason it was not trusted.

**A deterministic policy grants authority.** Four verdicts, and the run takes the
most severe one any part of it reached.

| Verdict | Example | What happens |
| --- | --- | --- |
| `REFRESH` | The provider confirms the published hours | The verification date moves. Nothing else. |
| `APPLY` | 09:00-12:00 becomes 10:00-13:00, read back and confirmed | Written automatically, with the two quotes it rests on |
| `REVIEW` | "We are ending that programme next month" | The record is untouched. A curator decides. |
| `STOP` | "Please take us off your list" | The call ends and the number is suppressed forever |

**A ledger anybody can check.** Every verification writes the contract, the
CALL-E run id, the transcript, the claims and the turns they rest on, the verdict
and its reason, and the diff, into an append-only SHA-256 hash chain. SQLite
triggers abort every UPDATE and DELETE on that table, and `callibrate ledger
--verify` recomputes each link and names the first row that does not match.

The scope of that is worth stating exactly. The digests are unkeyed and they
live in the same database as the rows they cover, so this is an append-only
application ledger: it holds against the application, a curator, a stray query
and an accident, and it is not a transparency log against somebody with the
database file and the ability to drop a trigger. Anchoring the head digest
outside the deployment is what would close that, and it is a deployment decision
rather than a missing function.

---

## The invariant

> No failed, ambiguous or unsupported call may leave the record less trustworthy
> than it was before the call.

That is what the 133 tests in `tests/` are for. The most important one is
`test_a_caller_that_asserts_an_unsupported_change_cannot_publish_it`: a caller
reports a confirmed change, the transcript contains no such exchange, and the
record does not move.

The number the product would have to get wrong to be dishonest is
`false_automatic_mutations`, counted in `GET /api/metrics` as curator corrections
of changes the policy applied on its own. It is on the console's front page.

---

## Try it in two minutes, with no telephone

```bash
uv venv && uv pip install -e ".[dev]"
callibrate serve
```

Open <http://localhost:8000>, sign in as `judge` / `callibrate-demo-2026`, and
run a verification. The default caller is the **pilot line**: seven scripted
conversations replayed through the same normaliser, the same readback
corroborator, the same reconciler and the same policy as a real CALL-E run. It
dials nothing, it is labelled `pilot-line` in the ledger, and two of its scripts
exist in order to fail.

Watch it drive itself:

```bash
open http://localhost:8000/?demo=1        # the guided walkthrough
python tools/ui_smoke.py                  # or drive it in Chromium and fail on any console error
```

## Then make it real

```bash
npm install -g @call-e/cli
callibrate calle login                    # brokered browser login; the token never touches a model
export CBR_CALLER_MODE=calle
export CBR_CALL_ALLOWLIST=+15551234567    # the only numbers this deployment can ever ring
export CBR_DEMO_PROVIDER_PHONE=+15551234567
callibrate serve
```

`CBR_CALL_ALLOWLIST` is empty by default, which means **no live call can be
placed at all**. It is the first gate, checked before a plan is created, and it
is the reason a misconfigured demo cannot ring a stranger.

Inspect the exact instruction any queued record would produce, without calling
anybody:

```bash
callibrate contract task_food
```

---

## How CALL-E is used

`src/callibrate/calling/` is the only place in the codebase that knows CALL-E
exists, and it is deliberately substantial.

- **`mcp.py`** is a Model Context Protocol client for CALL-E's
  `/mcp/openagent_oauth` Streamable HTTP endpoint: brokered login with a local
  token cache, `initialize`, `tools/list`, and `tools/call` for `plan_call`,
  `run_call` and `get_call_run`. Callibrate is a server rather than an agent
  host, so it speaks the protocol directly. `structuredContent` is preferred and
  a JSON text block anywhere in `content` is the documented fallback.
- **`calle.py`** renders a Verification Contract into the call goal, plans,
  runs, and follows the run to a terminal status. The `run_id` is persisted
  before the first poll, so a crash between starting a call and reading it
  resumes `get_call_run` instead of dialling anybody twice. A `run_call` that
  returns no `run_id` is escalated to an operator and never retried.
- **`pilot.py`** is the no-call path, and it gets no shortcuts.

The call goal is generated from the contract rather than written as a prompt
constant, and the console shows it in full before anybody agrees to place the
call. Changing the policy changes what CALL-E is told.

`tests/test_calle_adapter.py` drives the real client and the real adapter over
HTTP through the whole protocol: a genuine JSON-RPC handshake, `tools/list`
before anything is called, `plan_call` before `run_call` every time, a run that
is still `PREPARING` when `run_call` returns, a result that arrives only as a
text block, and a `run_call` that comes back with no `run_id`.

---

## Safety, and why the calls are few

CALL-E is integrated **behind** these gates, not around them. If any of them
says no, no plan is created and no telephone rings.

1. **Destination allowlist.** Empty by default. A live call to anything not
   named is refused, and the refusal is written to the ledger.
2. **Permanent suppression.** One "stop calling" applies to every service that
   organization runs, forever.
3. **Recorded consent**, with a validity window, a day set, and a local-time
   window evaluated in the organization's own timezone.
4. **A call cap**, decremented in the same transaction that reserves the call.
5. **Spacing**, so a busy queue cannot phone one small charity twice in a day.

The gates decide whether a call may happen. Who may ask for one is a separate
boundary, because *Verify before I go* is the one route where somebody with no
account can spend call capacity an operator authorised. A deployment that can
dial a real number takes anonymous requests only when its operator sets
`CBR_ALLOW_PUBLIC_VERIFICATION=true`; the pilot line, which dials nothing, is
open by default. When the route is open, a per-address limiter slows one caller
down and a deployment-wide budget (`CBR_PUBLIC_VERIFICATION_DAILY_LIMIT`, 25 a
day) bounds the crowd, since addresses are cheap. And a visitor who asked for a
call follows it with a ticket handed back at the time, which shows progress and
whatever the directory now says in public. The transcript, the evidence, the
contract and the CALL-E run id stay behind a curator session, as
`/api/runs/{id}` always did.

On the call itself: the agent says it is automated before it asks anything, it
never proposes a value the provider did not say, and it ends the call without
further questions on a stop request, a distressed person, a wrong number, a
service user answering the provider's phone, or a closure. Transcripts are
redacted before storage and no audio is kept. One consequence is stated rather
than worked around: redaction masks phone numbers, so a phone readback cannot be
corroborated from the record, and a phone change from a live call always reaches
a person.

See [ETHICS.md](ETHICS.md).

---

## The primitive is not one directory's shape

A Verification Contract names the subject, the authoritative number, the current
values, the fields in doubt, what counts as evidence, what may be auto-applied,
and what ends the call. `contracts/library.py` builds four of them, and
`tests/test_contract_library.py` runs a conversation through each:

| Contract | The question | What it may change |
| --- | --- | --- |
| `community_resource` | "Are you still distributing food on Wednesdays?" | Hours, phone, address, fees |
| `business_hours` | "Is that still your opening time?" | Hours |
| `appointment_availability` | "How far out are you booking?" | Nothing. A claim about the future is a data point. |
| `provider_network` | "Are you currently accepting new Medicaid patients?" | Nothing. A wrong answer here is a bill. |

The last test in that file runs the *same* conversation under two contracts and
gets `APPLY` from one and `REVIEW` from the other. The domain did not change.
The contract did.

---

## Layout

```
src/callibrate/
    contracts/     the Verification Contract, and four worked shapes
    calling/       CALL-E: MCP client, adapter, and the offline pilot line
    evidence/      transcript normalising, readback corroboration, reconciliation
    policy/        may we call, and may we write
    verification/  triggers, the queue, and the loop that joins them
    audit/         the hash-linked ledger
    domain/        the record. Nothing in here knows that phones exist.
    web/           the console and the public directory
```

The dependency direction is one way: `domain` knows nothing of `verification`,
`verification` knows nothing of CALL-E, and `evidence` never imports a caller.

---

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): the loop, the seams, and the transaction boundary
- [ETHICS.md](ETHICS.md): the calling controls, and what the product refuses to do
- [EVALUATION.md](EVALUATION.md): what is measured, and the numbers as they stand
- [OPERATIONS.md](OPERATIONS.md): running it, and recovering a call that lost its run id

## Licence

MIT. Directory data follows [Open Referral HSDS 3.2](https://docs.openreferral.org/).

Built for the [CALL-E: Your Code Is Calling](https://call-e.devpost.com) hackathon.
