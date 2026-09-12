---
name: homeworkhawk-graded-worksheet-callback
description: After an automated grading pipeline (HomeworkHawk, OpenCV 5) grades a finished worksheet photo, places one outbound CALL-E call to the parent delivering the results (score, which questions to review, which ones the system could not read confidently) and returns a structured follow-up confirmation (delivered / followup_confirmed / followup_time / parent_reaction) the grading app can store next to the worksheet.
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
itself escalated as unreadable, and confirms a review session for
tomorrow evening. The call returns a schema-validated result the
grading app can act on.

It is a **workflow skill** on top of CALL-E's one-off
`calls.createAndWait` SDK call — no new backend, no scheduler state.

## When To Use

- a grading/vision pipeline has produced per-question verdicts and
  should notify a parent by phone instead of (or alongside) an app
  notification
- any "perception finished → human should hear about it by phone"
  pattern: lab results briefings, inspection reports, review-session
  booking after an automated assessment

## Inputs

| field | type | notes |
| --- | --- | --- |
| `graded.json` | file | pipeline output: `{file, student_name, questions: [{index, expected, score, verdict, attempts}]}` |
| `--to` | E.164 phone | the parent's number |
| `--region` / `--locale` | CALL-E recipient settings | e.g. `US` / `en-US` |

## Result contract

```json
{
  "delivered": true,
  "followup_confirmed": true,
  "followup_time": "tomorrow 19:00",
  "parent_reaction": "positive"
}
```

## Run

```bash
git clone https://github.com/Zaichek/homeworkhawk-calle
cd homeworkhawk-calle && npm install
export CALLE_API_KEY=...   # dashboard.heycall-e.com
node notify.mjs graded.json --to +15550123456 --region US
```

The vision leg (photo → graded.json) is
[HomeworkHawk](https://github.com/Zaichek/homeworkhawk): pure OpenCV 5,
0.24 s/page on CPU, 93.3% handwritten-answer exact-read, with a
confidence-gated policy that escalates to a human instead of guessing.

## Safety

- The call never discusses the child in judgmental terms; the task
  prompt enforces a tutor-like tone.
- `verdict: escalated` questions are explicitly surfaced as "please
  check by hand" rather than graded wrong.
- One call per worksheet; no recurring schedule, no batch dialing of
  minors' data — the parent is the only recipient.
