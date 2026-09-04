# CreditCall

CreditCall turns a verified invoice exception into one disclosed, human-approved
phone task. It uses CALL-E over MCP, but it refuses to plan a call until a named
reviewer approves it and the test recipient has agreed to receive it.

The included example is fictional. Eight monitor arms were ordered at $94 CAD
and invoiced at $119 CAD. Regular JavaScript calculates the $200 exception.
CALL-E handles the conversation only after a person reviews the plan.

## Why this exists

Accounts payable teams often find an exception long before it is resolved. The
next step is usually a phone call, an email, or a supplier portal. CreditCall is
the call handoff. It asks which route the recipient prefers, returns a structured
result, and never approves payment.

## Safety boundary

- Calls are blocked until a named reviewer approves the plan.
- The test recipient must consent before a call is planned.
- Every call identifies itself as an automated test call.
- Call screening gets only the caller name and a short reason. The full
  disclosure is repeated after a person joins, then the agent waits before
  continuing.
- It does not claim to represent CDW Canada or any real supplier.
- It does not request payment details, credentials, or personal information.
- The included invoice, purchase order, and packet IDs are fictional.
- A separate `run` command requires the exact confirmation word `RUN`.
- Every destination must be an explicit E.164 number, such as
  `+14165550123`.
- Phone numbers are masked in terminal output.
- A local single-use reservation blocks a second start for the same plan.
- There are no recurring schedules or automatic retries.
- The workflow does not give financial, legal, medical, or emergency advice.

## Run the dry demo

Node 22 or newer is required.

```bash
pnpm install
pnpm test
pnpm demo
```

The dry demo proves the $200 calculation and prints the planned call goal. It
does not place a call.

## Connect CALL-E

Authenticate with the official CALL-E CLI, then plan a call to a consenting
test participant. The `--phone` value must use E.164 format: a leading `+`,
country code, and digits only.

```bash
pnpm exec calle auth login
pnpm plan -- \
  --phone +14165550123 \
  --region CA \
  --language English \
  --authorized-by Jonathan \
  --recipient-consent yes
```

Review the returned plan. Only then can the call be started:

```bash
pnpm run run -- \
  --plan-id PLAN_ID \
  --confirm-token CONFIRM_TOKEN \
  --confirm RUN
```

Read the result without starting another call:

```bash
pnpm run status -- --run-id RUN_ID
```

## Verification

The default demo is synthetic and does not place a call. The test suite covers
the $200 exception calculation, approval and consent gates, E.164 validation,
call-screening handoff, and recursive phone-number masking. No real call output
or transcript is committed to this repository.

If a start result is uncertain, do not run the plan again. Recover it with the
opaque recovery ID returned by CALL-E:

```bash
pnpm run recover -- --recovery-id RECOVERY_ID
```

To cancel before a call, discard the plan and do not run the `run` command. Once
a call has started, use the CALL-E dashboard controls. The call task also tells
the agent to end the call immediately if the recipient asks it to stop.

## Cash path

This project is being built for CALL-E: Your Code Is Calling. The target is the
$4,000 Most Practical Use Case prize. It also qualifies for the $3,000 innovation
prize, two $1,000 honorable mentions, and five separate $200 feedback prizes.

License: MIT
