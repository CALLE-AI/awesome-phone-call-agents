# ClaimCall safety

Phone calls are real-world side effects. Safety is enforced in code (`claimcall/policy.py`,
`claimcall/engine.py`, `claimcall/cli.py`), not just in prompt text.

## No-call default

- The app starts in **preview** mode: masked destination, exact purpose, objectives,
  restrictions, and the expected result schema. No call, no API key.
- **Fixture** mode runs the full workflow against a synthetic CALL-E-shaped response
  through the same result-handling and state-transition code as live mode. No call, no API key.
- **Live** mode must be explicitly selected on every run.

## Human approval

- Loading, analysing, or previewing a case never dials. A real call needs an explicit
  approval on the same run: the dashboard approval checkbox, or `--approve` on the CLI.
- The live CLI additionally requires `--hotline` to repeat the case hotline exactly,
  so the authorised destination is confirmed character for character.
- One approval covers exactly one call. There is no scheduler, no queue, and no
  automatic redial: after a call is created the app only polls its status.

## Destination rules

- The hotline must be a full E.164 number whose country code matches the case region
  (`policy.REGIONS`); anything else is refused in code.
- A number typed into the dashboard for a live call carries its own region, derived from
  its country code (`policy.region_for_number`); unsupported country codes are refused.
- If `CLAIMCALL_ALLOWLIST` is set, live calls to any number outside it are refused.
  For hackathon verification, put your own test number there.
- Destinations are masked (`+1***00`) in CLI output, the dashboard, and stored call records.

## Agent boundaries

Every call task ends with hard boundaries, and the result schema gives the agent no
field for anything outside the five objectives:

- no purchases, no payment information, no additional charges
- no cancelling or modifying unrelated flights or bookings
- no accepting or rejecting compensation offers on the traveller's behalf
  (an offer is recorded verbatim and stops at the human)
- no passwords, OTPs, or ID numbers; no legal threats

## Fail-closed results

- The result schema is closed (`additionalProperties: false`) with every field required.
- `engine.validate_result` checks the returned object locally before any state changes.
- Unknown or malformed results change nothing: the case goes to `needs_human` with the
  validation problems recorded, and a human reviews the transcript.
- No legal advice: the recommended next action is a deterministic, advisory follow-up
  derived from the structured state (wait for written confirmation, retain receipts).

## Credentials and data

- Live mode reads `CALLE_API_KEY` from the environment or `.env`; the key is sent only
  to `https://api.heycall-e.com`. A `CALLE_BASE_URL` override is refused, not ignored.
- Never commit `.env`, `.env.local`, or real phone numbers. Fixtures use the fictional
  NANP range `555-01XX` and placeholder names/references.
- The dashboard has no authentication: it binds to loopback only, rejects non-loopback
  `Host` headers, and requires an `X-ClaimCall` header on writes.

## Cancellation

- There is no recurring schedule to cancel: each run is a single operator-invoked cycle.
- After `POST /v1/calls` succeeds, stopping the app stops only local polling; it does
  not recall the outbound call. The recorded call ID in the dashboard is the reference
  for checking the outcome in the CALL-E dashboard.
