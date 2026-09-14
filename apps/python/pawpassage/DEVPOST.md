# PawPassage — Devpost submission kit

Updated: September 13, 2026. Official Rules control if this draft differs.

The source suite passes 58 tests. One authorized US English official-hotline
call completed through the production API; the respondent did not confirm
consent, so the app recorded DO_NOT_CONTACT and all three questions remained
NOT_ESTABLISHED. This is production integration and stop-behavior evidence,
not a successful business-checklist result. See [LIVE_VALIDATION.md](LIVE_VALIDATION.md).

The existing 2:35 video and September 5 candidate ZIP are historical drafts.
They do not include the latest source, 58-test verification or production
result. No public video, PR or Devpost project exists yet; the logged-in
My Projects page was checked on September 13 and shows an empty project list.

## Submission identity

- **Product:** PawPassage
- **Tagline:** Three frozen questions per service desk. One controlled call. No invented travel clearance.
- **Prize positioning (not a confirmed form field):** Most Practical Use Case
- **Suggested pull request title:** `feat(apps): add PawPassage pet-journey evidence checks`
- **Suggested branch:** `feat/pawpassage-pet-journey`
- **Status:** Newly created during the submission period
- **Platform:** Local Python 3.11+ CLI on a desktop computer

## Official requirement audit

Sources checked without logging in:

