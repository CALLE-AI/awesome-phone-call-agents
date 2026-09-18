---
name: homeworkhawk-graded-worksheet-callback
description: After an automated grading pipeline (HomeworkHawk, OpenCV 5) grades a finished worksheet photo, optionally places ONE outbound CALL-E call to a verified parent/guardian delivering advisory results (score, which questions to review, which ones the system could not read confidently). Default mode is a no-call preview that returns the exact script and result schema; a real call requires explicit operator approval, an authorized guardian destination, and an unambiguous grading result. Returns a structured confirmation (delivered / followup_confirmed / followup_time / parent_reaction) the grading app can store next to the worksheet.
license: MIT
---

# HomeworkHawk — Graded Worksheet Callback

## Why this exists

Automated homework grading is only useful if the results reach the
parent. A grading result that lives in a dashboard nobody opens at work
is a dead end. This skill closes the loop: when a grading pipeline
finishes a worksheet, it hands the structured result to CALL-E, which
phones the parent, delivers the summary in a warm and non-judgmental
tone, names the questions worth reviewing, flags the ones the system
itself escalated as unreadable, and offers a review session for
tomorrow evening. The call returns a schema-validated result the
grading app can act on.

It is a **workflow skill** on top of CALL-E's one-off
`calls.createAndWait` SDK call — no new backend, no scheduler state.

**The grading result is advisory.** It tells a parent what to look at
together with their child; it is never an official grade, a judgment of
the child, or a placement decision.

## Default: preview, no call

Running the skill **without `--approve-call` places no call**. Preview
mode prints (and returns as JSON):

- the exact script the agent would read, with the student name and any
  escalated questions included,
- the destination number as it will be dialed (masked in all output),
- the result contract the app will receive.

```bash
# default — safe: renders the script, dials nobody
node notify.mjs graded.json --to +15550123456 --region US

# real call — only with an explicit approval flag, a verified
# guardian number, and a grading result that passed the
# ambiguity gate (see Safety)
node notify.mjs graded.json --to +15550123456 --region US --approve-call
```

## When To Use

- a grading/vision pipeline has produced per-question verdicts and the
  **parent/guardian has explicitly opted in** to a phone callback
  instead of (or alongside) an app notification
- any "perception finished → an authorized adult should hear about it
  by phone" pattern: inspection reports, review-session booking after
  an automated assessment

**Not for:** medical, lab-result, legal, financial, or emergency
notifications of any kind. A homework score is advisory educational
feedback; this skill must never be repurposed to deliver health or
lab results — those require a licensed professional in the loop, and
this skill provides none.

## Inputs

| field | type | notes |
| --- | --- | --- |
| `graded.json` | file | pipeline output: `{file, student_name, questions: [{index, expected, score, verdict, attempts}]}` |
| `--to` | E.164 phone | the **verified parent/guardian** number (must be on the allowlist the parent set up; never taken from the worksheet, the child, or a third party) |
| `--region` / `--locale` | CALL-E recipient settings | e.g. `US` / `en-US` |
| `--approve-call` | flag | required for a real dial; omitted = preview only |

## Result contract

```json
{
  "delivered": true,
  "followup_confirmed": true,
  "followup_time": "tomorrow 19:00",
  "parent_reaction": "positive"
}
```

In preview mode the same shape is returned with `"delivered": false`
and `"mode": "preview"`. Phone numbers are **masked in every output**
(`+1•••••0123`), including logs, transcripts, and error messages.

## Run

```bash
git clone https://github.com/Zaichek/homeworkhawk-calle
cd homeworkhawk-calle && npm install
export CALLE_API_KEY=...   # dashboard.heycall-e.com — never logged or embedded in prompts
node notify.mjs graded.json --to +15550123456 --region US            # preview
node notify.mjs graded.json --to +15550123456 --region US --approve-call
```

The vision leg (photo → graded.json) is
[HomeworkHawk](https://github.com/Zaichek/homeworkhawk): pure OpenCV 5,
0.24 s/page on CPU, 93.3% handwritten-answer exact-read, with a
confidence-gated policy that escalates to a human instead of guessing.

## Safety

Full rules in [references/safety.md](references/safety.md). Summary:

- **Default no-call.** Preview is the default; a real dial needs the
  explicit `--approve-call` operator approval, per call.
- **Authorized guardian only.** The destination must be the
  parent/guardian contact on file. The skill refuses to disclose
  anything about the child to an unverified number, a number supplied
  by the child, or any third party.
- **Ambiguity stops the call.** If the grading result fails the
  ambiguity gate (unreadable student name, >20% of questions escalated,
  missing verdict fields), the skill places no call and returns the
  result to the app for a human to review first.
- **Advisory framing.** The script reports what to review together —
  never "your child failed", never a grade, never a ranking.
- **Cancellation limits.** Stop before submission to avoid placing the
  call. After submission, Ctrl-C only stops the local workflow; it does
  not confirm provider cancellation, and the call may still connect or
  continue. The parent can hang up, and the agent ends politely. The skill never
  redials on its own — at most one call per worksheet, ever.
- **No schedules, no duplicates.** No hidden recurring jobs; one call
  per worksheet idempotency key; a follow-up session is booked as a
  *human* calendar entry, not another automated call.
- **Boundaries.** No medical/lab-result, legal, financial, or
  emergency content, with or without supervision; those categories are
  out of scope by design.

Detailed worked examples: [references/examples.md](references/examples.md).
