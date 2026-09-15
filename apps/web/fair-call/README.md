# Fair Call

A policy-grounded AI agent that decides whether an eBay Money Back Guarantee dispute is a
fair call — then makes the call.

**What it does:** Fair Call takes a buyer's eBay "item not as described" dispute, checks it
against real eBay MBG policy, drafts a call script with verbatim policy citations, gets
human approval of that exact script, then has CALL-E place a real outbound call to eBay
customer support to pursue the buyer's pre-authorized resolution — refund or replacement,
never store credit, never anything outside the approved scope.

**Full source, setup, and technical spec:** https://github.com/mflittle/fair-call

This app has its own AWS Amplify Gen 2 backend (Cognito, AppSync, DynamoDB, and three Lambda
functions), so it isn't vendored into this repo directly — the linked repo has complete
setup instructions.

## Side effects & safety

- **Places a real outbound phone call** via CALL-E once a human clicks "Approve & Call" — no
  call happens before that explicit approval step.
- **No callable recipient by default.** The call recipient is set via an uncommitted `.env.local` variable
  (`NEXT_PUBLIC_DRY_RUN_PHONE_NUMBER`); with no configuration it defaults to an invalid
  placeholder, so nothing can be called accidentally. Point it at your own number to test
  only for an explicitly authorized real test call. Calling your own phone is
  still a real outbound call, not a dry run, and may incur charges.
- **No hidden recurring schedule.** Each case places at most one call; there's no
  polling/retry loop that places additional calls on its own.
- **This integration does not implement mid-call cancellation.** Closing its UI
  does not recall an already-submitted call. The implemented
  cancellation point is before clicking "Approve & Call."
- **Phone numbers are handled in E.164** internally and masked in the UI (e.g.
  `(646) •••-••82`) wherever they're displayed, so the number never appears in full on
  screen even though it's what's actually dialed.
- **Credentials are server-side only** (`ANTHROPIC_API_KEY`, `CALLE_API_KEY`, set via
  `npx ampx sandbox secret set`) — never exposed to the client bundle.
- **Scope boundary:** narrowly built for eBay Money Back Guarantee item-not-as-described
  disputes. No medical, legal, financial, or emergency use — this is not a general-purpose
  calling agent.

## Setup & usage

See the [full README](https://github.com/mflittle/fair-call#readme) in the linked repo for
install steps and required secrets. Use its no-call/unconfigured path for review.
An optional test to your own authorized phone is a real call and requires explicit approval.
