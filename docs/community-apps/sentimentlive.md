# sentimentLive

Proposed design: event feedback collected through explicitly authorized phone calls. No runnable implementation is available in the linked repository at review time.

The proposed workflow lets an event planner preview a question and authorize a bounded set of calls to opted-in attendees. CALL-E would collect verbal responses, and an experimental classifier could aggregate advisory sentiment for human review. This is a design reference, not a working application or a demonstrated real-time capability.

## Proposed CALL-E integration

- POST /v1/calls per opted-in attendee with a custom voice prompt
- webhook_url receives the completed transcript
- metadata carries survey_id, question_id, opt_in_id through the call-to-webhook round-trip

## Implementation boundaries

An implementation would need a fake/no-call default, explicit per-run intent, authorized E.164 recipients, masked output, secure credential handling, and a stop after ambiguous call outcomes. Sentiment would remain advisory. API support, delivery timing, and account allowances must be verified against current provider documentation; no competitor exclusivity or free-call allowance is claimed here.

## Proposed stack

Next.js 15, Supabase Realtime, Claude Haiku, CALL-E

## Repo

https://github.com/thebobby0x/sentimentlive
