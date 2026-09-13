# Hackathon Live CALL-E Observation Demo

This is a non-production, `SIMULATED` demonstration. Deterministic replay is the
provider-free judging path. No observed provider-call records are bundled.
A successful non-production synthetic observation requires one complete EvidenceRecord,
one complete Observation, four grounded Readings, one matching completed Twilio call,
and zero DTMF. These are requirements, not evidence of an executed call.
Historical success or failure never establishes present live-recording readiness.
Replay does not establish Sensaphone hardware behavior, native-alarm coexistence,
production readiness, or physical-device compatibility.

## Safety boundary

This repository handoff authorizes no external call, credential read, tunnel exposure, deployment, publication, or submission. The guarded process requires a fresh explicit confirmation after a passing preflight and immediately before lazy provider construction, Twilio arming, permit minting, reservation, and the single potentially billable dispatch. Automatic retry and DTMF are forbidden.

Raw transcript text, audio, phone values, permits, credentials, provider identifiers, and provider payloads stay outside Git. Git contains authored synthetic fixtures only. No recorded attempt grants authorization for a new call.

## Recording modes

Choose one mode before capture; its instructions do not authorize the other mode.

- **Provider-free deterministic rehearsal and recording** uses only the generated replay and local
  readiness checks. In this mode, leave live mode uninvoked, do not inspect credentials, do not
  start a tunnel, and do not mint a permit or expose a target.
- **Separately authorized live recording** is optional and is not authorized by this repository
  handoff. It requires a fresh passing preflight, fresh explicit operator confirmation, current
  provider and target authorization, and the guarded one-call process immediately before any
  dispatch. Provider-free rehearsal results never satisfy those prerequisites.

## Setup

1. Use exactly Node.js `24.18.0`, pnpm `11.20.0`, and a running Docker-compatible engine.
2. Install with the frozen lockfile: `corepack pnpm install --frozen-lockfile`.
3. Keep deterministic replay available: `corepack pnpm generate:simulator-demo`.
4. Build and preview the deterministic demo locally using the commands in `docs/demo/transparent-device-simulator.md`.
5. For provider-free deterministic rehearsal or recording, leave live mode uninvoked. Do not inspect
   or copy `.env`, start a tunnel, mint a permit, or expose a target.

## Provider-free deterministic rehearsal and recording

Run:

```text
corepack pnpm simulator:verify-live-demo-readiness
corepack pnpm vitest run tools/simulator/verify-live-demo-readiness.test.ts tests/e2e/hackathon-live-calle-observation.integration.test.ts --config vitest.workspace.ts
corepack pnpm generate:simulator-demo
corepack pnpm --filter @muster/simulator-host build
corepack pnpm simulator:live-smoke:prepare:verify
```

The readiness command runs environment-allowlisted, loopback-only focused verification and records machine-readable evidence bound to the current Git HEAD, a canonical digest of all applicable tracked and untracked worktree content, Node `24.18.0`, and pnpm `11.20.0`. Generated evidence, Git metadata, dependencies, build/cache/log output, and ignored local credential or protected-capture material are excluded without reading their contents. The command then consumes that evidence; missing, stale, failed, skipped, or wrong-toolchain evidence fails closed. The focused verification performs a fresh production artifact scan with production environment-file loading disabled, checks the disposable local composition and independent oracle proof, checks recovery lineage, and validates the handoff artifacts. It does not invoke CALL-E/Twilio, read credentials, open a tunnel, deploy, publish, or submit.

`replayReady` reports whether current checkout-bound deterministic replay evidence passes. `ready`
is an exact compatibility alias of `replayReady`. `liveReadiness: "NOT_ASSESSED"` remains separate
because provider-free verification cannot establish present live-recording readiness. Every result
also reports `evidenceClass: "LOCAL_PROVIDER_FREE"`, `authorizesCall: false`,
`callAuthorization: "NONE"`, and `runGate: "CLOSED"`.

Disposable local composition uses disposable PostgreSQL, pg-boss, the real simulator host, the bounded client, an injected local provider, and loopback-only HTTP. Its result remains `SIMULATED`.

The provider-free prepare verification is narrower: it executes the real pure ten-probe
orchestration with deterministic injected probes while a static/transitive source policy and an
independent runtime audit deny credential, database, network, listener, provider, authorization,
task, call, retry, and redial capabilities. PASS means only `LOCAL_PROVIDER_FREE` orchestration and
isolation evidence. It reports live readiness `NOT_ASSESSED`, call authorization `NONE`, and the run
gate `CLOSED`; it neither replaces the operational prepare in the historical runbook below nor
authorizes any live step.

