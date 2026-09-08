# The approval gate

The rule is not "ask before every call". Asking before every call makes an autonomous agent
pointless, and users stop reading a prompt they see six times in one run.

The rule is about **commitment**. Asking a question costs nothing and can be undone by
hanging up. Agreeing to a price, cancelling a booking, or placing an order binds the user to
something they cannot take back by hanging up.

So: **information gathering runs unattended. Anything that would bind the user stops and
waits.**

## Two kinds of call

### Gathering — may ask, may not agree

Runs without asking the user anything. Its script must say so explicitly, in the script
itself, not merely in the planner's intent:

> You are NOT authorised to agree to anything, accept any price, place any order, or cancel
> anything on this call. If they offer something, record it as an offer and say you will
> confirm shortly. Saying yes is not your decision to make.

Without that paragraph, a helpful caller offered a good deal will take it.

### Commit — the one call that may say yes

Exactly one call per run, after the user approves, and its script names the exact terms:

> YOU ARE AUTHORISED TO ACCEPT EXACTLY THIS AND NOTHING ELSE:
>   500 insulated shipping boxes, local van delivery
>   Price: USD 438.00
>   Delivery: 2026-09-10
>
> If the terms have changed in any way — a different price, a later date, an added fee, a
> different item — do NOT accept. Record the new terms as an offer, set verdict to 'offer',
> and end the call politely. The customer will decide again.

The authorisation is an **envelope**, not a permission. The user approved *that* offer, not
a renegotiated version of it. A caller told to "use its judgement" on changed terms is a
caller that can spend more than the user agreed to, and the user will not find out until the
invoice.

## The backstop, and its trap

Flag committing actions explicitly in the planner. Underneath that, keep a keyword net over
the call script for the case where the planner forgets — `accept`, `confirm the order`,
`place an order`, `purchase`, `pay`, `cancel`, `agree to`, `sign`, `authorise`, `commit`.

**The net must be negation-aware, and this is not a detail.**

Every gathering script above ends with "you are NOT authorised to *agree to* anything,
*accept* any price, or *cancel* anything" — three committing verbs, in the one paragraph
whose whole purpose is to forbid them. A naive keyword net flags every call in the run. The
user approves six times, learns that approval means nothing, and clicks through the seventh
without reading it. A safety net that fires constantly is worse than no net: it trains the
behaviour it exists to prevent.

Exclude lines carrying a negation cue — `not authorised`, `do not`, `never`, `must not`,
`cannot`, `without approval` — before matching. Match line by line, not on the whole script:
these are bulleted rules, and a bullet is the unit that carries one instruction.

## What the approval screen must show

- the question, in plain language: what is being accepted, from whom, for how much, by when
- every constraint, with its verdict, hard and soft marked differently
- **what was turned down, and on which constraint**

The last one is not decoration. An approval screen showing only the winner asks the user to
trust a search they cannot see. Showing the $612 offer that was rejected for being $112 over
the limit is what turns a one-tap approval into an informed one.

## Declining

Record the declined offer so the planner cannot re-propose it, and send the agent back out.
Do not treat a decline as an abandonment: the user rejected an option, not the goal.

## Never

- Never let a gathering call commit, however good the offer.
- Never widen the approved envelope because the terms improved. A cheaper price is still a
  different offer; take it back to the user.
- Never hold a thread or a timer waiting for approval. It may take a day. Park the run as a
  value and resume it when the answer arrives.
- Never re-check the budget only at planning time. Check it again immediately before the
  approved call is dialled — the approval may have sat overnight.
