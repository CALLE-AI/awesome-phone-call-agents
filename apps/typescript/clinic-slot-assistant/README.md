# Clinic Slot Assistant

A CALL-E hackathon prototype by Madhuri Gade. Choose a cancelled appointment, preview a call to a consenting waitlist person, review the response, and explicitly confirm a booking.

## Current state

The local application includes a working, labelled simulation with four outcomes: acceptance, refusal, uncertainty, and no answer. A server-side CALL-E SDK adapter supports one authorized India test volunteer. **Author-reported live validation on 12 September 2026:** after an initial attempt reached screening, an explicitly requested second call connected to the volunteer, returned `can_attend: yes`, and completed staff review and a fictional booking in the app. No real clinic calendar is connected. All example names, appointments, consent records, and demo transcripts are fictional; locally retained live-test transcripts are private and excluded from the source bundle.

Standalone source: [Madhuri-4596/clinic-slot-assistant](https://github.com/Madhuri-4596/clinic-slot-assistant). The live-test result is author-reported; private evidence is intentionally excluded. Reviewers can reproduce the simulation and automated tests without credentials or phone calls.

## Run locally

Requires Node.js 22.17 or newer and npm.

From the repository root:

```sh
cd apps/typescript/clinic-slot-assistant
npm ci
npm run dev
```

Open http://127.0.0.1:3210. For a production-mode local preview, run `npm run build` followed by `npm start`.

The server binds to loopback. This is a single-process local prototype, not a production clinic system. Do not deploy the live-calling configuration publicly. It has no staff authentication or clinical data security controls.

## Try the demo

1. Select an open appointment, then choose **Preview call** beside a waitlist person.
2. Choose an outcome and approve the simulated call. No phone is dialed in demo mode.
3. The simulated call progresses to a response, evidence, and transcript.
4. A clear acceptance enables **Confirm demo booking**. An unclear or missing response requires manual follow-up. A refusal leaves the appointment open.
5. Review the updated board and activity log. **Reset demo** starts a new fictional workspace.

State survives refresh and server restart in `.data/sessions/`, keyed by an HttpOnly SameSite cookie. The directory is ignored by Git. Do not put real patient information into the prototype. Deleting the session cookie creates a new workspace; live call history must be reconciled in CALL-E before any repeated test.

## Public demo on Vercel

**[Open the public interactive demo](https://clinic-slot-assistant.vercel.app/)** — no login or credentials required; all calls are simulated.

Import this GitHub repository into Vercel as a Next.js project. The checked-in `vercel.json` runs `npm run build:demo`; no environment variables, API keys, phone numbers, or database are needed. Use Node.js 22.x or newer.

The public build stores a small journal of fictional actions in each visitor's browser localStorage. Refresh preserves that visitor's progress. **Reset demo** clears it and creates new appointment dates. Clearing browser storage also resets the demo. Visitors do not share a workspace, and no real patient records can be entered. If browser storage is blocked, enable it for the site to use the demo.

Public mode is baked into the build; Vercel also forces it independently. Both server workspace endpoints reject requests before reading local files or settings, and the CALL-E adapter is disabled. Even accidentally configured credentials cannot enable live calls on Vercel. Do not add credentials to Vercel. The live-testing code remains available only for the explicitly approved local workflow below.

To preview this same public build locally:

```sh
npm run build:demo
npm start
```

Run `npm run build` again to restore a regular local build. Public hosting demonstrates scripted outcomes; it does not claim that the hosted site makes CALL-E calls. The local adapter and its setup instructions are included so judges can inspect or reproduce the integration with their own consenting volunteer.

## Connect CALL-E for one real test

1. Create or sign in to your account at https://dashboard.heycall-e.com/ and obtain an API key.
2. Copy `.env.example` to `.env.local`; enter the key privately, never in a public repository or project submission.
3. Set `CALLE_TEST_PHONE` to one consenting adult volunteer's India mobile number in E.164 format. Set `CALLE_LIVE_ENABLED=true`. Restart the application.
4. Verify the destination in your private server configuration. In the call preview, choose **Live test**, check the masked destination hint, and explicitly approve that particular call. Real calls can consume CALL-E credits.
5. The call identifies itself as an AI-led test about a fictional appointment. It does not ask about medical conditions or confirm a real booking.
6. Review CALL-E's returned response and evidence. The final booking action affects only this prototype.

The API key and full volunteer number stay server-side; the browser receives only a masked destination hint for approval. Returned phone strings are masked before saving result excerpts, but this is not a comprehensive personal-data scrubber. Review all recordings/screenshots before publishing them.

To stop *future* calls, set `CALLE_LIVE_ENABLED=false` and restart. This does not cancel an already-running call. Closing the browser also does not cancel a submitted call. This app has no in-flight cancellation control; check the CALL-E dashboard for its terminal status before considering another call. The app does not automatically redial or retry a creation request when the provider outcome is uncertain. It retains the workflow ID and locks the slot; check the dashboard to reconcile that state. A process interruption before receiving the provider ID is also treated as uncertain.

## Design and implementation

- Next.js App Router, React, TypeScript, CSS, and the official `@call-e/calle` SDK.
- Call creation is server-side and uses a persisted idempotency key, explicit recipient, and yes/no/unknown result schemas.
- The application polls an existing provider call ID. It does not create a new call to check progress.
- Duplicate active invitations for a slot or person are rejected. A booked person cannot receive another appointment from the same workspace.
- Booking requires staff action, explicit `yes`, completed provider task, and a completion-confidence score of at least 0.8. This threshold is a conservative prototype rule, not a calibrated guarantee about accuracy or clinical suitability. Staff must read the evidence.
- Atomic local JSON writes retain call IDs and decisions. This store assumes one local server process; it is not a multi-user transactional database.
- Fictional fixtures use upcoming appointment dates. The app does not match preferences automatically: staff choose the person. The displayed waitlist order is time spent waiting, not clinical priority.
- UI fonts use Google Fonts with local font fallbacks. Other demo operation is local.

## Checks

```sh
npm test
npm run build
npm run typecheck
```

Tests cover outcome handling, required consent, idempotency, duplicate invitations, conflicting bookings, expired slots, interrupted live creation, provider-result parsing, and request-origin checks. Provider parsing uses fixtures, so these checks do not place calls or prove a live CALL-E integration.

## Contribution scope

This contribution is a local hackathon demo. It creates no recurring jobs and changes no real clinic calendar. The original implementation uses Next.js, React, and the official CALL-E SDK; no existing employer code is included. A publicly hosted live-calling service, production clinic integration, and a calibrated outcome classifier are outside this scope.

Official sources:

- https://call-e.devpost.com/
- https://call-e.devpost.com/rules
- https://github.com/CALLE-AI/call-e-integrations
- https://github.com/CALLE-AI/awesome-phone-call-agents