## Disposable database for a guarded demo

The guarded demo requires an exclusive, temporary PostgreSQL database. Build the simulator host,
start the repository-owned helper, and dot-source the generated activation script in the same
PowerShell that will run later checks:

```powershell
corepack pnpm --filter @muster/simulator-host build
corepack pnpm simulator:live-demo:database:start
. .\.generated-tmp\live-demo-database\activate.ps1
corepack pnpm simulator:live-smoke:prepare:verify
```

The start command uses one 30-second, one-shot Docker create with no automatic create retry. It
creates one pinned, loopback-only container, seals its database ownership before applying committed
migrations, and prints only a fixed success line plus the absolute activation-script path. The
ignored `.generated-tmp/live-demo-database/` files contain credentials and independent deletion
proof: do not display, copy, edit, commit, or relocate them. The provider-free verification and
database helper have a zero-provider budget—zero provider constructions, zero external calls, and
zero calls—and do not authorize a call, assess live credentials, open the run gate, or replace the
later operational preflight.

After any separately authorized guarded run, allow guarded cleanup to finish first because it may
drop the attested database. Then remove the independently proven container and local activation
material:

```powershell
corepack pnpm simulator:live-demo:database:dispose
```

The dispose command is retry-safe when the guarded cleanup already deleted the exact database. A
terminal Docker create without a usable CID retains `cleanup_required`; a later dispose retry may
reconcile only that durable intent. Recovery compares exact-name and full non-secret session-label
Docker snapshots at least 10 seconds apart. The secret owner token is checked only in suppressed
exact inspect output and is never placed in process arguments, selector filters, routine output, or
errors. A stable exact singleton must pass strict inspection and persist exact container proof
before `docker rm`; stable absence removes only the two fixed pre-create transients and performs a
final exact absence recheck immediately before exact lifecycle state removal. Any unavailable,
malformed, conflicting, or changing result remains `requires attention`.

If either command reports `requires attention`, preserve `cleanup_required` and run dispose as a
retry only after the external state has settled. Never manually delete the protected recovery state
or container, never start another session, and never substitute a database name, URL, or container
ID as ownership proof. Preserve the fixed directory for exact recovery and stop before any live
step.

## Guarded one-call qualification runbook (optional; fresh authorization required)

This section records the path used for the consumed qualification attempt; it is not authorization
to repeat any step or place another call. Store only runtime
secret references for CALL-E, Twilio, target authorization, identity hashing, and permit signing;
never paste values into commands, logs, Git, screenshots, or URLs. TLS terminates at ngrok, so the
approved short-lived ngrok edge is part of the trusted base for this synthetic-only exercise. Keep
ngrok request capture and replay disabled.

1. In **Twilio Console → Phone Numbers → Manage → Active numbers**, select only the owned
   synthetic-only number. First create a hosted TwiML Bin whose complete body is
   `<Response><Reject reason="rejected"/></Response>`. In the number's Voice Configuration set
   **A call comes in** to **Webhook**, paste that hosted `<Reject/>` TwiML Bin URL, set
   **Voice request method = `POST`**, ensure the **Status callback URL is empty**, and save. Never
   enter a physical Sensaphone or production destination. Set `TWILIO_RESTING_REJECT_URL` to the
   same non-secret hosted Bin URL. The prepare command below performs the exact read-only API
   read-back: `voice_url` must equal that URL and `status_callback` must be empty/null. Do not arm
   `/twilio/voice`, `/twilio/canary`, or `/twilio/status` yet.
2. Deploy the committed migrations with `corepack pnpm prisma:migrate:deploy`, build the guarded
   host with `corepack pnpm --filter @muster/simulator-host build`, then start the already-installed
   ngrok executable from PowerShell as one short-lived operator-owned process (do not install or
   configure another tunnel service):

   ```powershell
   $ngrokProcess = Start-Process -FilePath "ngrok" -ArgumentList @("http", "43111", "--inspect=false") -PassThru
   $ngrokExecutablePath = $ngrokProcess.Path
   $ngrokStartedAt = $ngrokProcess.StartTime
   ```

   `--inspect=false` disables ngrok request inspection/body capture and replay for this tunnel. Copy
   only its temporary HTTPS origin into `SIMULATOR_PUBLIC_BASE_URL`; never put credentials, phone
   values, targets, or authorization tokens in that URL. Set runtime secret-file references only in
   the outer host environment, including `CALLE_API_ORIGIN` exactly equal to
   `https://api.heycall-e.com`. Do not print resolved values.