- [CALL-E challenge overview](https://call-e.devpost.com/)
- [CALL-E Official Rules](https://call-e.devpost.com/rules)
- [Devpost submission-step guidance](https://help.devpost.com/article/126-know-your-submission-steps)

Confirmed hackathon requirements:

| Requirement | What PawPassage must provide | Current state |
| --- | --- | --- |
| Deadline | Submit by September 14, 2026 at 11:45 p.m. SGT. | Not submitted. |
| Eligible project | A functional app using CALL-E's API, SDK, MCP, CLI, or Skill for a real use case. | Local app and fake demo pass; one production official-hotline call verified the stop-on-unconfirmed-consent path, with no checklist answers. |
| Public contribution | Open a pull request to `CALLE-AI/awesome-phone-call-agents` in the correct contribution area and paste its URL into Devpost. | Integration is prepared locally; no fork, push, or PR exists yet. |
| Text description | Explain project features and functionality in English. | Copy-ready story is below. |
| Demonstration video | Show the project functioning on its intended device; actual runtime must be under 3:00. | A locally generated 2:35 draft passes media validation; it has not been uploaded and has no public URL. |
| Video host | Upload publicly to YouTube or Vimeo and provide the URL. | Missing. Do not use an unlisted/private link without confirming it remains publicly viewable and embeddable. |
| Rights in video | Do not include unlicensed trademarks, music, footage, or other copyrighted material. | Use an original title card, own narration/captions, and no music or third-party logos. |
| CALL-E account email | Enter the email associated with the CALL-E account. | Owner-only value is not stored in this repository and has not been confirmed here. |
| Testing access | Give judges a website, functioning demo, or test-build link, free and unrestricted through October 13, 2026 at 5:00 p.m. SGT. | The future public PR can expose the installable test build; confirm the logged-in form accepts that access path. |
| Functional demo URL | Optional according to the CALL-E overview. | No hosted demo exists; leave blank unless one is published and tested. |
| Language | Submission materials must be English, or include English translations. | Code-facing docs and this submission kit are English. |
| New or existing work | New work is allowed; older work must explain significant updates made during the submission period. | PawPassage is new during the submission period. |

No purchase or payment is required. The rules state that a new CALL-E account
receives 20 free calls and that exhausting allocated calls pauses access rather
than charging automatically. One authorized official-hotline call has now completed; the final credit charge was not yet shown in the account UI.

The Most Valuable Feedback survey is separate and optional for the main
project. Its stated deadline is September 18, 2026 at 11:45 p.m. SGT, with one
feedback submission per entrant.

## Current truthful status — keep this synchronized

| Claim | Truth as of this audit |
| --- | --- |
| Local application | Implemented and runnable. |
| Offline tests | 58 of 58 pass. |
| CALL-E code path | The official `calle-ai==0.7.0` SDK is imported and its create/read methods execute against a loopback CALL-E-shaped server. |
| CALL-E production API | One official-hotline create/read/result workflow completed. |
| Real human phone call | Provider reports one 83-second call; consent not confirmed, no checklist answers. The local demo still reports `realCalls: 0`. |
| Live-mode safety gates | Implemented; one production stop-on-unconfirmed-consent outcome verified. Other live outcomes are not established. |
| Public source or pull request | Not yet available. |
| Cover image | Original 1536 × 1024 PNG is prepared locally; not uploaded. |
| Public video | A validated 2:35 local MP4 draft exists; not uploaded and no public URL exists. |
| Hosted functional demo | Not available and not required by the overview. |
| CALL-E account email | Not confirmed in this audit; enter it only in the private form field. |
| Devpost registration, team, and eligibility answers | Logged-in hackathon My Projects page is accessible with an empty project list; private form answers still need checking. |
| Submission | No draft or final submission was created by this work. |

Never replace “SDK exercised against a local fake server” with “live CALL-E
call tested” unless a separately authorized real call is actually completed and
documented.

## Copy-ready Project Overview fields

- **Project name:** `PawPassage`
- **Tagline (91/140 characters):** `Three frozen questions per service desk. One controlled call. No invented travel clearance.`
- **Built with tags:** `python`, `call-e`, `calle-ai`, `sqlite`, `httpx`, `unittest`
- **Try it out:** use the public pull-request URL or public repository permalink
  only after a clean checkout has been tested; do not paste a local path.

## Short description

PawPassage is an approval-gated CALL-E evidence workbench for cross-border pet
journeys. It asks an airline, veterinary service, or destination animal
authority exactly three pre-reviewed operational questions, preserves
contradictions and uncertainty, and produces a privacy-minimized matrix for a
human—without booking, paying, certifying health, or claiming travel clearance.

## Project story

Copy the sections from **Inspiration** through **What's next** into Devpost's
Project Story field as one Markdown document.

## Inspiration

Cross-border pet journeys fail at the seams. An airline page may describe one
booking rule, a destination desk may require an appointment, and a veterinary
service may need a different document lead time. People often discover the
disagreement only after a missed cutoff. Phone calls can surface it, but a
free-form agent can also collect too much information or overstate an answer.

PawPassage treats each call as bounded evidence, not authority.

## What it does

1. Validates a closed journey case and refuses unsupported regions or malformed
   phone numbers rather than guessing.
2. Compiles exactly three written-source propositions into a masked call
   preview and closed result schema.
3. Requires a human to enter the exact preview digest. Any content change
   invalidates approval.
4. Reserves a stable intent in SQLite before crossing the network boundary.
5. Uses the official CALL-E Python SDK for one recipient and one attempt.
6. Binds the returned task, metadata, contact, call ID, and attempt count to the
   approved intent.
7. Strictly validates the structured result and preserves contradiction,
   unknown, wrong-role, commitment, and opt-out outcomes.
8. Stops at a masked evidence report for human review.

## How CALL-E is used

PawPassage imports the official `calle-ai==0.7.0` SDK and calls
`CalleClient.calls.create` with one exact E.164 recipient, documented region and
locale, the content-bound task, a closed recipient result schema, audit
metadata, and a durable idempotency key. Once the call ID is recorded, it uses
`wait_for_result`; explicit reconciliation uses `get` and can never create a
call.

The credential-free demo runs this same adapter against a loopback fake server.
Judges exercise the genuine SDK serialization, headers, create path, poll path,
response binding, local validation, durable ledger, and report without an API
key or real call.

## Safety by construction

- The app accepts no owner name, address, passport, microchip, medical record,
  bank detail, password, or security code.
- The call cannot book, pay, negotiate, certify, or interpret law.
- Phone numbers are masked outside the private case and SDK request.
- PawPassage does not persist transcripts or recordings; CALL-E provider-side
  processing is disclosed separately before a live test.
- A create timeout or server error becomes `SUBMISSION_UNKNOWN`, never an
  automatic retry.
- A complete result still says only `EVIDENCE_PACKET_READY`.
- Hong Kong is not silently relabeled as another CALL-E region; unsupported
  destinations are blocked.

## How we built it

The code separates application state from provider state. A SQLite transaction
reserves the exact intent before the SDK create call. A uniqueness constraint
and explicit state machine make repeated execution return the existing record.
This includes the hard crash window: a surviving `RESERVED` record may need
human reconciliation, but it cannot redial.

The wire schema uses closed string enums and objects. Local validation is
stricter: unreachable and wrong-role contacts cannot contain factual answers;
completed tasks cannot carry failure codes; every returned contact and attempt
must match the approved phone; and unknown or extra fields are quarantined.

Fifty-eight offline tests cover the complete safety and integration boundary. The
demo makes three SDK submissions to a local fake server, produces two unique
fake calls, blocks two deliberate duplicate executions, and reports zero real
calls.

## Production validation

On September 13, the official US English hotline test returned a completed
83-second call. Consent was not confirmed, so the app ended the conversation,
kept all three propositions NOT_ESTABLISHED, and did not redial. The result
passed the same binding and closed-schema checks used in the local demo.
The original Malaysia / Mandarin request had been rejected before dialing;
we did not relabel the destination to bypass that restriction.

## Challenges we ran into

The difficult state is not a clean success or failure. If call creation times
out after the request crosses the network, retrying may call the same desk
twice. PawPassage therefore writes a durable reservation before submission and
turns uncertain acceptance into `SUBMISSION_UNKNOWN`, which cannot redial.

Structured output also needed stricter local rules than a JSON schema alone.
The validator rejects factual answers from an unreached or wrong-role contact,
extra fields, multiple attempts, mismatched metadata, and completed results
that still carry a failure code. Finally, we had to keep useful route evidence
separate from medical, legal, contractual, and border authority.

## Accomplishments that we're proud of

- The real official SDK create and read paths run in the credential-free demo,
  while all external phone side effects stay fake.
- Repeating both a successful intent and an ambiguous intent produces no
  second call request.
- Every material call input is bound to an exact human-approved SHA-256 digest.
- Reports omit full phone numbers, credentials, transcripts, identity records,
  and clinical data.
- Fifty-eight offline tests cover the integration boundary and fail-closed outcomes.

## Real-world impact

PawPassage helps a traveler find route-breaking discrepancies while there is
still time for a person to resolve them. It is useful to international and Hong
Kong-based travelers contacting supported destination or global service desks,
where current account routing permits calls. Malaysia / Mandarin was rejected during testing. The approach also reduces disclosure: a service desk hears
three operational propositions, not an animal's or owner's identity dossier.

## What we learned

The hardest part was not making the phone call; it was keeping the call inside
the authority it actually has. Provider acceptance can be ambiguous after a
network error, a completed status can still contain contradictory evidence, and
a verbal confirmation is not an official border or health decision. Modeling
those states explicitly made the happy path smaller and the product more honest.

## What's next

The production stop-on-unconfirmed-consent path has been exercised. Further
validation should cover a fully consented checklist conversation and practical
service-desk workflows when the provider route is available. Those outcomes
are not claimed here. Future work can add reviewed region adapters,
accessibility improvements and multilingual call-quality checks while keeping
the three-proposition and human-authority boundaries.

## Testing instructions

Paste the following into any testing-instructions or additional-information
field. Replace the placeholder with the public PR or repository permalink.

> Source and setup: `<PUBLIC_PR_OR_REPOSITORY_URL>`. PawPassage is a Python
> 3.11+ CLI. From `apps/python/pawpassage` in a clean virtual environment, run
> `python -m pip install -e . && python -m unittest discover -s tests -v`, then
> run `python -m pawpassage demo`. Open
> `artifacts/pawpassage-demo-report.html`. The demo needs no account, API key,
> real phone number, or network after installation. It starts a loopback fake
> server but exercises the official `calle-ai==0.7.0` SDK create and read paths.
> Expected output: 58 passing tests; `AIRLINE_DESK` is
> `EVIDENCE_PACKET_READY`; `DESTINATION_AUTHORITY` is `GAPS_FOUND` with
> `P1_CONTRADICTED`; `VET_SERVICE` is `SUBMISSION_UNKNOWN`; fake SDK
> submissions are 3; unique fake calls are 2; blocked duplicates are 2; and
> real calls are 0. Only fictional, masked contacts appear. This demo creates no production calls; a separate authorized production test is documented in LIVE_VALIDATION.md.

PowerShell reference setup:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m pawpassage demo
```

Open `artifacts/pawpassage-demo-report.html`. Confirm:

- `AIRLINE_DESK` is `EVIDENCE_PACKET_READY`;
- `DESTINATION_AUTHORITY` is `GAPS_FOUND` with `P1_CONTRADICTED`;
- `VET_SERVICE` is `SUBMISSION_UNKNOWN` / human reconciliation;
- fake SDK submissions are 3, unique fake calls are 2, blocked duplicates are
  2, and real calls are 0; and
- only masked phone numbers appear.

## Required links and private form answers

Do not submit placeholders. Complete these only after each target is public and
verified in a signed-out/private browser window.

| Form value | Paste-ready value |
| --- | --- |
| Pull request URL — required | `<PUBLIC_GITHUB_PR_URL>` |
| Video demo link — required | `<PUBLIC_YOUTUBE_OR_VIMEO_URL>` |
| CALL-E account email — required, private form field | `<CALL_E_ACCOUNT_EMAIL>` |
| Try it out / testing link | `<PUBLIC_PR_OR_REPOSITORY_PERMALINK>` |
| Functional demo app URL — optional | Leave blank; PawPassage is a local CLI and no hosted app currently exists. |

The public source link must expose the runnable app, MIT license, README,
fictional example, and tests without login or payment. Keep it available and
free through at least the end of judging on October 13, 2026 at 5:00 p.m. SGT.

## Thumbnail and image gallery plan

Devpost's current general submission guidance asks for a project thumbnail in
JPG, PNG, or GIF format, no larger than 5 MB, and recommends a 3:2 ratio. The
logged-in CALL-E form must still be checked for its exact required marker and
any event-specific size rules.

Use or export these original assets without external logos, stock imagery,
account chrome, private paths, notifications, or real contact details:

1. **Gallery thumbnail / cover — ready locally:**
   `assets/pawpassage-devpost-cover-v1.png`, 1536 × 1024 PNG, 1,733,139
   bytes, 3:2, and under 5 MB. Its adjacent `.prompt.txt` records the original
   image-generation prompt. It contains the exact title and subtitle, a
   three-checkpoint route motif, no third-party logo, and no claim that a real
   call occurred.
2. **Approval screenshot — ready locally:**
   `artifacts/video_draft/slides/02-approval.png`, 1920 × 1080. The masked
   recipient, P1–P3, prohibited actions, and approval digest are visible; the
   raw fictional case file is not shown.
3. **Evidence screenshot — ready locally:**
   `artifacts/video_draft/runtime/report-screenshot.png`, a 1920 × 1080
   Edge rendering of the freshly generated HTML report with all three outcome
   cards and `real calls: 0` visible.
4. **Verification screenshot — ready locally:**
   `artifacts/video_draft/slides/07-verification.png`, generated from a real
   completed run showing `Ran 40 tests`, `OK`, and the truthful SDK/provider
   status. The separate SDK slide shows `CalleClient.calls.create` and
   `wait_for_result` without usernames or local absolute paths.

Recommended gallery order: cover, evidence report, approval binding, test/SDK
verification. Re-open every exported image before upload and search visually
for phone numbers, email addresses, API keys, usernames, unrelated tabs, and
third-party copyrighted material.

## Demo video

Use [DEMO_SCRIPT.md](DEMO_SCRIPT.md). The generated local draft is 2:35,
1920 × 1080, and stays inside the required three-minute public video limit.
Its build inputs, hashes, real test output, and media probe are recorded in
`artifacts/video_draft/ASSET_MANIFEST.md`. It is not uploaded.

Suggested public video title:

`PawPassage — Approval-Gated CALL-E Evidence Checks (2:35 Demo)`

Suggested description:

> PawPassage turns three pre-approved service-desk questions into a
> privacy-minimized evidence matrix for cross-border pet journeys. This video
> shows the official CALL-E Python SDK running against the project's local fake
> server; the separate production test ended when consent was not confirmed. Source and test
> instructions: `<PUBLIC_GITHUB_PR_URL>`.

## Honest limitations

One production official-hotline call completed without confirmed consent or checklist answers. Multilingual quality is not validated.
No provider or authority endorses the project. Phone statements can be stale or
wrong. The tool is not an emergency, medical, legal, booking, or payment
service, and a human remains responsible for every next action.

## Participant-owned fields and actions

Do not infer or publish these from source code:

- submitter type, legal residence/incorporation, age and eligibility;
- organization and conflict-of-interest declarations;
- the email associated with the CALL-E account;
- public repository pull-request URL;
- public YouTube or Vimeo URL; and
- final Devpost submission.

Also confirm whether the submission is individual or team-owned, who is the
authorized representative, every teammate's participation, ownership of all
code/media, and any conflict-of-interest answer. Do not infer these from a
profile or prior conversation.

## Logged-in browser checks still required

The public pages do not expose the event's authenticated Additional Details
form. Before any upload or submission, use a logged-in browser in read-only
review mode to record:

- the exact labels, required/optional markers, character limits, and accepted
  URL formats for every CALL-E custom question;
- whether “Most Practical Use Case” is a selectable category or only a prize
  positioning choice;
- whether Devpost's generic Try it Out field is required for this event and
  whether the mandatory GitHub PR URL may also satisfy it;
- whether the thumbnail is mandatory and whether this event overrides the
  general 5 MB / 3:2 guidance;
- the exact team/submitter type, country-of-residence, eligibility,
  new-versus-existing, license, public-access, and ownership questions;
- whether a separate testing-instructions field exists;
- whether a YouTube “unlisted” video is accepted as publicly visible and
  embeddable, or whether the organizer requires fully public visibility;
- that the CALL-E account email is entered only into the intended private
  custom field and is not rendered in the public project story; and
- the final terms checkbox and any publicity/identity attestations.

Do not infer a missing field from generic Devpost documentation. Save a draft
only after the participant authorizes account changes; final submission needs a
separate explicit approval.

## Final no-placeholder gate

Before submission, search the entire Devpost draft for `<PUBLIC_`,
`<CALL_E_`, `TODO`, `TBD`, and local paths such as `D:\\`. The result must be
empty. Then verify the PR and video URLs in a signed-out window, play the full
video, confirm its runtime is below 3:00, and rerun the public checkout's test
and demo commands.

Before submission, the participant must review the rules, inspect the final
public diff and video for private data and third-party rights, approve the
public PR/upload actions, and enter every identity/legal field truthfully.
