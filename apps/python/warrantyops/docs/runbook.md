# Operations runbook

Every procedure starts from a named refusal or state — the exact vocabulary
the system emits, generated into `docs/refusals.md` and
`docs/state-machine.md` — and names the test that proves the kernel behaves
as this procedure assumes. None of these procedures redials. The one-call
guarantee survives every one of them.

## 1. Reconcile an attempt left `AttemptState.UNKNOWN`

**Starting state:** a ledger row whose `state` is `UNKNOWN` (the fault matrix
in `docs/reliability.md` lists every way to get here).

1. Read the row: `SqliteAttemptLedger(path).rows()` shows `state`, `call_id`,
   and timestamps. The row exists precisely because the run could not prove
   what happened; do not assume.
2. If `call_id` is present, run
   `python -m warrantyops --recover-runtime-result --ledger-db PATH`.
   This performs exactly one `calls.get` against the stored id, classifies the
   payload through the same terminal state machine, and rewrites the
   sanitized receipt atomically. It never creates a call and never touches
   the reservation.
3. If `call_id` is absent the attempt refuses `NO_CALL_ID_TO_RECOVER`:
   there is nothing to re-read. A human decides from the operator's own
   records (provider dashboard, call log) and records the decision; the
   reservation stays `UNKNOWN` forever, which is correct — it is not
   knowledge.
4. Whatever the outcome, the reservation is **never** released and the claim
   is **never** redialled under this key. If a genuinely new question arises,
   it arrives as a new source version and derives a new key.

**Kernel guarantee + proof:** recovery reads once and never creates
(`test_recovery_reads_the_stored_call_exactly_once_and_never_creates`); the
missing-id refusal (`test_recovery_without_a_stored_call_id_refuses_safely`);
a duplicate run is suppressed locally
(`test_a_duplicate_execution_is_suppressed_locally`); an `UNKNOWN`
reservation blocks retry after a crash
(`test_provider_fails_before_creation_marks_unknown_and_never_retries`).

## 2. Wrong number / recipient complaint

**Starting state:** any indication the call reached the wrong person, or a
recipient asks to stop.

1. **Stop.** Do not call back "to fix it". The reservation for that
   `(claim, source_version, authorization)` already suppresses every future
   attempt under the key; a redial would need a deliberately new
   authorization, and the operator's answer to this state is to withhold one.
2. **Audit.** Pull the event log (`--metrics` on a scenario run shows the
   structured events; the durable chain is read with
   `SqliteAttemptLedger(path).audit_events()`). Record what was asked and
   what the recipient said.
3. **Disclose.** The call script already identifies the caller and purpose
   (the disclosure gate refuses agent turns that promise, commit, or
   adjudicate); the follow-up with the affected person states what data was
   processed and why.
4. **Delete on request** per `docs/data-handling.md`: run the purge for the
   private artifacts involved. Deletion removes private evidence; it never
   rewrites the ledger or historical claims.

**Kernel guarantee + proof:** one attempt per key, enforced before the
provider (`test_one_shared_ledger_two_executions_one_total_interaction`);
ledger state survives restarts (`test_two_sqlite_instances_on_one_database_
permit_one_interaction`); purge never touches the ledger
(`test_purge_deletes_only_expired_owned_files_and_never_the_ledger`).

## 3. API-key rotation and the absent key

**Starting refusal:** `MISSING_API_KEY` (from `ConfigRefusal`) — no create
path exists without a key; or `AUTHENTICATION_REFUSED` from the probe.

1. Rotate the key at the provider; the only integration point is the
   environment variable `CALLE_API_KEY`. Never a command line, file in git,
   or log line.
2. Verify with the zero-dial probe:
   `python -m warrantyops --probe-auth` reads a deterministic known-
   nonexistent call id and expects `AUTHENTICATED_NOT_FOUND` — one `calls.get`,
   zero creates.
3. With no key in the environment, every live path refuses
   `MISSING_API_KEY` **before any client is constructed**. Dry-run scenarios
   are unaffected: they never read the key at all.

Rotation changes no stored state: the idempotency key is derived from the
authorization record reference and claim identity, not from the API key, so
existing reservations and receipts remain valid.

