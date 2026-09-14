# Examples

All phone numbers, suppliers and manufacturers in these examples are fictional.

## Preview, the default

A preview never places a call. It masks every number, states the exact side
effect and prints an approval token bound to that request.

Input: [`assets/example-request.json`](../assets/example-request.json)

```bash
partline preview fixtures/example-request.json
```

Output:

```text
PARTLINE  /  CALL PREVIEW
========================================================================
Request     PL-1042
Purpose     Source 6 x Fictional Bearing Co. 6205-2RS-C3
Window      Weekdays 09:00-16:30 America/Chicago
Side effect Places 3 outbound phone call(s).
Authority   Purchase authority: none

APPROVED CONTACTS
Supplier                       Masked number      Authorization
------------------------------------------------------------------------
Acme Industrial Supply         +15******01        supplier allowlist 20...
Central Motion Components      +15******02        supplier allowlist 20...
Lakeside Bearings              +15******03        supplier allowlist 20...

APPROVAL CHECKPOINT
No call was placed. Review this exact request before approving it.
Token        PARTLINE-D908AF7C0BA4
Live command partline run fixtures/example-request.json --live --confirm PARTLINE-D908AF7C0BA4
```

## Refused live run

A token from a different request, or an edited request, invalidates approval.
The command exits non-zero and places no call.

```bash
partline run fixtures/example-request.json --live --confirm WRONG-TOKEN
```

```text
PartLine refused: Approval token does not match this exact sourcing request.
```

The call window is enforced independently of the token. Outside the request's
local weekday window, a correct token is still refused:

```text
PartLine refused: The configured supplier calling window is closed. Run preview now and execute during the window.
```

## Comparison of completed results

Ranking is derived locally from schema-constrained CALL-E results. Quoted
evidence and derived ranking stay separate, and ambiguity stays unresolved.

```bash
partline summarize fixtures/completed-call.json --request fixtures/example-request.json
```

```text
CANDIDATE COMPARISON
Supplier                   Match       Qty   Lead    Ship date    Decision
--------------------------------------------------------------------------------------
Acme Industrial Supply     EXACT       8     1d      2026-08-28   Candidate
Central Motion Components  COMPATIBLE  12    1d      2026-08-28   Review
Lakeside Bearings          UNKNOWN     -     -       -            Review

EVIDENCE
- Acme Industrial Supply: I have eight of 6205-2RS-C3 on the shelf and can ship six tomorrow.
- Central Motion Components: It is dimensionally the same with two rubber seals and C3 clearance.
  Caveat: Supplier states dimensions, seals and C3 clearance match. Engineering approval required.
- Lakeside Bearings: Please email the request to our applications desk.

HUMAN DECISION REQUIRED
PartLine does not purchase, reserve stock, approve alternates or accept supplier terms.
```

An alternate that a supplier calls equivalent is never promoted to a
recommendation. It is marked for engineering approval. A supplier who deflects
to email is recorded as `unknown` rather than as a negative result.
