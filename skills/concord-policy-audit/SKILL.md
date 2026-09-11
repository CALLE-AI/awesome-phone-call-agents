---
name: concord-policy-audit
description: Audit what your own branches tell callers by phone, judge each answer against written policy, and return a branch-level gap register that is deliberately unusable as a staff performance record.
license: MIT
---

# Concord

Use this skill when an operator wants to know whether their own locations give
callers the answer their policy requires: a pharmacy chain checking counter
advice, a clinic network checking triage instructions, an insurer checking how
branches describe a term.

Concord calls branches the operator owns, asks a fixed set of questions, records
what was said, and rules each answer against a written rubric. It reports on
branches, never on people.

## When not to use

- The lines belong to someone else. Concord audits an operator's own estate.
  Calling a competitor's shop to score their staff is not this tool.
- The user wants to identify, rank or discipline the individual who answered.
  Decline. That is the boundary the product is built around, not a setting.
- The user wants a customer survey, a sales call, or a line-health check. For
  whether a line technically works, use `linecanary-monitor` instead. Concord
  judges what a human said, not whether the phone rang.

## Required inputs

- the operator organisation and who requested the audit
- one to twelve branches, each with an E.164 number and a written
  authorization reference showing the operator owns that line
- the branches' timezone and weekday call window
- a rubric: a scenario plus criteria, each with the question to ask, the policy
  in the policy's own words, the field to extract, and the answer policy requires

Do not invent policy. The rubric is written by whoever owns the policy, and
Concord reads it rather than inferring it.

## Workflow

1. Write the rubric and the audit file. See `assets/`.
2. Run `concord task` to show the operator the exact words branches will hear
   and the schema the call must answer in.
3. Run `concord preview` for masked numbers, the call count and an approval
   token bound to that exact audit.
4. Pause for explicit approval. Asking for a preview is not approval to call.
5. Run the exact command preview printed. A live run needs `--live`, the
   matching token, and an open weekday window, all three.
6. Present the gap register. Deviations first, then unresolved answers.
7. Route every finding to the branch, never to a named person.

## How the rubric becomes the call

Each criterion contributes one enum-constrained field plus a quote property to
the CALL-E `recipient_result_schema`. The policy document therefore defines what
the call is allowed to return, and a criterion the rubric does not contain
cannot appear in a result.

## Rules

- Rule on the extracted value, never on the transcript text. Matching phrases
  against free speech cannot read negation: "No, you don't need a prescription"
  contains "need a prescription". See `references/examples.md`.
- Silence is not failure. An unreached branch, or an answer the call could not
  resolve, is `UNCLEAR` and goes to a human. Never let a bad phone line read as
  a policy breach.
- A value outside the rubric's options is unresolved, not the nearest match.
- Never produce per-person output, a branch league table, or a percentage that
  could be pasted into an appraisal.
- Never coach or correct the person answering during the call.
- Do not persist transcripts unless the operator states a retention purpose.

## Useful commands

The reference implementation is [`apps/python/concord`](../../apps/python/concord/).

```bash
concord task     fixtures/example-audit.json --rubric rubrics/emergency-contraception.json
concord preview  fixtures/example-audit.json --rubric rubrics/emergency-contraception.json
concord judge    fixtures/example-audit.json --rubric rubrics/emergency-contraception.json \
                 --results fixtures/completed-audit.json
```

`task`, `preview` and `judge` never place a call.
