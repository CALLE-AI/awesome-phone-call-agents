# Authority Sign-Off Call

A real CALL-E phone call that reaches the accountable official directly
when a decision was already auto-authorized in their name, because the
whole point of automating incident response is that it doesn't wait for a
human — and a push notification they might never open doesn't close that
loop after the fact. This is one accountability primitive, not a certified
safety mechanism: see "Rules this follows" below for the hard limit on
using `override` to reverse anything consequential. Demonstrated end to
end, including a real placed call against CALL-E's live API, inside GovOS,
an experimental incident-response simulation (see "Reference implementation"
below) — not a deployed government system.

This is not a pre-action approval gate — see
[`deployment-approval-call`](../../../skills/deployment-approval-call/) and
[`incident-escalation-call`](../../../skills/incident-escalation-call/) in this
repository for that pattern, where the call blocks the action until someone
says yes. This app is for the opposite shape of problem: your system already
resolved something on its own (an auto-authorization, a policy-driven
decision, a delegated sign-off) and the real, named person that decision was
made *in the name of* needs a genuine, attributable channel to confirm it
stands or veto it after the fact — especially when they're away from a
dashboard and a phone call is the only thing that reaches them.

## Side effects

Placing a live call (`request` mode) dials `CALLE_SIGNOFF_PHONE` through your
CALL-E account and consumes one CALL-E call credit. `preview` mode never
places a call and needs no credentials.

## Setup

```bash
pip install -r requirements.txt
export CALLE_API_KEY="your_key"          # from the CALL-E dashboard
export CALLE_SIGNOFF_PHONE="+91XXXXXXXXXX"  # E.164 — your OWN number only
export CALLE_SIGNOFF_ENABLED=true        # omit/false = dry run, no real call ever
```

**Never** put a real emergency-services number, a third party's number, or
anyone else's number in `CALLE_SIGNOFF_PHONE` — this calls exactly one
person: whoever configured their own line to receive it.

## Running it

```bash
# No call, no credentials. Always do this first.
python cli.py preview \
  --authority "Chief Financial Officer" \
  --context "Q3 vendor payment batch" \
  --decision "Auto-release $42,000 vendor payment run" \
  --tier "Finance auto-release policy v2 (under $50k)" \
  --amount "$42,000"

# One real call. Needs CALLE_API_KEY, CALLE_SIGNOFF_PHONE, CALLE_SIGNOFF_ENABLED=true.
python cli.py request \
  --authority "Chief Financial Officer" \
  --context "Q3 vendor payment batch" \
  --decision "Auto-release $42,000 vendor payment run" \
  --tier "Finance auto-release policy v2 (under $50k)" \
  --amount "$42,000" \
  --idempotency-key "vendor-batch-q3-2026-001"
```

`request` mode is itself safe-by-default: if any of `CALLE_API_KEY`,
`CALLE_SIGNOFF_PHONE`, or `CALLE_SIGNOFF_ENABLED=true` is missing, it never
places a call — it prints exactly what it would have said (to stderr) and
exits 20. See [`../../../skills/authority-signoff-call/assets/dry-run-example.txt`](../../../skills/authority-signoff-call/assets/dry-run-example.txt)
for a real captured run of this.

## Reading the result

| Exit code | Meaning |
| --- | --- |
| 0 | Confirmed. The original decision stands. |
| 10 | Overridden. The named authority rejected it by phone. For a low-stakes, reversible decision, your system may route this the same way it would a dashboard "reject." **For a real emergency or financial action, do not auto-unwind from this alone** — the field is one spoken word, not verified against a transcript read-back or a second channel; route it to a human for manual reconciliation instead. |
| 20 | Unclear — not configured (dry run), no answer, or the call failed. Nothing has changed *in your system* — the original auto-authorization still stands. Do not retry automatically: surface the failed attempt to a person and let them decide whether to call again or leave it standing. Note that if the call was actually placed and merely timed out waiting for an answer (rather than failing to connect at all), CALL-E may still be attempting or have completed it on its end — stopping local work does not recall a call CALL-E has already accepted. Reconcile against the CALL-E dashboard/API before assuming nothing happened. |
| 30 | Bad arguments (e.g. missing `--idempotency-key` for `request`, or a `CALLE_SIGNOFF_PHONE` that fails E.164 validation). |

## Using it as a library

```python
from signoff_call import request_signoff_call

result = await request_signoff_call(
    authority_name="Chief Financial Officer",
    context="Q3 vendor payment batch",
    decision_summary="Auto-release $42,000 vendor payment run",
    authorizing_tier="Finance auto-release policy v2 (under $50k)",
    amount="$42,000",
    idempotency_key="vendor-batch-q3-2026-001",
)
# result["decision"] is "confirm" | "override" | "unclear"
# feed it back into whatever function your system already uses to apply a
# human decision to this record — this is not a new decision-application
# mechanism, just a real phone channel that reaches the same one.
```

## Rules this follows

- Never calls anyone but the pre-registered `CALLE_SIGNOFF_PHONE` — no
  recipient list, no third parties, no guessing a number.
- Validates `CALLE_SIGNOFF_PHONE` as ASCII E.164 before every real call
  (`validate_e164()`) — a malformed or non-ASCII value is rejected with exit
  code 30, never silently sent to CALL-E. The number is masked (`mask_phone()`)
  anywhere it could appear in output; never logged or printed raw.
- Never places a real call without all three of `CALLE_API_KEY`,
  `CALLE_SIGNOFF_PHONE`, and `CALLE_SIGNOFF_ENABLED=true` explicitly set.
- A call failure (busy, no answer, timeout, API error) resolves as
  `unclear`, never raises — a flaky phone line can never wedge a caller's
  workflow.
- **`override` must not automatically unwind a real emergency or financial
  action on its own.** The decision field is one spoken word, not verified
  against a transcript or a second channel — for consequential domains,
  route it to a human for manual reconciliation instead of an automatic
  reversal. Reserve fully automatic handling of the result for genuinely
  low-stakes, reversible decisions.
- Not for medical, legal, or emergency-dispatch decisions. This calls a
  named accountable person about a decision their own system already made;
  it is not itself a dispatch or notification-of-record mechanism.

## Reference implementation

[GovOS](https://github.com/shubhangi-mish/agents-for-humans/tree/main/govos)
is a Strands Agents-based autonomous incident-response **simulation** for
Delhi (built for a separate hackathon, not a deployed government system)
that models a government response chain — District Magistrate, Police
Commissioner, and DDMA (Delhi Disaster Management Authority, chaired by the
Chief Minister) — and auto-authorizes simulated actions under those tiers
without waiting for a person; its own call scripts say plainly that this is
"a government-operations simulation app," never a real emergency. Whenever
it does, it places one sign-off call using this exact pattern, and a
confirm/override result feeds into the identical function its own
dashboard's override button calls. See
[`../../../skills/authority-signoff-call/references/govos-reference-implementation.md`](../../../skills/authority-signoff-call/references/govos-reference-implementation.md)
for the real wiring, including a captured dry-run log line and a real call
placed against CALL-E's live API.
