# Lead Qualification Playbook

Companion reference for the `lead-qualification-call` skill. It standardizes what
the call should capture and how the human sales owner should read the result.

## Qualification frame

The call captures four things, in the lead's own words:

| Dimension | What good evidence sounds like | Red flag |
| --- | --- | --- |
| Need | "we currently do this in spreadsheets and it breaks every month" | vague restatement of the caller's pitch |
| Timeline | "we want something in place before Q4" | "someday", "just curious" |
| Authority | "I own the tooling budget for my team" | "I would have to ask" (record as `influencer`, not a failure) |
| Budget range | "we spend around $200 a month on this today" | refuses the range (allowed — budget is optional) |

Only one budget question is allowed, and it must offer a decline path, for
example: "if you are comfortable sharing, roughly what does the team spend on
this problem today — or would you rather leave that out?"

## Reading the structured result

- `disposition=qualified` requires explicit interest evidence plus a usable
  timeline. Everything else stays `needs_human_review` if any answer is ambiguous.
- `interest_level` is the caller's judgment, not the lead's statement. Quote the
  transcript span that justifies it in `evidence`.
- `budget_range` records the range the lead chose to share. It is a quote, not a
  verified fact. Never derive a number the lead did not say.
- `consent_to_followup` is channel-specific and opt-in only. Silence, "maybe",
  and "sure" without a channel are `unknown`, not consent.

## Dispositions

- `qualified`: need + timeline evidence captured, follow-up consent obtained or
  a channel conversation happened.
- `disqualified`: a `disqualify_on` condition surfaced. Record the reason in the
  lead's words. Do not argue, do not attempt to save the call.
- `voicemail`: approved message left. Nothing else happens until the lead replies.
- `wrong_number` / `declined` / `no_answer`: end politely. No retries from this skill.

## Anti-patterns

- Turning the call into a demo pitch after the first positive signal.
- Asking "who else should I talk to?" before the lead has answered the core
  qualification questions — capture the answer, leave contact expansion to the human.
- Promising a meeting on the call. The human owner books it after review.
- Treating `interest_level: high` as permission to skip consent for follow-up.
