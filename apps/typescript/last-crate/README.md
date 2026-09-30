# Last Crate

**A bakery has bread. A community partner has a van. Neither has a pickup until both agree.**

Last Crate closes one specific phone-work loop: arranging collection of surplus plain bread from a known bakery before its collection cutoff. CALL-E confirms the actual offer, then calls the nearest eligible approved partner. Software checks the full quantity, travel feasibility, own transport and arrival window before issuing a pickup ticket.

The distinguishing step is the handoff: it does not end with a list of places that said “yes.” The bakery agrees to set aside an exact quantity for an approved partner; the collector commits to that offer; the software creates one expiring assignment with call evidence.

## Run locally

Requires **Node.js 24+**. No database service, frontend build, LLM key, or telephony account is required for rehearsals.

```sh
cd apps/typescript/last-crate
npm install
npm start
```

Open **http://localhost:3210**. The submission repository also supports `npm install && npm start` from its root.

Choose **Run the rehearsal**. The fictional offer is 48 loaves. The nearer kitchen only has capacity for 30, so Neighbour Table gets the call. A pickup ticket appears after both fixture calls. Open **Match reasoning** and **Call evidence** to inspect the decision. Download the ticket as JSON for a dispatch system.

Rehearsal scenarios cover success, a decline, an unclear offer, a late arrival and no answer. They execute the actual state machine with explicitly scripted provider results. They never contact CALL-E.

## Live setup

Copy `.env.example` to `.env` in the directory from which you start the server:

```dotenv
CALLE_API_KEY=your-key-from-the-call-e-dashboard
LIVE_CALLS_ENABLED=true
LIVE_ROLEPLAY=true
CALLE_ALLOWED_PHONES=your-authorized-E164-number
MAX_LIVE_CALLS=4
```

