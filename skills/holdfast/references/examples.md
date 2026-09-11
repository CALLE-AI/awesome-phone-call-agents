# HoldFast Worked Examples

All numbers below are fictional reserved samples (`+1-202-555-01xx`). Replace
with the real user-supplied E.164 number in live runs.

## Example 1: Airline baggage claim status

User request:

> Call Example Airlines at +1-202-555-0123 and find out the status of my
> baggage claim, reference number AB12CD3. Don't agree to any compensation
> offer; just collect it and report back.

Intake payload:

```json
{
  "goal": "Get the current status of baggage claim AB12CD3.",
  "callee": "+12025550123",
  "context": {"claim_reference": "AB12CD3", "passenger_name": "<user name>"},
  "success_criteria": ["claim_status", "next_step", "reference_confirmed"],
  "authorization_scope": {
    "may_provide": ["claim_reference", "passenger_name"],
    "may_confirm": ["flight details read back by the agent"],
    "must_not": ["accept compensation", "change delivery address", "close the claim"]
  }
}
```

Dry-run preview shown to the user:

```text
Plan preview (no call yet)
- Callee: +1******0123 (Example Airlines)
- Goal: status of baggage claim AB12CD3
- Disclosure: "Hi, this is an AI assistant calling on behalf of <user name>."
- Known map: none yet; exploratory navigation
- Scope: may provide claim reference and name; must not accept offers
- Cost: 1 call credit
Confirm to place the call.
```

After the call, `scripts/verify_result.py` marks `claim_status` verified
because the transcript contains "your claim is active and under review", and
`estimated_delivery` unverified because no transcript turn supports it. The
report says `partially verified`. `scripts/map_update.py` records:

```json
{
  "observed_path": [
    {"prompt": "main menu", "choice": "2", "meaning": "existing claim"},
    {"prompt": "claim menu", "choice": "1", "meaning": "claim status"},
    {"prompt": "speak to an agent", "choice": "0", "meaning": "human", "authorized": true}
  ],
  "hold_seconds": 210,
  "reached": "human"
}
```

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
Verification confirms both fields against the transcript.

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
# 3. Map lookup before the call
python3 scripts/map_lookup.py --number "+12025550123"
python3 scripts/map_lookup.py --company "example-airlines"

# 5. Verification after the call (result JSON from the CLI status output)
python3 scripts/verify_result.py --result call-result.json

# 7. Map contribution after the call
python3 scripts/map_update.py --maps-dir references/ivr-maps \
  --company example-airlines --observation observation.json
```

## Offline acceptance (no CALL-E account needed)

The `tests/` directory runs the whole safe path without credentials:

```bash
# from the repository root
python3 skills/holdfast/scripts/run_task.py \
  --task skills/holdfast/tests/fixtures/task.json          # dry-run preview
python3 skills/holdfast/scripts/verify_result.py \
  --result skills/holdfast/tests/fixtures/call-success.json
python3 skills/holdfast/tests/test_holdfast.py             # full offline suite
```

Fixtures cover a complete task, a successful recorded-line call, a
no-keypress call, a balance-failure start, and a result whose fields
contradict its transcript. The test suite installs a fake `calle` executable
and asserts it is never invoked without confirmation, so the side-effect gate
is checked on every run.
