# sentimentLive

Real-time event sentiment intelligence, delivered by voice.

An event planner pushes a question from their dashboard. CALL-E places outbound voice calls to opted-in attendees. Their verbal responses are transcribed, scored with Claude Haiku, and aggregated into a live sentiment alert while the event is still running.

## CALL-E integration

- POST /v1/calls per opted-in attendee with a custom voice prompt
- webhook_url receives the completed transcript
- metadata carries survey_id, question_id, opt_in_id through the call-to-webhook round-trip

## Why this is practical

Every major event platform (Cvent, Swoogo, Bizzabo) does post-event surveys. Nobody does real-time. The only blocker was placing the calls during a live event. CALL-E removes that blocker entirely. No Twilio setup, no IVR. 20 free calls is enough for a real 10-person demo.

## Stack

Next.js 15, Supabase Realtime, Claude Haiku, CALL-E

## Repo

https://github.com/thebobby0x/sentimentlive
