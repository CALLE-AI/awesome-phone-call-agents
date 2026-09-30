# Public technical context

Use the repository-pinned Node.js and pnpm versions. The normal demonstration
requires only static replay assets after installation and build. The complete
test suite uses disposable local PostgreSQL and injected provider boundaries.

## Disposable database ownership

The helper uses a 30-second, one-shot Docker create and does not automatically
retry creation. Recovery compares exact-name and session-label snapshots taken
at least 10 seconds apart. The owner token is checked in suppressed inspect
output and never placed in process arguments. Persist exact container proof
before `docker rm`; make a final absence check before removing lifecycle state.

Retain `cleanup_required` until supported dispose recovery completes. A dispose
retry must never manually delete protected recovery state and must never start
another session as a workaround. Complete recovery source closure is checked
against exact capability counts so helper imports do not bypass restrictions.

Provider-free verification has zero provider capability and does not authorize a
call. Its fixture-bound subprocess checks use exact arguments, a fixed working
directory, an empty environment, a timeout, and suppressed output. Any
exact benign environment bridge for CommonJS tooling remains constrained to the
allowlisted fixture; it is not a route to ordinary process environment access.

These constraints are tested in the database helper, subprocess verifier, and
architecture suites. No protected runtime material is required in this repository.
