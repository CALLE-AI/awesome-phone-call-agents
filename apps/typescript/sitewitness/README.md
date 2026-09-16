# SiteWitness demo

SiteWitness turns an unresolved factual question into a documented interview, reviewable evidence, and an owned next action. The property and source documents are synthetic. The main workspace (`/`, also `/case-file`) uses **CALL-E’s Calls API** for actual interviews. The current investigation starts with three supplied contacts and zero calls. Earlier test calls remain in read-only `/call-history`; they do not populate the current case.

[Watch the recorded SiteWitness hackathon demo on Vimeo](https://vimeo.com/1226453100) — 2:58.8.

## Run locally

Use Node.js 22.13 or newer (Node 24 for the SQLite integration tests). From the folder containing `package.json`:

```sh
npm ci
cp -n dev.vars.example .dev.vars
npm run dev
```

Open the address printed by the server. A different port can be selected with `npm run dev -- --port 3001`. Keep the server running. Local evidence, contacts, tasks and review history persist in `.wrangler/`; do not delete it to restart a presentation with saved calls.

Create `.dev.vars` beside `package.json`. It is ignored by Git. For a rehearsal without telephone calls:

```dotenv
CALL_PROVIDER=fake
LIVE_CALLS_ENABLED=false
```

Restart the server after changing these settings. For a live demonstration, supply your own CALL-E Developer API key:

```dotenv
CALL_PROVIDER=calle_calls
LIVE_CALLS_ENABLED=true
CALLE_API_KEY=your_key_here
CALLE_BASE_URL=https://api.heycall-e.com
```

The Calls API does not require a published Goal or `CALLE_GOAL_ID`. Credentials stay on the server. Existing local credentials are never replaced automatically. The new case-file interface requires `fake` or `calle_calls`; the older Goal adapter remains in the code for compatibility with its compact result contract.

## Start a fresh demo each time

1. Open the main workspace and choose **Coordinator** in **Demo role**.
2. Click **↻ Start new demo** at the top, then confirm **Start new demo**.
3. The page returns to **Source records** with the original three fictional contacts, zero calls, no collected evidence, no reviewed years and no follow-up tasks. Enter the test participant’s number and permission again before calling.
4. Use **Demo history** to revisit the previous test’s transcripts, evidence, review decisions, contacts and tasks. The history menu separates each rehearsal, including tests where no call was placed.

This archives the investigation; it does not delete local data or CALL-E records. API settings and the global local call allowance are preserved. Every fresh investigation receives a unique interview identity, so a new call cannot accidentally reuse an earlier demo’s provider request key. Additional calls within one investigation still accumulate evidence and narrow the remaining question. Refreshing or restarting the server keeps the active investigation.

A fresh demo is blocked while a call is active, a submission is unconfirmed, or returned evidence still needs to finish saving. Resume the existing call checks or its saved brief first. Concurrent launch clicks are serialized; after an interrupted submission, wait a minute before retrying the same saved attempt. A new demo never cancels or places a telephone call. Older browser tabs must refresh before saving or launching anything.

## Actual CALL-E demo

The main page is the working case. There is no separate scripted simulator. Your real answers determine the result. The active investigation has separate persisted contacts, calls, evidence, reviews and year coverage. Reloading preserves current work; it does not erase a completed call or consume another call slot.

1. Begin on **Source records**. Show the directory listing **1987–1994**, the owner's tentative “drop shop” answer, and the unanswered question about cleaning onsite. Click **Next: people to call →**. In a fresh investigation, Morgan Lee is selected, three contacts are supplied, and zero calls have been made. Enter your actual number in international format.
2. Check **This is my number. I agree to CALL-E calling me and transcribing this demo interview.** This fills the permission record. Click **Save contact & permission**, then **Prepare interview brief**.
3. Review the exact instructions, check **I reviewed this exact brief**, type `PLACE LIVE CALL`, and click **Place one live call** once. Answer the real phone call naturally within your fictional role. For the planned presentation, describe firsthand knowledge only from **1992–1993** and keep the other years unknown.
4. Wait for the actual transcript and extracted evidence. Click **Review returned evidence**. Under **Which years does this answer really address?**, check the **Original respondent answer** and its exact quotation. If an extracted summary combines or rewrites answers, the form offers an original transcript answer instead. Select only the years the response supports, using **Use suggested years** or the individual checkboxes. No years are automatically accepted. For the planned first answer, choose **1992** and **1993**.
5. Confirm the exact date quotation and selected years, then click **Save reviewed years & plan follow-up**. **1992 and 1993 are enough for this step.** Other claims can remain pending; saving years does not accept those claims. If only 1992–1993 is supported, the remaining years are **1987–1991 and 1994**. Shortened dates such as “Yes. I was there from about '92 to '93.” work directly; keep the original transcript wording.
6. Click **Prepare next call with Carol Chen**. The coordinator's next-interview task is saved, and Carol is selected. Enter the consenting participant's number and permission for this role. In **Remaining question for this call (optional)**, ask about her full firsthand knowledge period, including the earlier years and 1994. Prepare and review the current brief, then approve this additional call separately. Her referral's 1987–1991 period is a lead, not a limit on what she can establish.
7. In the two-call demo, Carol operated the shop throughout **1987–1994**. Review her actual returned evidence and choose the original positive date answer. For example, “I worked there from 1987 to '94 in the back room doing most of the dry cleaning.” supports all eight years. Click **Use suggested years** or **Select all 1987–1994**, confirm the supported years, and click **Save complete year coverage**. This does not replace the transcript or automatically accept the other claims.
8. Full year coverage moves the case to **Awaiting EP review**, without inserting another partial disposition. On **Next action**, complete the performed **Conduct the next interview** task. Choose **Review complete evidence →**, review any outstanding work, then use **Other human dispositions and saved decisions → Resolved by reviewer** and **Save human disposition** with a specific rationale. This resolves the historical-use question only, when the actual evidence supports it.

The same participant can play each fictional witness, but each contact's number and permission must be explicitly saved. The app never fills in a fictional telephone number or dials another person automatically. Morgan's referred 1991–1996 period is an unverified lead, not established coverage.

The year count means **years addressed by human-reviewed testimony**, not verified operations or an environmental conclusion. Year review is saved separately from claim review, so reviewing another claim does not erase the confirmed dates. Changing the saved date quotation or selected years makes a prepared call stale and requires a new brief approval. Earlier coverage saved under the original combined review flow retains its original statement-review checks. Final resolution still requires review of every pending claim and completion of outstanding work.

If an automatic date suggestion is incomplete, **all year checkboxes remain available to the EP Reviewer**. Select the supported years and enter a short **Reason for year correction** explaining how the original answer establishes them (10–1,000 characters). The exact quotation, its selected transcript turn, your years, and your explanation are saved together. A source choice or explanation change also invalidates an earlier call brief. The correction works even when the parser recognizes no dates; it cannot replace the respondent's words with an invented or combined quotation. Choose another original answer if the selected one does not establish the period. You do not need to repeat a call merely to change date wording.

If CALL-E extracts a quote that is too short to match one respondent turn, use **Edit** to supply a longer exact quote and a reason. The original provider response stays unchanged. Dates transcribed as words such as “nineteen ninety-two” are supported. A missing or unusable date quote is not replaced with an invented period.

The [current demo script](docs/demo-script.md) uses **276 narration words** in a presentation, demo, presentation sequence: three opening slides, a continuous **60-second demo** containing **five 10-second screen clips** and **one 10-second actual call excerpt**, then a closing slide. The final edited video targets about **2:40**, below three minutes. Capture the returned information once it has loaded; no live clicking, dialing, processing wait, or final-save demonstration is required. Preserve material qualifications and contradictions. Show the actual current review status; the narration leaves the final decision with the consultant.

## Working CALL-E workspace in five steps

Open `/` or `/case-file` for the current working investigation. Earlier calls are available through the separate read-only history link. Each additional call is individually approved. In **Interview brief**, use **Remaining question for this call** to target missing years or facts; preparing the brief includes that focus in the immutable approved instructions. The server carries forward human-confirmed year coverage into the next brief. The coordinator can add a more specific factual question; each call still requires separate approval.

1. **Source records.** Open the directory and owner questionnaire. The directory lists Sparkle Cleaners, 1987–1994; the owner says, “I believe it was only a drop shop.” Show the actual prepared documents and their linked excerpts. Explain the gap: neither establishes what happened onsite or who personally knows.
2. **People & contact.** Open the property-team referral for Morgan Lee. It supplies a role and expected knowledge period, but no number or permission. Show **Create contact or record task** when those are missing. A coordinator must supply a demonstration participant’s number, say where it came from, and record both permissions before a brief can be prepared. “None of these people is suitable” also leads to an owned source-finding task.
3. **Interview brief.** Read the actual instructions that will be sent: personal knowledge, observation basis, equipment and location, handling only where relevant, knowledge limits, and another source. Check that the current brief has been reviewed. In live mode, type `PLACE LIVE CALL` and click **Place one live call** once. In rehearsal mode, select a fixed scenario and click **Run synthetic rehearsal**.
4. **Evidence & review.** Compare the owner’s original answer with the returned claims. Open each exact respondent quotation. Proposed interview outcome, provider status and saved human decisions are separate. Switch to **EP Reviewer**; accept, revise with a reason, reject or request follow-up. Review every pending statement across interviews. Enter a fresh rationale and save the human disposition. **Export accepted evidence** downloads JSON for the selected interview, not a combined export of all calls.
5. **Next action.** Show precisely what remains unknown and who owns obtaining the missing source. A named lead such as Carol does not get a phone number automatically. Assign contact-finding or record work, then add independently supplied details and permission when available. Saving a task sends no message and places no call.

A useful closing line: **“The interview adds supported facts and makes the remaining work specific. The human reviewer decides what the evidence establishes.”**

## Rehearsal scenarios

- **Limited knowledge + new lead:** Morgan reports management from 1991–1996 and observed pickup/drop-off during 1991–1994, limited rear-room access, unknown earlier operations, and a referral to Carol. Carol appears as a synthetic lead without contact details.
- **Direct onsite work:** the respondent says they personally performed cleaning around 1992–1993 and identifies a machine in the back room. Deliveries, waste and other years remain unknown. The UI must preserve these different dates and facts.
- **Human requested:** the participant asks to speak to a person. The conversation stops, no factual claims are invented, and the coordinator has the next action.

These scenarios rehearse the interface. They are not evidence that CALL-E followed a branch or made a particular decision. For a live call, the respondent should answer naturally from an agreed fictional background; the resulting conversation may differ, and the presentation should follow the actual returned evidence.

## What is verifiable

- **SiteWitness:** prepared source documents, linked excerpts, supplied-contact provenance, saved permission, immutable approved brief, durable tasks/reviews, and exact quotation matching against the returned respondent turns.
- **CALL-E Calls API:** the app submits the approved task, recipient and structured-result schema, then retrieves status, transcript turns and structured evidence. Conditional question rules are instructions. Coverage shown after the call is extracted and must be checked against the transcript; it is not a live view of CALL-E’s internal decisions.
- **Human reviewer:** acceptance, wording revisions and case disposition. A quote match establishes that words occurred, not that the complete extracted claim is correct.

Do not present the demo as automatic document understanding, automatic contact discovery, a published Goal Run, autonomous environmental assessment, or proof of hidden planning. Do not promise a scripted outcome from a live call.

Earlier saved calls remain readable in `/call-history`. Their older four-field results do not separately establish a knowledge period, branch coverage, new leads or an interview outcome. The old saved rationale is shown as history, never prefilled as the answer for a new interview.

## Recovery and other response channels

An active or unconfirmed call remains visible after a refresh. Resume its checks or restore the saved brief to retry the same request identifier. A timeout or server error keeps its reservation. Do not start a new call because status is delayed. Results awaiting ingestion remain recoverable without another phone call. Invalid extraction retains the original transcript and does not substitute synthetic evidence.

The 20-slot allowance is local accounting, not the CALL-E account balance. Live calls and reservations stay counted across restarts. Contact changes invalidate an earlier preview; replacing a number requires renewed permission.

Under **Next action → Other response channels**, written and human-interview workspaces remain available. Their existing Baker Street questions concern operations before 1991 and the rear storage room; use them only when those are the intended questions. Enable a written response link for manual sharing, or open the interview workspace. SiteWitness does not send email or messages. Returned answers join the same evidence review, including in live mode.

## Verification and implementation

```sh
npm test
npx tsc --noEmit
```

Tests use isolated in-memory SQLite and mocked HTTP responses. A Miniflare D1 regression also checks repeated resets, evidence review and archive access using the actual database runtime; it opens a local loopback port and uses synthetic calls only. Restart tests cover complete case isolation, preserved archives and usage, unique provider identities, stale tabs, concurrent resets, launch/reset races, submission recovery and synthetic/live history visibility. They verify case isolation, preservation of older calls and budget reservations, human-confirmed years, six-year gaps, targeted follow-up instructions, quote repair, independent year review and stale approval after changed coverage. They cover missing contacts, permissions, immutable briefs, all three rehearsal outcomes, quotations, stale revisions, open tasks, invalid extraction, concurrent checks and interrupted processing. They never contact CALL-E or place a call. A build and mock tests cannot verify telephone delivery or the quality of the revised live conversation; that needs an explicitly authorized rehearsal call.

Main files: `app/case-file-app.tsx` (demo), `app/api/case-file/route.ts` (contacts/tasks), `app/api/calle/route.ts` (authorization, submissions and recovery), `app/api/case-evidence/route.ts` (evidence), and `app/lib/call-provider.ts` (adapters). New contact/task and processing state uses append-only events in the existing database; no schema migration is needed. Existing source schemas and migrations remain in `db/` and `drizzle/`.

This is a local presentation MVP. **Demo role is a workflow selector, not authorization.** All contact, call, evidence, review, workflow, respondent and history APIs require the access boundary described below, even in synthetic mode.

## Private access and output

`npm run dev` binds to `127.0.0.1`; the unauthenticated convenience path exists only in development and requires a loopback request; only the local runtime’s matching host/loopback metadata is allowed. Do not expose that development server through a tunnel or reverse proxy. Cross-origin browser requests are rejected. Changing `x-demo-role` cannot grant access. Production builds deny private access by default, including archived real calls after switching to fake mode.

For remote access, configure both `SITEWITNESS_BASIC_USER` and `SITEWITNESS_BASIC_PASSWORD` as server-side secrets and serve the production Worker over HTTPS. Use a unique random password of at least 16 characters. Configuring either setting disables the local bypass; incomplete settings fail closed. The browser's Basic authentication prompt protects the workspace. This is shared operator access, not separate reviewer accounts or a production identity system. Never send the password over HTTP or include it in a URL, source code, or a public submission.

CALL-E bearer credentials are sent only to the exact approved origin `https://api.heycall-e.com`. Alternate hosts, HTTP, embedded URL credentials, nondefault ports, base paths and query strings are rejected before a request. Credentialed requests never follow redirects, including status/event polling. An alternate provider origin requires a deliberate reviewed code change.

Private originals remain in local storage for quotation matching, review validation and call recovery. API responses, displayed transcripts/evidence, nested audit notes and JSON/Markdown exports mask phone numbers; provider errors use application-written messages. Masking does not prove evidence: citations are computed against the original private text first. To review a masked quotation, select its original respondent turn; ambiguous masked matches are rejected. Existing saved records are masked on read without rewriting or accepting evidence. `.dev.vars` and `.wrangler/` remain private and must not be uploaded.

## Live-call side effects and cancellation

Preparing or reading a brief does not place a call. In live mode, **Place one live call** submits one approved telephone task to CALL-E and may consume the account's call allowance. The participant's supplied number and approved interview instructions are sent to CALL-E; returned transcripts and evidence persist locally for review.

Before launch, leave the brief without approving it to avoid a call. This app does not provide a provider-side cancellation button after launch. A participant can end their phone conversation; the coordinator should resume checks for the existing call to retrieve its actual result. Starting a fresh demo archives local work and is blocked while a call or result is pending; it does not cancel or refund a CALL-E call. Each additional call needs its own approval.

For judging without real calls, use `dev.vars.example` unchanged. No CALL-E account or credential is needed for the synthetic rehearsal. Live testing is optional and requires a consenting participant and the operator's own CALL-E account. Keep this demonstration local when enabling live calls.
