# Known limitations

What this build does not do, stated plainly. Absent rows are never shown as
impact evidence and never montaged into a "planned" reel; they are listed
here because a limitation named is a limitation a judge can weigh.

The R-series statuses below are mirrored by the machine-readable registry in
`warrantyops/cassettes.py` (tests check the two against each other). The
public forms are `docs/evidence-table.md` (one evidence class, one command,
one expected result per executed row; planned rows only as limitations),
`docs/platform-surface-map.md` (what the integration uses of CALL-E and
what is unknown), and `docs/why-the-phone.md` (verbatim public sources for
the job this serves). The deployment boundary is `docs/adapter-contract.md`
(the DMS/ERP integration is planned, not built), and the reproduction state
is `proof/independent-run.md` (no third party has run it).

## Evidence rows (the R-series)

- **R1, R3, and R4 are the recorded runtime evidence.** R1 is an authorized,
  consenting role-play call; its receipt is sanitized, its raw artifacts live
  outside the repository, and no cassette is reconstructed from the receipt.
  R3 is a live post-routing-fix call: transport completed, person reached
  (18-turn counterparty transcript), agent held the claim-status inquiry, but
  the callee did not produce claim-status information, so `claim_status` is
  honestly `UNKNOWN`; write-back withheld. Its sanitized cassette is
  replayable and its raw artifacts remain private. R4 is an authorized
  owned-number no-answer call with one create, zero retries, no person
  reached, and `UNKNOWN` status; its sanitized cassette is replayable and its
  raw artifacts remain private. No recorded row is ever re-run.
- **R2 is never executed live.** Its synthetic counterpart is a mandatory
  software proof (FakeCalle), as are the synthetic counterparts of R3–R7.
- **R8 was an authorized attempt, not evidence.** It made one provider
  create with zero retries; it ended in a zero-duration `404` that surfaced
  as `call_failed`, with no transcript, no person reached, `UNKNOWN` status,
  and write-back withheld. The `+91…` attempt was sent `US`/`en-US` routing,
  now fixed, but the cause cannot be independently proven from the available
  data. Its raw artifacts remain private; no public cassette or receipt is
  published; it is not retried. Subsequent R8b attempts on 13 September
  (2026-09-13) also failed with `404` (carrier unreachable), `408` (timeout,
  no ring), and `500` (CALL-E server error) — infrastructure failures, not
  product failures.
- **R5–R9 other than R8 remain owner-optional and not executed.** Their
  absence does not block product completion. The R-series is stopped; no
  further live row is authorized. R7 with a different body under the same
  key remains forbidden, and R1/R4 are never re-run.
- **D1 (successful field acceptance with a warranty professional) is not
  performed.** The R8 attempt failed before a conversation began and is a
  limitation, not field acceptance.

## Product surface

- **No Goal-as-primary support.** Goal capability is probe-gated by design;
  the deterministic CALL-E task path is the only primary. The eight-error
  transport mapping and the capability probe are implemented
  (`warrantyops/goal_runs.py`, pinned by `tests/test_goal_runs.py`), but no
  real GoalRun payload has ever been run through the probe — none is
  recorded — so the published conclusion stands: Goal Runs are not proven
  capable, and the GoalRunError enum serves as a failure-enum comparator
  only.
- **No webhook ingestion.** Outcomes come from reads (`calls.get`); webhook
  events are, at most, a hint to read sooner. Non-authoritative by
  construction.
- **No runtime failover.** Provider selection happens at preflight /
  configuration time only; after `calls.create` there is no switching — an
  uncertain outcome is a human reconciliation, not a second dial.
- **No DMS/ERP connector, no dashboard, no chase ladder, no campaign, no
  retry ladder, no settlement, no adjudication, and no recovered-money
  claim.** The product asks one question and returns one answer.
- **The loopback review surface is a single-operator local tool.** It binds
  127.0.0.1/localhost/::1 only (`warrantyops/review_service.py` refuses any
  other host at `make_server`), serves one registered review at a time,
  requires the CSRF double-submit pair plus a same-origin check on every
  decision POST, and journals decisions to a hash-chained local record — but
  it has no authentication of its own beyond the loopback bind and no TLS,
  so it must never be proxied or forwarded. The in-process decision path
  remains available and idempotent.
- **English only.** Scripts, identifiers and grounding are English; locale
  plumb-through exists in the request shape but nothing is localized.
- **International routing had a closed defect.** The first `+91…` attempts
  used inherited `US`/`en-US` metadata. The adapter now derives an
  allowlisted destination pair and refuses a mismatch before creation.

## Toolchain

- **pytest 8.4.2 carries `PYSEC-2026-1845`** (predictable
  `/tmp/pytest-of-{user}` directories; local DoS or privilege gain). The fix
  (9.0.3) requires Python ≥ 3.10; the kernel's compatibility floor is 3.9,
  so the advisory is accepted for this dev-only, never-shipped dependency
  (`audit-requirements.txt`, `SECURITY.md`).
- **The pinned Python 3.9 environment cannot remediate the 2026 advisory
  wave** in its own tooling: fixed versions of `requests`, `urllib3`,
  `filelock`, `msgpack`, `pip`, and one `setuptools` advisory all require
  Python ≥ 3.10. None of those packages is a dependency of this project
  (runtime dependencies are zero; the audited dev set passes), and none
  ships with anything WarrantyOps produces.
- **The SDK's own interpreter floor (3.11) exceeds the kernel's (3.9).** The
  live extra is installable only where the SDK can run; the kernel and every
  offline gate are SDK-free and run on 3.9.

## Deliberate non-features

These are choices, not gaps:

- The vendor's idempotency replay is defence-in-depth, never a control this
  package relies on; duplicate suppression is local and primary.
- Two statements of dead-defensive code in `warrantyops/identifiers.py`
  (lines 260 and 381) are intentionally left uncovered by tests rather than
  pragma'd away: exact-match confirmation makes them unreachable, and
  deleting them is a refactor for a quiet day, not for a coverage number.
