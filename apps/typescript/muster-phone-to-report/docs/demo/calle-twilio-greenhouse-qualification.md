# CALL-E-to-Twilio Greenhouse Qualification

This runbook prepares one non-production, listen-only qualification while keeping deterministic
replay dependable. Every displayed result remains `SIMULATED`; even a later PASS proves only the
owned synthetic CALL-E/Twilio lifecycle, not physical hardware or production readiness. Reading or
running the non-calling steps below authorizes no external action.

## 1. Non-calling verification

Use Node `24.18.0` and pnpm `11.20.0` exactly. Before requesting any live authorization, run:

```text
node --version
corepack pnpm --version
corepack pnpm simulator:verify-live-demo-readiness
corepack pnpm verify:foundation
corepack pnpm simulator:live-smoke:prepare:verify
```

The readiness and aggregate gates must pass with the privacy-safe contract, focused unit and
integration tests, disposable PostgreSQL/pg-boss/loopback composition, browser UAT, fresh
production artifact and import-graph exclusion, deterministic replay, formatting, lint, types,
build, Prisma, policies, supply-chain audit, and diff checks included.

For `simulator:verify-live-demo-readiness`, `replayReady` reports whether current checkout-bound
deterministic replay evidence passes. `ready` is an exact compatibility alias of `replayReady`.
`liveReadiness: "NOT_ASSESSED"` remains separate because this provider-free verifier has no live
recording capability. It also reports `evidenceClass: "LOCAL_PROVIDER_FREE"`,
`authorizesCall: false`, `callAuthorization: "NONE"`, and `runGate: "CLOSED"` on every path.

The final command exercises the real pure ten-probe preflight orchestration with deterministic
injected probes behind a provider-free source and runtime isolation boundary. A passing summary
must report `evidenceClass: "LOCAL_PROVIDER_FREE"`, `liveReadiness: "NOT_ASSESSED"`,
`authorizesCall: false`, `callAuthorization: "NONE"`, and `runGate: "CLOSED"`. Its ten passing
probe-execution records prove only local orchestration and isolation; they are not credential,
database, CALL-E, Twilio, target, tunnel, or live-readiness facts.

Review the five-stage diagnosis in order: `destination_routing`, `transcription`,
`structured_output`, `callback_lifecycle`, and `application_admission`. The earliest unproven stage
wins and later stages remain unassessed. Retain the Phase 2 `RED CONFIRMED` evidence and its narrow
one-second TwiML pause repair; do not reinterpret the regression as provider success.

Synthetic failure contract: `destination_routing` **FAIL** leaves `transcription`,
`structured_output`, `callback_lifecycle`, and `application_admission` **unassessed**.
No observed provider-call records are bundled. A PASS requires the checks below;
this document does not report a past call result.
Historical success or failure never establishes present live-recording readiness.

This repair authorizes no live Twilio or CALL-E action, credential resolution, tunnel, provider
capability, provider mutation, deployment, requalification, or external network call.

If any non-calling check is missing, stale, skipped, or failed, stop. This section permits no
credential access, tunnel startup, Twilio mutation, call, deployment, publication, submission, or
push.

## 2. Deterministic replay rehearsal

In Simulator Lab, deterministic replay is selected by default. Generate and rehearse the normal
revision-2 fixture:

Deterministic replay is the provider-free default, and its evidence is not provider success.

```text
corepack pnpm generate:simulator-demo
corepack pnpm --filter @muster/web build:demo
```

Open the local `simulator.html`, run `Replay simulated scenario`, and confirm visible `SIMULATED`
provenance, source evidence before interpretation, and four reconciled zones. Replay uses no live
POST, credential, tunnel, CALL-E provider, or Twilio dependency.

## 3. Fresh live authorization boundary

Stop after rehearsal. A live attempt requires fresh explicit authorization in a later turn for
exactly one eligible normal revision-2 non-production run. The approval must bind the one-use
authorization, exact target semantics, expiry, concurrency one, one provider dial, zero provider
retry/redial, zero post-reservation application retry, and zero DTMF.

Any future live qualification requires fresh explicit authorization in a separate later turn.

Do not inspect credentials, start a tunnel, alter Twilio, construct the live provider, or run the
guarded activation until that separate approval is present. Prior attempts, this document, passing
tests, and a displayed command provide no authorization.

The operational `corepack pnpm simulator:live-smoke:prepare` command is intentionally absent from
this provider-free checklist. Unlike `simulator:live-smoke:prepare:verify`, it resolves the
configured live-smoke boundary and performs real read-only store, credential-reference, CALL-E,
Twilio, target, origin, and safety probes. It remains a later live-workflow prerequisite and was not
run by the provider-free verifier. Even an operational prepare PASS leaves the run gate closed and
does not authorize a call; fresh explicit operator confirmation is still required immediately
before provider construction and the one-call sequence.

## 4. One-call PASS or FAIL review

Evaluate the newly authorized run once, keyed by the durable operation ID. PASS requires all of
the following:

- exactly one consumed authorization, exactly one application dispatch, and exactly one
  reconciled Twilio call;
