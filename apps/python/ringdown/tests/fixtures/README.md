# What the provider's responses look like

The shapes the live CALL-E API and MCP endpoint answer with, on 2026-08-20, written out as
files. They exist because the client and the fake in `fake/` were both written from the same
reading of the same documentation on the same day, so a mistake in that reading lands in both and
the tests cannot see it. That already happened once: the payload sent `recipient` where the API
takes `recipients: [{phones: []}]`, and the fake accepted both.

These files are the third artefact. `tests/golden/` holds ledgers this app wrote; this directory
holds the shape of what somebody else answers with. Tests read them directly, without the fake, so
the parser is checked against a shape it did not invent rather than against a mirror of itself.

**No provider response is reproduced here.** Every value in every payload — identifiers, phone
numbers, names, timestamps, transcript turns, provider summaries, evidence lines and confidence
scores — was written for this repository. Phone numbers come from the reserved `+1555010xxxx`
range, the engineer is the same fictional Alice Okafor the demo pages, and the bot turns are
Ringdown's own script text. What is evidentiary is the shape — which keys exist, where they sit,
what type they hold and what the provider says when it fails — and nothing else in these files is
evidence of anything.

Every fixture carries its own provenance:

- `what` — the request it answers
- `source` — which endpoint the shape came from, and when
- `unobserved` — what is **not** evidence: the parts elided, assumed, or never captured
- `why_it_matters` — the failure it pins down
- `payload` — the body

Read `unobserved` before trusting a fixture. The evidence is partial and the gaps are the point.

## What the live provider settled, and what it broke

On 2026-08-20 three calls were placed against the live provider from a US Twilio number that
bridges to the on-call engineer's phone, which is how ceiling 14 was worked around. Two over
REST, one over MCP. They settled four things the fake could only assume:

- **`metadata` comes back exactly as sent**, and each attempt carries a `provider_call_id`. The
  attempt identity check can pass against the real API.
- **The idempotency key works.** Both REST creates timed out without saying whether a call
  existed; both replays returned the existing call rather than placing a second one.
- **`get_call_run` takes `run_id` and rejects `call_id`** with a validation error delivered
  inside an HTTP 200. Ringdown had been sending `call_id`.
- **No identifier a REST-placed call exposes resolves to a run.** Not the call id, not
  `provider_call_id`, not the attempt or recipient id. The `provider_call_id` candidate that
  ceiling 12 left open is closed: it does not work.

And one thing they broke. `mcp-get-call-run-completed.json` carries the shape of the first
successful response ever seen from that tool, and **`run_from` cannot read it**: the call id is at
`result.call_id` rather than at the top level, `transcript` is one newline-joined string rather
than a list of turns, and `recipient_phone`, `completed_at` and `metadata` are not in the run at
all. Three of the ten verification checks have nothing to read even when the run is served.

That is exactly the failure this directory exists to catch — the client and the fake were
written from one reading of the docs, so the mistake landed in both and the tests could not see
it. The fake still mirrors the wrong shape. Making it faithful changes what the ten checks can
prove, which is a decision, not a patch.
