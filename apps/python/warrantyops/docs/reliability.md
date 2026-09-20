# Reliability: what fails, what happens, what proves it

This document is the prose half of the fault matrix; the rows live in
`tests/test_fault_matrix.py` and `tests/test_concurrency.py`, and each entry
below names the test that proves it. The invariant underneath every row is
the same: **an attempt is never silently retried, the durable reservation
survives whatever happened, the recorded state says exactly what is and is
not known, and a human is told when only a human can settle it.**

## Crash and fault matrix (F4)

| Fault injected | Observed behaviour | Proof |
|---|---|---|
| Provider fails before the call is created | Reservation persists as `UNKNOWN`; every later run under the same key refuses `DUPLICATE_CALL_SUPPRESSED`; zero further provider interactions | `test_provider_fails_before_creation_marks_unknown_and_never_retries` |
| Provider fails after creation, call id already persisted | Reservation `UNKNOWN` **with** the vendor call id attached, so recovery can re-read without dialing | `test_provider_fails_after_creation_leaves_unknown_with_the_call_id` |
| The call-id persistence itself fails | Run raises `AttemptReconciliationRequired`; the reservation is retained; nothing pretends the attempt is known | `test_call_id_persistence_failure_requires_human_reconciliation` |
| Provider returns a non-terminal result | Terminal state `IN_FLIGHT`; reservation `UNKNOWN`; replay suppressed | `test_a_non_terminal_return_is_in_flight_and_unknown` |
| Provider returns an invalid structured result | Terminal `RESULT_INVALID` (a named finding, never a silent pass) | `test_an_invalid_result_classifies_result_invalid` |
| Corrupt ledger file | Open refuses immediately; no call exists when it refuses | `test_a_corrupt_ledger_file_fails_closed_before_any_call`, `test_opening_a_corrupt_ledger_file_refuses_immediately` |
| Busy / locked ledger | Run refuses `ATTEMPT_LEDGER_UNAVAILABLE` before any provider interaction | `test_a_busy_locked_ledger_refuses_the_run` |
| Ledger written by a newer schema | Refused (`schema_version` is forward-only; never guessed) | `test_a_ledger_from_the_future_is_refused` |
| Ledger cannot record an uncertain outcome | Escalates to `AttemptReconciliationRequired` instead of marking success | `test_a_ledger_that_cannot_record_uncertainty_escalates_to_a_human` |
| Any of the above | The hash-chained audit log stays verifiable: no row lies about what happened | `test_every_fault_row_keeps_the_chain_verifiable` |

Restart behaviour is the recovery path, not a redial: a reservation left
`UNKNOWN` with a call id is settled by
`python -m warrantyops --recover-runtime-result`, which performs exactly one
`calls.get` against the stored id, never creates, and rewrites the sanitized
receipt atomically
(`test_recovery_reads_the_stored_call_exactly_once_and_never_creates`,
`test_a_duplicate_execution_is_suppressed_locally`). A reservation `UNKNOWN`
without a call id has nothing to re-read and refuses `NO_CALL_ID_TO_RECOVER`
(`test_recovery_without_a_stored_call_id_refuses_safely`).

## Concurrency (F3)

N real operating-system processes race one SQLite ledger against the same
`(claim, source_version, authorization)`: exactly one creates, everyone else
refuses `DUPLICATE_CALL_SUPPRESSED`, and zero extra calls exist afterwards.

| Property | Proof |
|---|---|
| N concurrent processes, exactly one call | `test_concurrent_processes_place_exactly_one_call` |
| The ledger afterwards holds one settled attempt, not N fragments | `test_the_ledger_after_the_race_holds_one_settled_attempt` |
| The audit chain afterwards has one reservation and still verifies | `test_the_audit_chain_after_the_race_has_one_reservation_and_verifies` |
| A sequential rerun is suppressed the same way | `test_a_sequential_rerun_is_also_suppressed` |

The race tests spawn real subprocesses (`python -m warrantyops` against one
`--ledger-db`), not threads, so the guarantee is about processes competing
for the file, which is the deployment shape.

### SQLite configuration, per OS

Set in `warrantyops/ledger.py`, identical on every platform (the pragmas are
properties of the database file and connection, not of the host):

- **Journal mode `WAL`** (`PRAGMA journal_mode = WAL`) — lets a reconciler
  read while a writer holds the write lock. WAL is stored in the database
  file, so a ledger moved between operating systems keeps its mode.
- **`busy_timeout = 5000`** — a contender waits up to five seconds for the
  write lock before surfacing `AttemptLedgerUnavailable` (which fails closed;
  see the fault matrix) instead of erroring instantly under contention.
- **`BEGIN IMMEDIATE`** around reservation writes — the check-then-insert of
  a reservation is one serialized transaction, which is the mechanism behind
  "exactly one wins" in the race tests.

### Windows notes

The suite uses `subprocess` (fresh interpreters), not `multiprocessing`, so
Windows `spawn` semantics never affect it: every child process starts from a
clean import of `warrantyops` on all platforms. Paths flow through
`pathlib.Path` throughout; no POSIX-only string surgery appears in the
kernel or the tests.

## Where the guarantees come from

The ledger is the primary control and the vendor's idempotency replay is
defence-in-depth only — nothing in this package relies on it or exercises
it. The durable schema, the hash-chained event log it projects from, and the
state vocabulary (`RESERVED` / `COMPLETED` / `UNKNOWN`) are documented in
`docs/state-machine.md` and `docs/refusals.md`, both generated from the live
enums (`make docs` fails if either drifts).