- signed voice, canary, and status callbacks, a CALL-E terminal fact, zero DTMF, and correctly
  ordered lifecycle evidence;
- admitted transcript evidence held in custody before interpretation, one EvidenceRecord, one
  Observation, and exactly four grounded Readings with exact-zone reconciliation;
- the exact heading `Live simulated observation complete`, the same operation ID, persistent
  `SIMULATED`, and transcript evidence rendered before the four Readings;
- hosted-Reject restoration, runtime-secret revocation, terminal quiescence, callback grace, and
  owned-resource cleanup all verified.

Anything less is FAIL. A timeout, conflict, missing fact, unsafe value, or uncertain reconciliation
remains result-free and grants no retry or redial. Do not activate the control again.

Nothing in this runbook claims live success or authorizes retry or redial.

Routine review material may include only allowlisted stage codes, aggregate facts, the operation ID,
and opaque references. Do not place credentials, phone values, permits, provider identifiers,
provider response bodies, retained source text, or protected custody content in logs, screenshots,
Git, or browser payloads.

Routine artifacts are limited to allowlisted lifecycle states, aggregates, the opaque operation ID,
and opaque references. Routine artifacts exclude targets, phone values, credentials, payloads,
transcripts, raw provider identity, and cleanup owner digests.

## 5. Restoration, revocation, and cleanup

Close the run gate first. The guarded run action normally invokes its cleanup owner itself. After
an interrupted guarded operator process, rerun that same guarded cleanup path from the configured
live-smoke environment with this exact root command (package-local equivalent:
`corepack pnpm --filter @muster/simulator-host live-smoke:cleanup -- --operation
<opaque-operation-id> --previous-owner-stopped`):

```text
corepack pnpm simulator:live-smoke:cleanup -- --operation <opaque-operation-id> --previous-owner-stopped
```

This command is part of a separately authorized live workflow because it can restore Twilio; it is
not a non-calling verification command. Use `--previous-owner-stopped` only after positive operator
confirmation that the prior guarded process is stopped. The cleanup owner enforces this order:

1. Keep the run gate closed.
2. Commit the durable dispatch fence / causal barrier.
3. If dispatch was accepted, observe the exact callback-bound inbound arrival.
4. Observe a supported terminal status.
5. Complete the persisted trailing grace and a final same-terminal observation.
6. Claim restoration exactly once.
7. Update hosted `<Reject/>` routing and verify the read-back.
8. Revoke runtime secrets.
9. Stop the host.
10. Stop and acknowledge the exact owned tunnel.
11. Mark durable cleanup complete.
12. Tear down owned persistence last.

Proven zero-dispatch after the atomic fence skips inbound polling. The successful dispatched path
includes the callback grace and revokes the runtime-secret capability; it must stop the host before
the owned tunnel. Only owned resources are eligible for cleanup.

A blocked or `manual_stop_required` result retains the reconciliation resources it names and is
never successful cleanup. Interrupted cleanup requires the explicit opaque operation ID and the
confirmed stopped-owner flag. `restoration_started` recovery performs read-back only and never
issues a second update. No latest-row lookup, raw provider identity input, PID discovery, retry,
redial, or implicit assume-no-dispatch switch is permitted.

The later authorized tunnel startup must retain its exact `$ngrokProcess` object and capture
`$ngrokExecutablePath = $ngrokProcess.Path` plus
`$ngrokStartedAt = $ngrokProcess.StartTime`. Cleanup never trusts an environment PID. When the
guarded command prompts for manual tunnel shutdown, verify and stop only that retained object:

```powershell
$ngrokProcess.Refresh()
if ($ngrokProcess.Path -ne $ngrokExecutablePath -or $ngrokProcess.StartTime -ne $ngrokStartedAt) { throw "ngrok process ownership mismatch" }
if (-not $ngrokProcess.HasExited) { Stop-Process -InputObject $ngrokProcess -ErrorAction Stop; $ngrokProcess.WaitForExit() }
$ngrokProcess.Refresh()
if (-not $ngrokProcess.HasExited) { throw "owned ngrok process did not stop" }
```

Only after those identity and exit checks pass may the operator type exactly
`I STOPPED THE OWNED NGROK PROCESS`. Until then cleanup must remain
`manual_stop_required` with `hostStopped: true` and `tunnelStopRequired: true`; that result is
FAIL, leaves persistence available, and never permits cleanup to be claimed complete. The host is
already stopped before the tunnel prompt. If retained-object identity is missing or uncertain, do
not stop any process by PID and do not acknowledge the prompt.

If restoration, read-back, reconciliation, revocation, or cleanup is uncertain, report FAIL, keep
the gate closed, and retain the minimum necessary owned resources for safe reconciliation. Never
claim cleanup complete from intent alone.

## 6. Immediate replay fallback

If live mode is unavailable, unapproved, in progress, failed, consumed, or unsafe, return to
deterministic replay immediately and repeat section 2. Preserve the visible `SIMULATED` designation
and the same evidence-before-interpretation ordering. Replay evidence is not live provider evidence
and must never be presented as a qualification PASS.