Get a key from the [CALL-E dashboard](https://dashboard.heycall-e.com/account/api-keys). Keep it on the server. Fill the real phone inputs, the destination's two-letter country code, the call language, and the collection date and UTC offset. English (`en-US`) is the default; Sinhala (`si-LK`) and Tamil (`ta-LK`) are selectable for compatible recipients, with actual route support still determined by CALL-E. Each phone number, including approved roster contacts, must be explicitly allowlisted. One authorized phone may role-play both roles.

**Runtime test status, September 12, 2026:** the official SDK authenticated against CALL-E, but creation to the authorized Sri Lankan test number was rejected with `call_not_ready` because the live API did not support English to that destination. The same request was reconciled with its original idempotency key. No Call ID was returned, no successful live conversation was verified, and no live pickup ticket was issued. The region documentation listed English for Sri Lanka, so an accepted English destination remains necessary to finish live verification. Do not present fixture transcripts as real calls.

Check [supported regions](https://docs.heycall-e.com/regions); actual availability may differ. A valid E.164 number does not establish route support. Never replace a real destination's country with another country to bypass a rejection.

For a genuine pilot with known donors and approved partners, set `LIVE_ROLEPLAY=false` **before creating a new handoff**. The UI then describes actual collection coordination. Confirm the operator has authority to request the donor hold and agree the precise pickup. Existing runs keep the context in which they were created. This setting does not remove allowlisting or the explicit live-call action.

## Workflow and actual side effects

1. Save the input, request key, and an initial event in local SQLite.
2. CALL-E calls the bakery: confirm plain bread in donor packaging, whole-loaf quantity, ready time, cutoff, and permission to set it aside.
3. Verify the terminal structured result and that its quoted evidence occurs in human transcript turns. Ambiguous responses never authorize a match.
4. Exclude unapproved or undersized partners. Calculate earliest feasible arrival using coordinator-provided travel time plus three minutes of coordination. Choose the closest eligible partner.
5. CALL-E offers the full quantity to that partner and may confirm this specific pickup only within the stated window with own transport. No partial pickups, payment, substitutions or additional recipients.
6. Check the returned commitment and create one local ticket with both call IDs and evidence. A ticket is a pickup agreement, not proof that food was collected. **Mark collected** is explicitly a coordinator report.

The second call is skipped when the donor is unresolved or no partner fits. A decline stops the workflow; automatic cascades are intentionally out of scope for the small call budget. No SMS, email, calendar or external dispatch action is hidden in the workflow. Tickets are local, downloadable JSON.

## Recovery, cancellation, and quota

- Request bodies and idempotency keys are persisted **before** SDK `calls.create`.
- Returned IDs are saved before polling `calls.get`. A restart requires **Resume saved call**.
- If the response was lost before an ID was saved, resume replays the unchanged request and original idempotency key. It does not invent a new key.
- If the ID exists, resume only fetches that call. A timeout is unresolved, not a decline or no-answer.
- **Stop future calls** prevents the next stage. CALL-E's Calls API has no client cancellation operation. A call already placed can finish and make its bounded commitment; the app still reconciles it. Stopping does not revoke a donor hold or a spoken agreement. Contact the parties directly if needed.
- No schedules or recurring jobs exist. There is no background dialing on server startup.
- The persisted call cap counts reservations, including rejected or ambiguous create attempts. An idempotent replay uses the existing reservation. It is a conservative call-count control, **not a dollar meter or a hard duration limit**. Calls request brevity in the prompt; actual duration and charges belong to CALL-E. Check your account balance before changing the cap.

## State, privacy, and deployment

`data/last-crate.sqlite` stores requests, phone numbers, structured results and transcripts. Keep this directory private; it is ignored by Git. The UI masks dialed phone numbers, but conversational evidence can contain other personal data. Only share explicitly reviewed/redacted recordings or screenshots. Do not publicly expose the local SQLite file or `.env`.

The server binds to loopback by default. Public binding requires `APP_ACCESS_TOKEN` of at least 24 characters. Use HTTPS at a reverse proxy, a persistent data volume, and one application process. The access screen asks for the token; API calls require it. Do not publish the token in a video or link. `Dockerfile` provides a deployable container; deployment itself has not yet been completed.

Back up the source repository remotely and the private SQLite directory separately. To retire the pilot, disable live calls and stop the process; confirm no provider calls remain unresolved before applying your retention policy to local data. Never delete the database to work around the call cap or an unresolved operation.

## Verification

```sh
npm test
```

Tests are offline. They cover full workflow outcomes, impossible matches, quantity and window mismatch, bot-only or missing evidence, idempotency, persistent call reservations, stop races, and the **official SDK's real serialization/deserialization** through an injected no-network transport.

Manual UI path: run each rehearsal → inspect activity and both evidence panels → inspect the capacity exclusion → download a successful ticket → mark it collected and observe the separate state. Try 100 loaves to exercise no feasible partner.

## Boundaries

- This is a focused reference app, not a food-safety or legal certification system. Partner approval is supplied by the coordinator, not independently verified. Plain bread is a deliberately narrow product category; donor and collection organizations remain responsible for suitability, allergens, handling, and their operating requirements.
- Schema extraction and quoted human evidence are useful checks, not identity verification or a formal proof that every extracted field is true. ASR or extraction mistakes can still require human review.
- Travel time is entered by the coordinator. No live maps, traffic or driver tracking are claimed. Windows are same-day, with an explicit UTC offset; overnight collections are rejected.
- One active live workflow per installation. The app does not coordinate inventory with other systems. A second independent workflow could describe the same real bread; the coordinator must avoid duplicate offers.
- No medical, financial, legal or emergency advice, purchases, or patient/beneficiary data are needed.

## Reuse

`workflow.ts` holds the JSON Schemas, bounded call prompts, and deterministic feasibility/verification functions. `engine.ts` owns the state machine. **`provider.ts` is the single phone adapter**: official `@call-e/calle@0.7.0` SDK, polling, allowlisting, recording, redaction, and no-network replay. `store.ts` persists workflow state. `fixtures.ts` hydrates explicitly synthetic JSON templates from `response-fixtures/`. `server.ts` and `public/` provide the collection desk. **`harness.ts` owns demo startup, setup checks, durable live sessions, automated recovery and report capture.**

## One-command demo harness

After `npm install`:

```sh
npm run demo
```

This starts the local server if necessary, runs the complete synthetic fixture workflow, and writes a report and pickup ticket under private `data/harness/`. It prints a direct link to that handoff. No API key or phone interaction is needed.

```sh
npm run doctor
npm run harness -- demo --scenario window
npm run harness -- recordings
npm run harness -- replay 99e49ac4-bede-471c-8017-7189fd89d2ed
```

`doctor` checks local configuration, not actual route availability. The included replay is the **real captured, redacted English/Sri Lanka rejection**, with zero completed calls. The successful and adversarial JSON response templates are clearly labeled synthetic; they are not passed off as successful real recordings.

For a live demo when an authorized recipient is ready:

```sh
npm run harness -- demo --live --yes-live
```

The harness uses `DEMO_PHONE`, or the sole allowlisted number if there is exactly one. `DEMO_REGION`, `DEMO_LOCALE` and `DEMO_UTC_OFFSET` configure the actual destination, conversation language and collection clock. It creates a fictional 48-loaf scenario with a future same-day window and prints the two reply briefs. Both roles can use the same phone. All matching, the second call, result validation, recording and ticket generation are automatic. The only human interaction is answering at most two phone calls. Live role-play must be enabled; the harness cannot accidentally switch into actual donation coordination.

Re-running the live command **reuses the saved session**, even after an interrupted process. `--new-session` is required to intentionally authorize a fresh pair of calls. `resume <run-id>` resumes an existing operation. The harness can automatically resume up to twice using the existing saved call requests/IDs; it never redials with a fresh key as a recovery technique. A live run that does not produce a ticket exits with code 2.

Every completed live stage or captured provider error automatically produces a redacted recording bundle under private `data/recordings/`. The recorder strips known input identities and emails consistently from the input, quotes and transcript turns. Free-form speech may still contain other personal information, so these files remain private by default. A SHA-256 integrity check protects replayed inputs, response values and the matching clock; it is an integrity check, not a proof that a conversation was true. Test-double transports cannot produce files labeled as live recordings.

Replay a completed live run with `npm run harness -- replay <run-id>` or **Replay captured result** in the UI. The adapter reads the recorded responses with the original values and clock, never calling the provider or changing the old result to fit new inputs. A missing replay stage produces an unresolved state, never a live replacement call.

Contribution area: **User-facing Apps**, `apps/typescript/last-crate/`. MIT licensed. No private packages, hosted model service or proprietary frontend are required.
