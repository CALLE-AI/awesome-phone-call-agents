# HoldFast Worked Examples

All numbers below are fictional reserved samples (`+1-202-555-01xx`). Replace
with the real user-supplied E.164 number in live runs.

## Example 1: Sam's parts-order status

User request:

> I run a three-person repair shop. Call Example Parts at +1-202-555-0123
> about order PX-204. Confirm whether it shipped, when it arrives, and whether
> anything is backordered. Do not change the order or accept a paid upgrade.

Intake payload:

```json
{
  "goal": "Confirm whether parts order PX-204 has shipped, when it will arrive, and whether any item is backordered.",
  "callee": "+12025550123",
  "user_name": "Sam",
  "company": "example-parts-distributor",
  "context": {"order_reference": "PX-204", "business_name": "Sam's Auto Repair"},
  "success_criteria": ["shipping_status", "estimated_arrival", "backorder_status", "tracking_number"],
  "authorization_scope": {
    "may_provide": ["order_reference", "business_name"],
    "may_confirm": ["the existing order details read back by the representative"],
    "must_not": ["change or cancel the order", "accept a paid upgrade or substitute", "make a payment"]
  }
}
```

Dry-run preview shown to the user:

```text
Plan preview (no call yet)
- Callee: +1******0123 (Example Parts)
- Goal: shipping, arrival, and backorder status for order PX-204
- Disclosure: "Hi, this is an AI assistant calling on behalf of Sam."
- Known map: none yet; exploratory navigation
- Scope: status only; no order change, paid upgrade, or payment
- Cost: subject to CALL-E's current credits and pricing; the local preview does not show the exact balance
Confirm to place the call.
```

The packaged controlled result demonstrates HoldFast's one visible reversal:
CALL-E says `COMPLETED`, but the task is not automatically proven. The receipt
marks shipping, Tuesday arrival, and backorder status `PROVEN` with transcript
anchors; an unsupported tracking number stays `NOT PROVEN`. This fixture did
not place a real call. `scripts/map_update.py` can propose:

```json
{
  "goal": "Confirm whether parts order PX-204 has shipped, when it will arrive, and whether any item is backordered.",
  "observed_path": [
    {"prompt_summary": "orders menu", "keypress": "1", "meaning": "existing order"}
  ],
  "hold_seconds": 90,
  "reached": "human"
}
```

The stored route starts with `human_reviewed: false`. It cannot enter a later
call until a human reviews it, the goal still matches exactly, and the
observation is no more than 30 days old. No speed improvement is claimed.

## Example 2: Gym membership cancellation

User request:

> Call FitExample Gym at +1-202-555-0145 and cancel my membership. If they
> offer a discount to stay, decline. If they require written notice, get the
> exact mailing address and any reference number.

Key behavior: the authorization scope allows `cancel membership` but not
`agree to fees`. On the call, the human offers a freeze instead; per the
scope, the agent declines, completes the cancellation, and collects the
confirmation number. Verification finds the confirmation number spoken twice
in the transcript: `verified`.

The map update records the path `1 (membership) -> 3 (changes) -> human`,
hold of 95 seconds, and `best_time_local: "10:00-11:30"` if observed.

## Example 3: Automated pharmacy refill line (no human)

User request:

> Call Example Pharmacy's automated line at +1-202-555-0167 and check whether
> prescription RX-778812 is ready for pickup.

Key behavior: the line is fully automated. The agent enters the reference
digits via DTMF when prompted, receives a spoken status, and extracts
`refill_status: ready` and `pickup_by`. No human conversation occurs, so no
disclosure line is needed; the AI-disclosure rule applies to human pick-ups.
Verification can confirm the status; a pickup date carrying an unstated year
remains supportive rather than proven.

## Example 4: Failed navigation (fail closed)

User request:

> Call Example Water Utility at +1-202-555-0189 and ask why my bill doubled.

Outcome: the IVR menu has no matching option and the same menu level repeats
twice. Per the navigation doctrine, the agent stops pressing keys, waits
through one hold cycle, reaches no human, and ends the call. Report:

```text
[Outcome]
failed: IVR stall at level 2 (no billing-dispute option)

[What Happened]
Reached the main menu and the account menu. No option matched a billing
dispute. Waited one hold cycle after pressing the authorized operator key;
no human answered within the hold window.

[IVR Map]
map updated: recorded both menu levels and the stall point
```

The user gets the recorded menu structure and a suggestion: authorize an
operator fallback or call during staffed hours.

## Using the scripts

```bash
# Map lookup before a call
python3 scripts/map_lookup.py --number "+12025550123"
python3 scripts/map_lookup.py --company "example-parts-distributor"

# Verification after a call (result JSON from the CLI status output)
python3 scripts/verify_result.py --result call-result.json

# Map contribution after a call; the resulting route remains unreviewed
python3 scripts/map_update.py --maps-dir references/ivr-maps \
  --company example-parts-distributor --observation observation.json
```

## Offline acceptance (no CALL-E account needed)

The `tests/` directory runs the whole safe path without credentials:

```bash
# from the repository root — one command, three suites, zero credentials
python3 -m unittest skills.holdfast.scripts.test_run_task skills.holdfast.tests.test_holdfast skills.holdfast.tests.test_verifier_redteam

# screenshot-ready saved-result walkthrough; explicit no-call mode
python3 skills/holdfast/scripts/run_task.py \
  --task skills/holdfast/tests/fixtures/judge-parts-task.json \
  --inspect-result skills/holdfast/tests/fixtures/judge-parts-result.json
```

All suites isolate the global dialing ledger to a temp file, so the command
is hermetic: it works from an empty HOME, leaves no state behind, and needs
no CALL-E credentials. Fixtures cover a complete task, a successful
recorded-line call, the illustrative parts-order receipt, a no-keypress call,
a balance-failure start, and a result whose fields contradict its transcript.
The suites install a fake `calle` and assert on its invocation log: no
confirmation means zero calls, an in-flight task is never re-dialed (the
ledger is keyed on the task, not the output directory), a finished task
re-dials only behind an explicit `--retry`, concurrently confirmed runs
produce exactly one provider start, and corrupt or ambiguous state fails
closed without dialing. The frozen red-team suite
(`tests/test_verifier_redteam.py`) pins adversarial cases that must never come
back verified, plus positive cases so the verifier cannot pass by abstaining
on everything.
