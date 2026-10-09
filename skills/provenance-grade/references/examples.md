# Worked examples

Three end-to-end examples distilled from the bundled fixtures (all synthetic; run
them yourself with `npm test` / `npm run eval`). Turn shape mirrors CALL-E:
`recipients[i].attempts[j].transcript_turns[k] = { speaker, text, offset_seconds }`.

## 1. `verified` — the answer was looked up (fixture 01)

Transcript:

```
bot   t=9   "Which day will the fifty units for order 7741 ship out?"
user  t=14  "Hold on, let me check the dispatch register."
user  t=26  "It ships Tuesday. We are holding eleven units at the Bhiwandi warehouse for you."
```

Input field spec → output:

```ts
gradeCall({
  callId: 'call_123', recipientId: 'org_456', turns,
  fields: [{ field: 'delivery_day', value: 'Tuesday', expects: 'weekday',
             questionTurn: 2, answerTurns: [4], readbackRequested: false, critical: true }],
});
// field result:
{
  field: 'delivery_day', value: 'Tuesday', grade: 'verified',
  signals: [ 'A:gap=12.6s', 'B:hold on', "C:stock_count 'eleven units'", "C:place 'Bhiwandi'" ],
  span: 'It ships Tuesday. We are holding eleven units at the Bhiwandi warehouse for you.',
  turnOffset: 26, unstable: false, gapSeconds: 12.6
}
```

Why: retrieval gap (A) and check language (B) plus two corroborating specifics
nobody asked for (C) satisfy the verified row of the rule table.

## 2. `assumed` — same answer, guessed (fixture 05)

```
bot   t=9   "Which day will the fifty units for order 7741 ship out?"
user  t=14  "Should be Tuesday."
```

Same field spec shape → output:

```ts
{
  field: 'delivery_day', value: 'Tuesday', grade: 'assumed',
  signals: [ 'D:should be' ],
  span: 'Should be Tuesday.',
  turnOffset: 14, unstable: false, gapSeconds: 0.6
}
```

Why: the hedge ("should be", signal D) drops the field to `assumed` regardless of
anything else. Same extracted value as example 1 — different knowledge. Per the
consumer rule, a workflow must never auto-act on this field.

## 3. `unstated` — the call never answered it (fixture 17, voicemail)

```
bot   t=0   "Hi, this is the QuoteDesk assistant calling about your pending order."
user  t=6   "You have reached Sharma Traders. We are closed right now. Please leave a message…"
```

Field spec with `answerTurns: []` → output:

```ts
{ field: 'eta_days', value: null, grade: 'unstated',
  signals: [], span: '', turnOffset: null, unstable: false, gapSeconds: null }
```

Why: a field absent from the transcript is `unstated` — never a grade, and never
auto-actionable. `weakestGrade` for this call is `unstated`.

## 4. Pre-call lint

```bash
printf '{"task":"Call the supplier. Do you know the unit price?",
         "critical_fields":["unit_price"],"result_schema":{"type":"object"}}' \
  | node scripts/lint-task.ts
```

Output (abridged): rewrites "do you know" → "can you check" (elicits B), appends a
read-back instruction (elicits F), asks for one corroborating specific (elicits C),
grants permission to wait for a lookup (elicits A/B), and annotates
`x-provenance-critical` in the schema. Amendments are listed so the host can show a
diff before dispatch.
