# Worked Examples

All phone numbers are fictional carrier samples. Transcripts are
illustrative.

## Example 1 — default preview (no call)

An operator runs the workflow right after the grading pipeline wrote
`graded.json` (12 questions, 1 escalated):

```bash
node notify.mjs graded.json --to +12025550100 --region US
```

No call is placed. The skill returns the preview:

```json
{
  "mode": "preview",
  "delivered": false,
  "to_masked": "+1•••••0100",
  "script": "Hi, this is the homework assistant from HomeworkHawk. I'm calling with today's worksheet review for Alex — no grades, just what's worth a look together. Of the 12 questions, 8 look solid and 3 would be great to redo together; one of them I couldn't read confidently, so please check it by hand. Would tomorrow around 7 p.m. work for a quick review session?",
  "ambiguity_gate": "passed"
}
```

The operator reads the script, decides it is appropriate, and re-runs
with `--approve-call` to actually dial.

## Example 2 — approved call, delivered

Same worksheet, now approved:

```bash
node notify.mjs graded.json --to +12025550100 --region US --approve-call
```

CALL-E places one call to the authorized guardian number. The parent
answers, listens, confirms a session:

```json
{
  "mode": "call",
  "delivered": true,
  "to_masked": "+1•••••0100",
  "followup_confirmed": true,
  "followup_time": "tomorrow 19:00",
  "parent_reaction": "positive"
}
```

The app stores this next to the worksheet. A second run for the same
worksheet id does **not** dial again — it returns the stored result
(idempotency).

## Example 3 — ambiguity gate blocks the call

A blurry photo produced a result where 5 of 12 questions are
`escalated` and the student name could not be read:

```json
{
  "mode": "preview",
  "delivered": false,
  "blocked_reason": "ambiguous",
  "ambiguity_gate": "failed",
  "detail": "student_name unreadable; 5/12 questions escalated (limit 20%)"
}
```

Even with `--approve-call` the skill refuses to dial and hands the
result back to the app for human review. Nothing about the child is
spoken to anyone.

## Example 4 — unauthorized destination fails closed

The operator passes a number that is not the guardian contact on file
(the child's own phone, say):

```bash
node notify.mjs graded.json --to +12025550199 --region US --approve-call
```

```json
{
  "mode": "call",
  "delivered": false,
  "blocked_reason": "unauthorized_destination",
  "to_masked": "+1•••••0199"
}
```

No disclosure happens. Only the parent-configured allowlist number is
ever eligible.

## Example 5 — parent cancels mid-call

The call connects; the parent says they are driving. The agent offers
to end, the parent hangs up:

```json
{
  "mode": "call",
  "delivered": false,
  "ended_by_parent": true,
  "followup_confirmed": false
}
```

No redial. The app shows "callback not delivered — review in app"
instead. That worksheet has used its one allowed call attempt.

## Example 6 — out-of-scope request on the call

A parent asks the agent to read out a lab report from the same app.
The agent does not engage: "I can only go over the worksheet results —
a person from the clinic will call you about anything else," ends
politely, and the result records `ended_by_parent: true`. Medical,
legal, financial, and emergency content is out of scope by design.