3. Run `corepack pnpm simulator:live-smoke:prepare`. The package-local equivalent is
   `corepack pnpm --filter @muster/simulator-host live-smoke:prepare`. It prints one redacted JSON
   preflight result and performs read-only PostgreSQL,
   custody, gate/kill-file, CALL-E account, Twilio number read-back, exact-origin, secret-reference,
   ngrok-attestation, identity, trace/signature, and production-exclusion probes; boolean
   self-attestation is not accepted. The **Live-smoke preflight** must show
   **Run gate: CLOSED**, a healthy **Emergency stop**, exact-origin signature validation, durable
   stores, exact target authorization, first-callback caller binding capability, and production
   absence as PASS. CALL-E may rotate its outbound caller identity; no purchased or predetermined
   CALL-E number is required.
4. Immediately before the one potentially billable call, run
   `corepack pnpm simulator:live-smoke:run -- --scenario synthetic-normal` (package-local:
   `corepack pnpm --filter @muster/simulator-host live-smoke:run -- --scenario synthetic-normal`).
   Run it in a second visible PowerShell launched from the first so the launcher retains the exact
   `$ngrokProcess` object while the guarded process can wait for cleanup acknowledgment:

   ```powershell
   $operatorShell = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-Command", "corepack pnpm simulator:live-smoke:run -- --scenario synthetic-normal") -PassThru
   ```

   At the prompt, type the displayed exact confirmation sentence only after the operator confirms
   the call. This single process starts the strict host with the run gate closed, arms Twilio and
   reads back `/twilio/voice` plus `/twilio/status`, opens the gate, mints and atomically reserves
   one permit, submits one operation, and keeps the no-callback deadline at most 120 seconds and distinct from the
   bounded 180-second provider-terminal watchdog. `simulator:authorize` is disabled and must not be
   used. CALL-E has retry budget zero; call budget and concurrency are one.

5. The voice document uses `actionOnEmptyResult="true"` and ends in Hangup. Validate signatures on
   every callback, atomically learn and bind the caller digest with the target digest and CallSid,
   persist voice/canary/status provider
   facts first, and prove zero digits. Any digit triggers the Emergency stop.
6. Verify the terminal SIMULATED observation in Simulator Lab and Fleet: Operation ID, terminal
   status, DTMF actions `0`, transcript before readings, and Twilio reconciliation `1 matching call`.
   Re-submit the consumed operation and verify the provider call count remains one; display
   **Authorization consumed—no retry**.
7. The run action always invokes its memoized cleanup owner. Cleanup closes the run gate and commits
   the durable dispatch fence first. A claimed dispatch must then produce the exact callback-bound
   inbound arrival, a supported terminal status, and the five-second trailing-callback grace before
   restoration can begin; proven zero-dispatch after the fence skips inbound polling. Ambiguous,
   mismatched, or still-active call state fails closed with the host, tunnel, and reconciliation
   resources retained. To recover cleanup after an interrupted operator process, use the explicit
   opaque operation ID (root command shown first; package-local equivalent shown second):

   ```text
   corepack pnpm simulator:live-smoke:cleanup -- --operation <opaque-operation-id> --previous-owner-stopped
   corepack pnpm --filter @muster/simulator-host live-smoke:cleanup -- --operation <opaque-operation-id> --previous-owner-stopped
   ```

   Use `--previous-owner-stopped` only after positive operator confirmation that the prior guarded
   process is stopped. Recovery never searches for a latest row or accepts raw provider identity;
   `restoration_started` recovery performs read-back only and never repeats the update. After the
   causal barrier, cleanup claims restoration once, restores Twilio to hosted Reject, verifies the
   read-back, revokes runtime secrets, and stops the host. It never accepts or kills an environment
   PID. Only then does the guarded PowerShell ask the operator to stop the exact retained process
   object. In the original launcher PowerShell, verify the same object's executable path and start
   time, stop it by object (not PID), wait, and verify exit:

   ```powershell
   $ngrokProcess.Refresh()
   if ($ngrokProcess.Path -ne $ngrokExecutablePath -or $ngrokProcess.StartTime -ne $ngrokStartedAt) { throw "ngrok process ownership mismatch" }
   if (-not $ngrokProcess.HasExited) { Stop-Process -InputObject $ngrokProcess -ErrorAction Stop; $ngrokProcess.WaitForExit() }
   $ngrokProcess.Refresh()
   if (-not $ngrokProcess.HasExited) { throw "owned ngrok process did not stop" }
   ```

   Return to the guarded PowerShell and type exactly
   `I STOPPED THE OWNED NGROK PROCESS`. The host is already stopped before this prompt; only that
   acknowledgment allows outer persistence teardown. Until then the result is
   `manual_stop_required` with `hostStopped: true` and `tunnelStopRequired: true`; keep the gate
   closed, leave persistence available, and stop only the exact retained tunnel object. A
   failed causal barrier or Twilio restore/read-back never reaches the tunnel prompt and retains
   the reconciliation resources it names. The causal-barrier-first order is dispatch fence, exact
   inbound/terminal/grace when dispatch was claimed, restore/read-back, runtime-secret revocation,
   host stop, owned tunnel stop, then persistence teardown. Its operator-visible tail remains
   **restore/read-back → stop host → stop ngrok**. Remove only the short-lived local ngrok
   attestation after the successful cleanup result.