**Kernel guarantee + proof:** absent key refuses without printing a value
(`test_preflight_with_a_missing_api_key_refuses_without_printing_a_value`);
the probe never creates (`test_the_probe_reads_a_nonexistent_call_and_never_
creates_one`); authentication errors refuse
(`test_the_probe_treats_an_authentication_error_as_a_refusal`).

## 4. Private-artifact purge

**Starting point:** operator decision or retention expiry — private
artifacts (sanitized runtime receipts) live in `WARRANTYOPS_ARTIFACT_DIR`,
outside the repository, directory 0700, files 0600.

1. `python -m warrantyops --purge-artifacts` deletes receipts older than the
   90-day retention floor (`--retention-days N` to override). Only the two
   files this package can write — the receipt and its orphaned temporary —
   are ever considered; an operator's other material in the directory is
   untouchable.
2. Published receipts and the proof screen are repository artifacts and are
   **not** touched by a purge.
3. The attempt ledger is not part of the operation: historical claims are
   never rewritten, and a purged run's reservation still suppresses redials
   exactly as before.

**Kernel guarantee + proof:** `test_purge_deletes_only_expired_owned_files_
and_never_the_ledger`, `test_purge_retains_receipts_inside_the_window`,
`test_purge_refuses_a_missing_or_in_repository_artifact_dir`.

## 5. Ledger corruption or a missing database

**Starting refusal:** `ATTEMPT_LEDGER_UNAVAILABLE` — the ledger is missing,
unreadable, busy beyond the timeout, or written by a newer schema.

1. The system has already failed closed: no call is placed when the ledger
   cannot be read or written. Do not "work around" it by deleting the ledger
   to force a fresh one — that converts a suppressed history into a
   redial risk.
2. Diagnose: a corrupt file refuses at open
   (`test_opening_a_corrupt_ledger_file_refuses_immediately`); a
   future `schema_version` refuses rather than guessing
   (`test_a_ledger_from_the_future_is_refused`) — upgrade the package, never
   downgrade the data.
3. A genuinely lost ledger (disk gone) means duplicate suppression is lost
   for the keys it held. Reconcile against the provider's own call history
   before authorizing anything new, and treat any ambiguity as
   `AttemptState.UNKNOWN`: human decision, never a redial.

**Kernel guarantee + proof:** missing ledger refuses before any provider
interaction (`test_a_missing_ledger_refuses_before_any_provider_interaction`);
unreadable fails closed (`test_an_unreadable_ledger_fails_closed`); SQLite
failures surface as unavailable, never as success
(`test_sqlite_failures_surface_as_unavailable_never_as_success`).

## 6. Global kill switch

**Starting refusal:** `LIVE_NOT_ENABLED` (from `ConfigRefusal`) — the
default state. Live calling requires `CALLE_LIVE_CALLS_ENABLED=1` **and**
the confirm-phrase and consenting-recipient flags; unset or any other value
means dry run.

1. To stop all live calling: `unset CALLE_LIVE_CALLS_ENABLED`. Execution
   then refuses `LIVE_NOT_ENABLED` at its **entry** gate — before any client
   is constructed and before the idempotency key is reserved, so a switch-off
   attempt burns nothing. The provider seam re-enforces the same refusal
   immediately before `calls.create` (defence in depth).
2. The read-only paths — the authentication probe and recovery — dial
   nothing and are gated on key presence instead; the switch's job is to
   prevent calls, and neither path can create one. Synthetic scenarios never
   consult the switch at all.
3. The switch is one of four independent refusals on the live configuration
   (`live_call_refusals`): the others are `MISSING_API_KEY`,
   `UNOFFICIAL_ORIGIN`, and the artifact-directory path checks. Any one of
   them refuses.

**Kernel guarantee + proof:** an unset switch refuses before the key is
reserved (`test_an_unset_kill_switch_refuses_before_reserving_the_key`);
the environment gates refuse before any client exists
(`test_live_execution_refuses_before_any_client_on_any_missing_requirement`);
dry run is the default and live needs every gate
(`test_dry_run_is_the_default_and_live_needs_every_gate`); scenario runs are
unaffected (the entire `tests/test_dry_run.py` family runs with no live
environment).
