# Verification — 12 September 2026

- `npm test`: 16 tests passed. On this Windows host, the sandbox prevented the tsx runner from reading user environment information; the tests passed outside the sandbox with approval.
- `npm run typecheck`: passed.
- Final `npm run build`: passed; the home page is prerendered and the workspace API is dynamic.

## Browser checks

1. Opened the application and visually inspected the dashboard and preview dialog.
2. Verified that unconsented example records cannot be called and live testing is disabled without credentials.
3. Approved a **simulated** acceptance call. The app displayed progress, returned evidence and a transcript, and required staff confirmation before booking.
4. Confirmed the demo booking: open slots changed from 3 to 2; recovered demo minutes changed from 0 to 30.
5. Refreshed the page and verified that the booking persisted.
6. Ran an unclear-answer simulation on a second slot. It offered manual follow-up and no booking confirmation. Closing the review kept the slot open and re-enabled eligible invitations.

The original local-host origin check failed in the first browser attempt and was corrected. The regression test covers valid local hosts, mismatched ports, external origins and missing headers.

Provider parsing was initially tested using fixtures. No real phone call, API credential, clinical data, public deployment, or final hackathon submission was used in those initial checks. Subsequent wide and compact browser previews were visually checked; compact navigation has accessible labels.

## Subsequent connection check

The user supplied a CALL-E API key, stored only in the ignored local `.env.local`. A read-only request for a deliberately nonexistent call returned 401 without authentication and 404 with the key, confirming the API recognized the credential. No call was created by this probe. Live mode remained disabled at this stage; the subsequent authorized tests are recorded below.

## Authorized live tests

The user subsequently approved a real English-language call using a fictional appointment and local transcript retention. The first attempt reached screening and returned `can_attend: unknown`. After the user explicitly asked to be called again, one second call connected to the volunteer and returned `can_attend: yes`. The transcript shows explicit acceptance of the fictional time. Staff review and the final fictional booking action were verified in the UI. No real clinic system was changed and no phone number was purchased.

Raw provider evidence is saved under the ignored `.data/evidence/` folder and is excluded from the source bundle. A provider task status remained `queued` while its recipient was already `in_progress`; the adapter now reflects the active recipient, with a regression test.

## Public Vercel build verification

- `npm test`: 21 tests passed, including browser persistence, separate visitor workspaces, malformed storage recovery, rejected live actions, and public server/SDK rejection even when live environment variables are populated with test-only fixtures.
- `npm run typecheck` and `npm run build:demo`: passed.
- The built public API returned HTTP 403 for both GET and POST before accessing server state. The build was started without a runtime public flag, verifying the build-time guard remains effective.
- Scanned all 11 emitted public static files against the private CALL-E key and volunteer number and token patterns: no matches.
- Browser walkthrough verified a scripted acceptance, required staff confirmation and persistence after reload. No real call was created during deployment testing.

The public deployment at https://clinic-slot-assistant.vercel.app/ returned HTTP 200 without authentication. Both GET and POST to its workspace endpoint returned 403. A deployed acceptance simulation, staff confirmation and persistence after reload were verified in the browser.