The three-minute demo spends 30 seconds on preflight and consent, 45 seconds on the single live
round-trip, 75 seconds on signed evidence and Fleet/Simulator provenance, and 30 seconds on replay
proof and restore. Close by saying that this certifies only the listen-only transport/lifecycle path:
`<Say>` does not establish Sensaphone audio fidelity, DTMF remains forbidden, and no physical-device
or production readiness is claimed.

## Separately authorized live recording

Use this path only after its fresh prerequisites and explicit confirmation are satisfied. If they
are not, use the provider-free deterministic recording path instead. Never run these live steps as
part of rehearsal or automated verification.

## Recording-safe Demo Review timed handoff

Target runtime: `2:45-2:55`. This is a non-production, `SIMULATED` demonstration; physical hardware
remains unproven. The guarded path is the only live path, and every new live run still requires its
own fresh authorization. Provider-free applies to rehearsal and automated verification; it does not
describe the separately and freshly authorized live-recording path.

- **0:00-0:20 — Problem and claim ceiling.** Explain that legacy greenhouse monitors deliver
  readings by phone, so people still listen and transcribe. Keep `SIMULATED`, non-production, and
  physical hardware limitations visible.
- **0:20-0:40 — Guarded entry.** In a visible terminal, use
  `corepack pnpm simulator:live-smoke:run -- --scenario synthetic-normal`. The guarded supervisor
  opens Simulator Lab automatically on the exact operation. State that viewer readiness is a
  server-observed exact GET and that dispatch remains closed until that GET matches the operation,
  scenario, and revision.
- **0:40-1:25 — Genuine runtime proof.** Narrate the one CALL-E dispatch, signed synthetic
  callbacks, zero DTMF, admitted transcript, and exactly four grounded readings. Show source
  transcript before interpretation and keep provider identifiers, phone values, credentials,
  permits, targets, and raw custody details off screen.
- **1:25-2:20 — Demo Review and Finish.** Wait for
  **External call capability closed—review available for 30 minutes** before narrating Demo Review.
  This fixed 30-minute review window starts at persisted review readiness and browser activity does
  not extend it. Choose **Finish demo and delete result**. Show **Protected demo result deleted**
  only after exact protected teardown; if teardown is incomplete, show **Cleanup requires attention**
  and retain only the bounded exact recovery identity.
- **2:20-2:50 — Deterministic replay (not the live result).** Show replay as a separate labeled,
  credential-free fallback. Close with the four-reading product payoff and repeat that replay is not
  live provider evidence and establishes neither physical hardware nor production readiness.

## Deferred live-validation matrix

No live scenario result is bundled or claimed. The matrix defines requirements for
future separately authorized engineering checks; it is not authorization to call.

| Order | Scenario | Future guarded command                                                  | Reviewed result required outside Git                                                        |
| ----- | -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1     | Normal   | `corepack pnpm simulator:live-smoke:run -- --scenario synthetic-normal` | Complete four-zone provider evidence; zero DTMF; one dispatch                               |
| 2–5   | Other    | Not authorized by this one-call MVP runbook                             | Requires a new explicit confirmation, newly issued authorization, and separate reviewed run |

If a later, separately authorized investigation ever resumes, every row still requires one accepted operation ID, one provider identity, at most one dispatch, zero retry, zero DTMF, `SIMULATED` provenance, transcript custody before derivation, and no protected value in logs or Git. Recovery still requires the exact predecessor operation ID. A failure is evidence, not permission to redial.

