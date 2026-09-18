# Defects register

**Open defects: none.**

This register is deliberately empty at the release gate — an open defect
blocks release until it is either fixed or moved to
`docs/known-limitations.md` with the owner's agreement. It is not a place to
park work that was hard.

## How to use this register

- **Adding an entry:** every entry needs the symptom (input → wrong output),
  the affected surface, the test that reproduces it (or why no test exists
  yet), and the fix or the reasoned deferral.
- **Closing an entry:** fixed by a named commit and test, or reclassified as
  a documented limitation. Never deleted silently — history is the point.
- **Checking the gate:** a non-empty register means the release gate has not
  been passed (`make check` / `make judge` green **and** this page empty).

## Closed

- **WOR-2026-09-12-Routing — closed.** A `+91…` recipient inherited
  `region: US` and `locale: en-US`; the authorized R8 and R3 attempts each
  received a zero-duration provider `404` followed by `call_failed`, with
  no transcript. The affected surface was outbound call creation routing.
  `test_an_indian_recipient_never_inherits_us_routing_metadata` and
  `test_mismatched_recipient_routing_refuses_before_the_provider` now pin
  destination-correct allowlisted metadata and a pre-provider mismatch
  refusal. The external carrier/platform cause is not independently proven,
  so R8/R3 remain failed attempts and limitations—not evidence. Neither row
  is retried.
