# Phase 5 decision ledger — owner authorization

This is the stop point the build directive set: Phases 0, 1, 1b, 2, 3, 4 and
6 were executed and gated; Phase 5 execution was not performed by that build.
After the gate, the owner authorized Decision Record 1 for **R4, R8, and R3
only**. Decision Record 2 remains **not selected**.

Decision Record 1 is conditional. It does not itself place a call or waive any
architecture §4.3 gate. Each authorized row still requires completion of the
owner preconditions and a separate pre-dial GO. If a consent, privacy,
scrubber, platform, or other §4.3 gate fails, that row is dropped and
disclosed as a limitation.

---

## Decision record 1 — rows authorized

| Field | Entry |
| --- | --- |
| Decision | Authorized, conditional on every architecture §4.3 gate |
| Authorized by | Owner via Codex chat confirmation: `CONFIRM PHASE 5: AUTHORIZE R4,R8,R3 ONLY` |
| Date | 2026-09-12 |
| Rows named | R4, R8, R3 only — in that order, one row at a time |
| Conditions | R4 uses an owned number for no-answer/voicemail; R8 uses a consenting warranty professional; R3 uses a consenting role-player. All spoken claim data remains synthetic. Before each row: confirm +200 CALL-E allocation; verify CALL-E KYC and country/telephony feasibility for the destination; obtain written consent for every non-owned participant covering role, synthetic-data boundary, recording, retention, deletion, and withdrawal; use a private artifact directory outside the repository with mode 0700 and raw artifacts at mode 0600; keep the key only in the environment; run the deterministic scrubber and planted-identifier negative control; obtain owner dry read of every public cassette and receipt field; pass receipt schema, audit-chain, packet-hash, byte-stability, tests, validator, hygiene, and proof-page gates; and record retention/deletion. Each actual dial additionally requires a separate pre-dial GO. R1 is never re-run. R2, R1b, R5, R6, R7, and R9 remain unauthorized. |

The directive's standing order applies only to future, separately authorized
rows (Amendment B, the owner's own rule, restated — not a recommendation):
after R4 → R8 → R3, any later order would be R6 → R5 → R7
same-key/same-body → R9 → R2. R7 with a different body under the same key is
forbidden. R1b is authorized separately if at all. R1 is never re-run.

---

## Decision record 2 — R1 only

| Field | Entry |
| --- | --- |
| Decision | Not selected |
| Authorized by | — |
| Date | — |
| Conditions | — |

If this record is chosen later, the submission carries this sentence verbatim:

> Submission proceeds with R1 only; Real World Impact evidence is limited to
> one role-play call; the expected tier is Honorable Mention, not Most
> Practical.

---

Decision Record 1 was authorized on 2026-09-12; Decision Record 2 remains not
selected. Nothing downstream (push, PR, publication, video, submission) has
occurred.

---

## Execution record — R4

| Field | Entry |
| --- | --- |
| Date | 2026-09-12 |
| Outcome | One authorized owned-number no-answer call; transport `failed`; no person reached; no transcript; `claim_status: UNKNOWN`; write-back withheld |
| Call discipline | `calls_created: 1`, `calls_retried: 0`; no failover and no second create |
| Public artifacts | Sanitized cassette at `apps/python/warrantyops/tests/cassettes/r4.json`; public receipt at `apps/python/warrantyops/proof/receipts/r4.public.json` |
| Private artifacts | Raw provider artifact and private runner reports remain outside the repository at mode 0600 in a mode-0700 directory |
| Owner gates | Owner completed private preconditions and pre-dial GO; owner dry-read approved public integration with `APPROVE R4 PUBLIC INTEGRATION` |
| Next authorized rows | R8, then R3; each still requires its own §4.3 preconditions and separate pre-dial GO |

R1 remains receipt-only and is never re-run. R4 is also never re-run.

---

## Execution record — R8

| Field | Entry |
| --- | --- |
| Date | 2026-09-12 (provider attempt completed at 09:45:33Z) |
| Outcome | Transport `failed`; no person reached; no transcript; `claim_status: UNKNOWN`; write-back withheld |
| Call discipline | `calls_created: 1`, `calls_retried: 0`; no failover and no second create |
| Provider observation | Zero-duration attempt returned `404`, surfacing as `call_failed`; external carrier/platform cause not independently proven |
| Routing incident | The `+91…` recipient was sent `region: US` and `locale: en-US`; the routing default was closed and is now a pre-create mismatch refusal |
| Public artifacts | None — no sanitized cassette and no public receipt |
| Private artifacts | Private receipt and raw provider artifact remain outside the repository; raw content is never published |
| Classification | Authorized failed attempt and known limitation; **not evidence**; never retried |

---

## Execution record — R3

| Field | Entry |
| --- | --- |
| Date | 2026-09-12 (provider attempt completed at 11:32:18Z) |
| Outcome | Transport `failed`; no person reached; no transcript; `claim_status: UNKNOWN`; write-back withheld |
| Call discipline | `calls_created: 1`, `calls_retried: 0`; no failover and no second create |
| Provider observation | Zero-duration attempt returned `404`, surfacing as `call_failed`; external carrier/platform cause not independently proven |
| Routing incident | The `+91…` recipient was sent `region: US` and `locale: en-US`; the routing default was closed and is now a pre-create mismatch refusal |
| Public artifacts | None — no sanitized cassette and no public receipt |
| Private artifacts | Private receipt and raw provider artifact remain outside the repository; raw content is never published |
| Classification | Authorized failed attempt and known limitation; **not evidence**; never retried |

---

## R-series stop

The owner-authorized set is exhausted: R4 is recorded; R8 and R3 are failed
attempts. **No later R-series row is authorized.** No new live call is
authorized by this record. R1 and R4 are never re-run; R8 and R3 are never
retried. The release evidence set remains R1 plus R4, with synthetic proofs
and R8/R3 disclosed as limitations.