## Evidence review and custody limits

Review provider facts before readings. Confirm the opaque custody reference and integrity metadata point to the bounded local custody record. Do not paste transcript bodies or provider payloads into tickets, commits, screenshots, or submission text. Record only scenario ID/revision, operation ID, terminal class, timestamps, redacted safety facts, and opaque references. Recovery must link to the exact durable abnormal predecessor while preserving both append-only histories.

## Deterministic fallback

If live capability, authorization, credentials, tunnel, provider, or evidence review is unavailable, select deterministic replay immediately. Run `corepack pnpm generate:simulator-demo`, open Simulator Lab, retain the visible `SIMULATED` disclosure, and show transcript-before-interpretation plus the four-zone reconciliation. Never represent replay as a live provider result.

## Under-three-minute rubric-mapped recording script

Target a `2:45–2:55` final cut so title cards and hosting do not cross the hard three-minute judging window. Record functioning footage from the local demo build at the intended desktop viewport; do not simulate clicks in a static mockup.
This is the provider-free deterministic recording path. It shows authored fixtures,
not provider-call history, and does not invoke the live-recording command.

- **0:00–0:25 — Real World Impact.** On the Simulator Lab title and normal scenario, say: “Greenhouse operators still depend on phone-delivered status reports from legacy monitors. Muster turns that report into evidence an operator can inspect, without pretending a simulator proves physical hardware.”
- **0:25–0:50 — Quality of the Idea.** Keep deterministic replay visibly selected. Show the immutable scenario choices and `SIMULATED` badge. Say: “CALL-E provides the machine-to-machine voice boundary; versioned scenarios let us exercise normal, abnormal, uncertain, and recovery evidence while replay stays dependable.”
- **0:50–1:25 — Product Experience.** Run the normal deterministic replay. Show source transcript first, then the four-zone reconciliation, auxiliary status, operation reference, and compatibility ceiling. Say: “Evidence is presented before interpretation, and every result remains explicitly simulated.”
- **1:25–1:55 — Evidence boundaries.** Show the `SIMULATED` badge and say: “These readings come from authored replay fixtures, not a live provider call. A live run must separately satisfy signed callback, transcript grounding, and cleanup checks.”
- **1:55–2:25 — Technical Implementation.** Show the architecture diagram or repository view. Trace one-use authorization, PostgreSQL operation identity, pg-boss, at-most-one dispatch, bounded transcript custody, strict evidence admission, and production-artifact exclusion. Mention that the independent oracle proves materially different inputs produce different readings without giving the provider adapter expected values.
- **2:25–2:45 — Recovery and trust.** Replay abnormal and then recovery, showing the exact predecessor link and human-confirmation language. Say: “Recovery preserves both histories and never closes the incident autonomously.”
- **2:45–2:55 — Close.** Return to the `SIMULATED` badge. Say: “Muster demonstrates an evidence-first product journey with a separately authorized CALL-E-to-Twilio integration—not physical hardware or production readiness.”

### Recording and publication checklist

- [ ] Run the non-calling readiness command and deterministic generator immediately before recording.
- [ ] Capture the functioning local demo at desktop size; verify text is readable at the exported resolution.
- [ ] Keep the cut under three minutes and use only authorized music, marks, footage, and assets.
- [ ] Mask or omit every phone value, provider ID, credential, permit, transcript body, and private endpoint.
- [ ] Do not show or narrate deterministic replay as live CALL-E evidence.
- [ ] Upload only after authorization to a public YouTube or Vimeo URL that remains accessible through judging.
- [ ] Rewatch the hosted version logged out and record its duration before using the URL in Devpost or a pull request.

## Phase 5 reconciliation

- `tools/simulator/verify-live-demo-readiness.ts`: delivered as the non-calling preflight.
- `tests/e2e/hackathon-live-calle-observation.integration.test.ts`: delivered for disposable composition, independent anti-stub evidence, and recovery lineage.
- `docs/demo/hackathon-live-calle-observation.md`: delivered as this operator handoff.
- CALL-E runtime evidence: not bundled; provider-free checks do not establish live success.
- CALL-E-to-Twilio scenario execution: not performed by the default demo or test suite.
- Judging journey: deterministic replay, transcript-first evidence, recovery lineage, and explicit `SIMULATED` disclosure.
- Video script and submission drafts: complete locally and not published.
- Tunnel, deployment, video publication, awesome-list PR, and Devpost submission: not performed; no authorization granted.
