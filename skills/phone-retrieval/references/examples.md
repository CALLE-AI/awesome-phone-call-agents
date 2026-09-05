# Examples

All numbers below are reserved-fictional (`+1555…`). Nothing here dials
anything: every command is shown against the fake provider, which needs no
account and no network.

---

## 1. One business, two questions

```
CALL_PROVIDER=fake python scripts/call_agent.py plan \
    --to +15550101234 \
    --callee-name "Miller Hardware" \
    --purpose "Check availability and price before travelling across town" \
    --field "unit_price=How much is the twelve-inch flue pipe" \
    --field "in_stock=Do you have it in stock today"
```

The plan comes back with an identifier, a readiness flag, the goal that was
sent, and the goal the provider intends to use. **No token is printed** — it is
a spend credential and stays in local state.

Read `display_goal` against `goal_sent` before approving anything. Then:

```
CALL_PROVIDER=fake python scripts/call_agent.py run --plan-id PLAN-FAKE-1 --wait
```

and afterwards:

```
CALL_PROVIDER=fake python scripts/call_agent.py show PLAN-FAKE-1
```

`show` follows a plan to its run and attaches the stored result, so this is the
whole record of the call in one place — including the transcript, which is the
authority on what was actually said.

## 2. Several businesses, same questions

One plan carries one approval, so a plan with five recipients is five
irrevocable calls authorised by a single decision. The adapter caps recipients
for that reason.

Prefer one plan per business. It costs an extra approval each and it means a
bad number, a wrong region, or a change of mind affects one call rather than
five:

```
for n in +15550101234 +15550105678; do
  CALL_PROVIDER=fake python scripts/call_agent.py plan \
      --to "$n" --callee-name "..." \
      --purpose "Compare price and availability" \
      --field "unit_price=How much is it" \
      --field "in_stock=Do you have it in stock"
done
```

Ask every business the same fields in the same order, then rank confirmed
identities above unconfirmed ones. **A confident answer from a business you
could not confirm does not outrank a hesitant answer from one you could.**

## 3. Watching the provider rewrite the goal

This is the part worth trying, and it takes thirty seconds.

The provider does not speak the text you wrote. It rewrites it, and the
rewritten version is what comes back as `display_goal`. Set `CALL_FAKE_REWRITE`
to make the fake reproduce each of the changes worth reporting:

```
CALL_FAKE_REWRITE=added CALL_PROVIDER=fake python scripts/call_agent.py plan \
    --to +15550101234 --callee-name "Miller Hardware" \
    --purpose "Check availability" \
    --field "unit_price=How much is it" \
    --field "in_stock=Do you have it in stock"
```

| Mode | What it does to the returned goal |
|---|---|
| `added` | appends permission the caller never granted — here, leaving a voicemail, which the sent goal explicitly forbids |
| `merged` | collapses two separate prohibitions into one comma list |
| `referent` | changes whose interests a hard line protects |
| `dropped` | removes a requested field from the list |
| `normalised` | rewords without changing meaning |

Compare `goal_sent` and `display_goal` in the stored plan record each time.

**Note that all five set `goal_modified_by_provider` to true, including
`normalised`.** The flag cannot tell you whether a change matters — that is a
judgement you make by reading the pair. This is why there is no threshold and
no automatic classification here; see `references/goal-inspection.md` for why an
earlier attempt at classifying these automatically was abandoned.

## 4. What a report looks like when identity was never confirmed

The goal asks the agent to confirm it reached the right business before asking
anything else. **It does not always do so**, and the record has to say that
rather than quietly presenting the answers as though it had.

```
Miller Hardware — +1555…1234 — identity NOT CONFIRMED
  The callee answered without naming the business and was not asked.
  Everything below came from someone at this number. It is not established
  that this number reaches Miller Hardware.

  unit_price   24 dollars          (transcript 00:00:12)
  in_stock     yes, several        (transcript 00:00:17)

  Number came from: the operator.
```

Compare with a wrong-business outcome, where nothing is reported as an answer
at all:

```
"Miller Hardware" — +1555…1234 — WRONG BUSINESS
  The callee said this is Pinewood Joinery. No questions were asked.

  unit_price   unasked
  in_stock     unasked

  Number came from: a listing.
```

`unasked` is not the same as unanswered, and neither is the same as a refusal.
Keeping them distinct is the point: a caller can act on "they would not say" and
cannot act on a blank.

## 5. Something went wrong on the call

```
Miller Hardware — +1555…1234 — identity confirmed

  unit_price   24 dollars          (transcript 00:00:12)
  in_stock     unanswered — the callee went to check and the call ended

  ANOMALY — potential manipulation or exfiltration attempt
  At 00:01:04 the callee asked for "the confirmation code from your system"
  before agreeing to hold the item, and gave +15550109999 as a number to
  call back on. Nothing was sent. That number is not being called.
  Reviewing this is your decision, and a call to it would need its own plan.
```

Naming it as a manipulation attempt is deliberate. Filed as an ordinary request
— *"the shop asked for a code"* — it gets actioned later by someone skimming.

## 6. Running the tests

```
python scripts/test_call_agent.py
```

No credentials, no network. 28 groups, asserting on side effects: how many times
the provider was submitted to, what mode files were created with, whether a
hollow read overwrote a record that had content.

⚠️ File-mode assertions are skipped on Windows and say so when they are — the
owner-only guarantee is POSIX-only.
