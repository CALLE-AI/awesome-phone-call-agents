# ReadyCheck submission package

Prepared September 13, 2026. The user will upload the video and submit the Devpost entry.

## Release links and status

| Item            | Link or status                                                                                |
| --------------- | --------------------------------------------------------------------------------------------- |
| Source          | https://github.com/ankitlade12/readycheck                                                     |
| Contribution PR | https://github.com/CALLE-AI/awesome-phone-call-agents/pull/570                                |
| Hosted app      | Render Blueprint prepared; authentication and free/persistent plan choice pending             |
| Video           | `artifacts/release/readycheck-demo.mp4` — 2:18, narrated; upload publicly to YouTube or Vimeo |
| Screenshots     | `docs/images/readycheck-desktop.png` and `docs/images/readycheck-mobile.png`                  |
| License         | MIT; bundled font notices preserved                                                           |

The deadline is **September 14, 2026, 11:45 p.m. SGT / 10:45 a.m. America/Chicago**. Required materials include a contribution PR link, project description, public YouTube/Vimeo video under three minutes, and the email associated with the entrant's CALL-E account. A hosted URL is optional; provide free access to a working project or test build through judging. Check eligibility and the form before submission. [Official rules](https://call-e.devpost.com/rules).

Do not publish private CALL-E account details, recipient numbers, recordings, transcripts, or development credentials in this file or the video. Enter your CALL-E account email directly in Devpost's requested field.

## Devpost fields

### Project name

ReadyCheck — Know Before You Go

### Elevator pitch

Turn phone answers into a decision you can verify. Check the whole request, inspect the evidence, resolve the missing detail, and choose your next step.

### Inspiration

Finding a business is easy. Finding out whether it can meet every condition of a real request takes more work. A backpack repair might need the right service, a firm total, a Friday deadline, and a drop-off window that fits your schedule. One friendly answer is not enough to establish all four.

We wanted the result of an AI phone call to become something a person can inspect and act on with confidence about what is known and what remains uncertain.

### What it does

ReadyCheck turns repair, item/rental, and venue requests into structured must-haves and preferences. The user reviews recipients and questions before approving a CALL-E inquiry. The application saves the request, tracks provider progress, and compares extracted answers with each requirement.

Exact recipient quotes and supporting conversation segments sit beside the interpretation. Estimates, caveats, contradictions and missing answers remain distinct. The user can correct an interpretation with a reason, preview a focused follow-up, or explore a requirement change supported by a confirmed quote. Revisions preserve the original request.

The journey continues through a shortlist, a human-recorded arrangement or outcome, and an exportable case. ReadyCheck never books, pays, accepts terms, or marks real-world completion automatically.

### How we built it

The product uses React 19, Vite, strict TypeScript, Express and SQLite. The direct CALL-E Calls API adapter creates approved inquiries with a stable idempotency key and reads their status and structured results. Both extraction schemas constrain field IDs to the approved scope.

The application validates source quotes, keeps live material facts unconfirmed until reviewed, and evaluates requirements deterministically. A lost create response pauses the sequence. One explicit recovery action can replay the exact persisted body and original key; a durable marker prevents repeated recovery requests. Case evidence, raw result storage and terminal status commit atomically.

Two bounded repair methods correct supported dollar conversions and unique source-reference errors. Reviewed feedback enables fixed reminders or pauses a rejected method for that account. This is application memory, not model training.

### Challenges we ran into

Real calls exposed issues that successful HTTP requests did not reveal: a lost create response, recipient-only transcript indexes, unsupported extracted field names, a fee question before negotiation, and reversed roles in a drop-off question.

We reproduced the application defects with fake transports and regression cases. We added exact-request recovery, atomic result ingestion, stronger extraction contracts, contextual review, punctuation-aware price parsing, and post-call checks for identifiable conversation problems. We also shortened the caller instructions and unified the preview and spoken question definitions.

CALL-E controls live speech. The revised policy has passed local checks but still needs a new controlled live test; we do not claim that prompt changes alone guarantee natural negotiation.

### Accomplishments that we're proud of

A complete request-to-outcome interface, an evidence model that preserves uncertainty, reviewable correction history, explicit requirement revisions, and durable recovery that does not create replacement call intents. The current build passes 175 unit/API/fault tests, 45 synthetic evaluator cases and 17 browser workflows. Those are self-authored regressions, not an independent accuracy benchmark.

Earlier app-originated CALL-E calls established runtime execution and transcript persistence. We preserved the observed limitations instead of representing call completion as task success.

### What we learned

