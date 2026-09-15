# PawPassage final demo script - September 13, 2026

Target: **2 minutes 35 seconds**, English narration and captions, desktop app.
Final local export: `artifacts/video_final_2026-09-13/PawPassage_Demo_2026-09-13.mp4`.
Publishing is a separate step; no public video URL is asserted here.

## Evidence boundary

Scenes 1-5 show the credential-free offline demo through the real official
Python SDK and a loopback fake server. Its `realCalls` remains zero. The HTML
screenshot is an explicitly labeled archival September 4 browser capture.
Its visible outcomes and counters match the fresh September 13 HTML/JSON
(after ignoring generated fake call identifiers). New browser capture was
unavailable; this screenshot is not represented as fresh footage. No account page or private material is shown.

Scene 6 summarizes the separate authorized production test in
[LIVE_VALIDATION.md](LIVE_VALIDATION.md). The API reported one completed
83-second US English hotline attempt. Consent was not confirmed; the voice
agent stopped and PawPassage returned `DO_NOT_CONTACT`. Every proposition stayed
`NOT_ESTABLISHED`. This demonstrates production integration and the stop outcome,
not successful checklist answers, a pet-journey workflow, or Mandarin quality.
The card contains no private call ID, recording, transcript, account, or recipient.

Scene 7 shows authentic output from 58 passing offline tests against a clean
installed wheel. A passing suite is not a production-readiness guarantee.

## 0:00-0:20 - The Problem

Visual: Original PawPassage cover with an explicit offline-demo badge.

> Moving with a pet crosses several organizations. A stale appointment rule can break the journey. PawPassage gives each service desk three approved propositions, then separates confirmed evidence, contradictions, and unresolved results. A phone answer never becomes travel clearance.

## 0:20-0:40 - Exact Human Approval

Visual: Generated masked preview, source, P1-P3, prohibited actions, and digest.

> The operator reviews the recipient, source, questions, disclosure, and prohibited actions. The digest binds the exact request, including the hidden phone number. Changes invalidate approval. The voice agent identifies itself, explains processing, and asks for consent before continuing.

## 0:40-1:02 - Official Sdk, Offline Demo

Visual: Checked SDK source excerpt and actual no-call demo command output.

> This reproducible demo sends real requests through the official Python SDK to a local fake server. It reads no credential and makes zero real calls. The same adapter provides production create and read operations. We show that separate production test later.

## 1:02-1:29 - Three Honest Outcomes

Visual: Archival September 4 browser screenshot; visible label says the same offline outcomes were reverified September 13.

> These are fictional responses from the running demo. The airline confirms the facts and offers a written reference. The arrival desk contradicts the appointment claim, so the report marks a gap. A simulated veterinary provider error leaves acceptance uncertain. PawPassage keeps that uncertainty for reconciliation instead of inventing an answer.

## 1:29-1:49 - Duplicates Stop Before The Provider

Visual: Actual demo counters: 3 submissions, 2 fake calls, 2 blocked duplicates, 0 real calls.

> The intent is reserved in SQLite before submission. Repeating the successful and uncertain demo requests adds no second provider request. The counters show three submissions, two fake calls, two blocked duplicates, and zero real calls. An ambiguous result never triggers automatic redial.

## 1:49-2:13 - Separate Production Test

Visual: Public-safe result summary: 83 seconds, US / en-US, DO_NOT_CONTACT, all questions NOT_ESTABLISHED.

> On September thirteenth, the same workflow called the organizer's US English test hotline. The API reported an eighty-three-second completed attempt. Consent was not confirmed, so the agent stopped. PawPassage recorded do not contact, with every question unresolved. This verifies integration and stopping, not successful pet-journey answers.

## 2:13-2:35 - Reproducible Verification

Visual: Authentic clean-wheel test output showing Ran 58 tests and OK; separately labeled production result.

> Fifty-eight offline tests passed against the clean installed package. Reports omit full contacts, credentials, recordings, and transcripts. The default demo is safe to reproduce without an account. Real calls require explicit approval. PawPassage leaves bookings, payments, and travel decisions with a human.

## Export and publication checks

- Original cover and local English TTS; no background music or third-party stock footage.
- English narration, captions, and visible prose.
- Exclude full phone numbers, credentials, private paths, emails, account UI, call IDs, recordings, and transcripts.
- Verify all seven scenes, caption layout, narration timing, audio presence, duration under three minutes, and a clean full FFmpeg decode.
- Publish to YouTube or Vimeo with public visibility, then verify the public link.
- Put that video link and the public contribution PR URL into Devpost. A local MP4, saved draft, or completed hotline attempt alone is not a completed submission.

Suggested title: `PawPassage - CALL-E Evidence Checks and Consent-Stop Test (2:35)`

Suggested description:

> PawPassage turns three operator-approved phone questions into a bounded evidence report for human review. The reproducible offline demo uses the official CALL-E Python SDK with a loopback fake server and makes zero real calls. A separate September 13 US English production hotline test returned DO_NOT_CONTACT when consent was not confirmed; no checklist answers were established. The demo also shows 58 passing clean-package tests. See the linked source PR for setup, limitations, and safe no-call evaluation.