The difficult part is deciding what an answer supports. A starting price is different from a firm total; a reply to a compound or incorrectly worded question may be ambiguous; and a recovered transport request says nothing about conversation quality. The product must keep those distinctions visible and let the user decide the tradeoffs.

### What's next

Validate the revised negotiation and screening policy with consenting participants, measure extraction quality against independently reviewed calls, and study whether users complete their tasks with less coordination work. Public business discovery and broader dialing should follow that evidence, rather than precede it.

### Built with

TypeScript, React, Vite, Node.js, Express, SQLite, Zod, CALL-E Calls API, Playwright, Docker, GitHub Actions, Render Blueprint.

## Judge testing instructions

Use the README's credential-free local setup and fictional repair walkthrough. No CALL-E key, phone number, payment, or account is required for samples. The demo tests the complete comparison, evidence, focused follow-up, revision and outcome workflow. Live calling is disabled by default.

Source setup: `git clone https://github.com/ankitlade12/readycheck.git`, then `npm ci` and `npm run dev` with Node 24. Open http://localhost:3000. From the contribution checkout, run the same commands inside `apps/typescript/readycheck/`.

Public demo recordings show fictional examples. The historical live results and current voice-validation limitations are described in `docs/VERIFICATION.md`; private runtime evidence is not included in the repository.

## Video upload details

**Title:** ReadyCheck — Know Before You Go | CALL-E Hackathon Demo

**Description:**

ReadyCheck checks whether a repair service, item or venue meets the whole request, links answers to source evidence, and helps the user choose the next step.

This video records the working application's fictional sample workflow. No real calls are placed in the recording. Narration is generated speech. Earlier live CALL-E execution was tested separately; the revised conversation policy still needs live validation.

Source and setup: https://github.com/ankitlade12/readycheck

Contribution PR: https://github.com/CALLE-AI/awesome-phone-call-agents/pull/570

The walkthrough shows request review, comparison, transcript evidence, a focused follow-up, a shortlist and arrangement, a supported budget revision, and bounded correction memory. It does not represent a real booking or verified current business availability.

**Visibility:** Public on YouTube or Vimeo. Copy the resulting URL into the Devpost video field. The MP4 and captions are in `artifacts/release/`; upload the `.srt` file as English captions if supported.

## Final submission checklist

- [ ] Upload the MP4 publicly and verify playback and captions.
- [ ] Paste the contribution PR URL and project description into Devpost.
- [ ] Enter the email associated with your CALL-E account in the requested field.
- [ ] Add the hosted URL if deployed, or retain the local test-build instructions.
- [ ] Verify your entrant/team details and eligibility directly against the form and rules.
- [ ] Submit before the deadline and confirm that Devpost shows the entry as submitted.

## Demo narration

Finding a business is easy. Knowing whether it can meet your whole request takes more work. ReadyCheck helps you know before you go.

Imagine a backpack zipper repair, under forty dollars, ready by Friday, with a drop-off window that fits your schedule. ReadyCheck keeps all of those requirements together.

This walkthrough uses fictional businesses and responses. No phone calls are placed. In live mode, a user reviews the recipient and questions before approving a CALL-E inquiry.

Here are three sample answers. A starting estimate is not a confirmed total. A price above the budget stays a blocker, and a business offering the wrong service does not become a match just because it answered.

Open the evidence. The original words stay beside the interpretation, including conditions, timestamps, and the source conversation. In live mode, extracted material facts need human review. The user can correct an interpretation with a reason while retaining the original record.

ReadyCheck identifies the question that could change the decision. For this shop, the missing detail is the firm total. Preview that focused follow-up, then review its answer. The fictional final quote meets the budget, so the comparison updates without weakening the request.

The user can now shortlist the option and record an arrangement or outcome. ReadyCheck does not book, pay, accept terms, or claim the real-world task is finished on its own. Reloading preserves the case and its history.

There is another path. If a confirmed quote is over budget, explore that specific tradeoff. The user chooses whether to save a revised limit. The original version remains available for comparison.

Learning is deliberately bounded. Reviewed feedback enables or pauses known dollar and source-reference corrections for that account. It is application memory, not a model training itself.

CALL-E handles the actual phone interaction. ReadyCheck adds constrained extraction, durable recovery, and evidence review. Earlier live calls verified execution and transcript persistence, but the latest recorded call missed the intended negotiation. The revised voice policy still needs live validation.

The current build passes one hundred seventy-five unit and API tests, forty-five evaluator cases, and seventeen browser workflows. ReadyCheck turns phone answers into a decision you can inspect, and keeps the next step yours.
