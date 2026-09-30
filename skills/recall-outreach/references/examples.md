# Worked examples

Four outcomes from one wave, and exactly what each does and does not establish. All numbers are
from the NANP `+1500555xxxx` test range; all names are fictional.

Run any of these through the validator:

```bash
node scripts/validate-result.mjs assets/sample-result-arranged.json
```

---

## 1. Arranged a collection — `sample-result-arranged.json`

The customer confirmed who they were, still had the kettle, understood the notice, and asked for
a Thursday morning collection.

```json
{
  "right_person_reached": "yes",
  "item_recognized": "yes",
  "item_status": "still_has_item",
  "notice_understood": "yes",
  "selected_next_step": "pickup_request",
  "preferred_time": "Thursday morning, before midday",
  "questions": "",
  "human_follow_up_required": "no",
  "contact_outcome": "resolved",
  "certainty": "high"
}
```

**What this establishes:** the right person was reached, understood the notice, and requested a
collection. It counts toward *right person reached*, *notice understood*, and *next step
selected*.

**What it does not establish:** that anything has been collected. Note that `contact_outcome` is
`resolved` — that field describes **the contact**, not the recall. A correct implementation must
not wire `contact_outcome: resolved` to a resolved customer state. This is the single most
likely place to introduce the bug this skill exists to prevent.

**Correct customer state:** `contacted`, with a pending collection request.

---

## 2. Out-of-scope question — `sample-result-escalated.json`

The customer asked about damage to their worktop. The campaign's approved answers cover refunds
and timing; they say nothing about consequential damage.

```json
{
  "right_person_reached": "yes",
  "notice_understood": "yes",
  "selected_next_step": "none",
  "questions": "It leaked and damaged my worktop. Can I claim for that?",
  "human_follow_up_required": "yes",
  "contact_outcome": "escalate",
  "certainty": "high"
}
```

**Correct handling:** the assistant did not answer, ended politely, and recorded the question
verbatim. Two follow-up items are created — one for the unanswered question, one for the
escalation flag — and the customer moves to `needs_human`.

**Counts toward:** *right person reached* and *notice understood*. **Not** *next step selected*:
`none` is a real answer meaning they declined to choose, and it must not be inflated.

This is a success, not a failure. The system did the right thing: it recognised the edge of its
approved material and handed over.

---

## 3. Not reached — `sample-result-not-reached.json`

Voicemail. The minimal message was left; the notice was not.

```json
{
  "right_person_reached": "no",
  "item_recognized": "unknown",
  "item_status": "unknown",
  "notice_understood": "unknown",
  "selected_next_step": "unknown",
  "questions": "",
  "human_follow_up_required": "unknown",
  "contact_outcome": "not_reached",
  "certainty": "unknown"
}
```

**Correct handling:** customer state `not_reached`, attempt count incremented, eligible for one
more wave if under the retry cap.

**The trap:** `certainty` is `unknown` here, and that is correct — the schema says `unknown` when
nobody was reached. A naive "escalate anything uncertain" rule will send **every voicemail** to a
human and bury the queue. Distinguish a clean miss (`right_person_reached: no`) from genuine
ambiguity (`right_person_reached: unknown`). Only the latter needs a person.

**Counts toward:** *call attempted* and *call completed*. Nothing else.

---

## 4. Unusable result — `sample-result-invalid.json`

The call completed, but what came back does not satisfy the contract: `item_status: "sold_it"`
and `selected_next_step: "refund"` are not enum members, and `agent_note` is an extra property.

**Correct handling:** record `resultState: invalid`, store the raw payload and the validation
error for inspection, move the customer to `needs_human`, and create a
`result_validation_failed` follow-up. **Read none of the fields**, not even the ones that look
fine — a payload that violates the contract is not partially trustworthy.

**Counts toward:** *call attempted* and *call completed*. Nothing above.

---

## The funnel these four produce

From one wave of four recipients:

| Measure | Count | Why |
| --- | --- | --- |
| Call attempted | 4 | all four were dialled |
| Call completed | 4 | all four calls finished |
| Result validated | 3 | one payload violated the contract |
| Right person reached | 2 | one voicemail, one invalid |
| Notice understood | 2 / 2 reached | both people who answered confirmed |
| Next step selected | 1 / 2 reached | one declined to choose |
| **Independently resolved** | **0** | **nobody has confirmed a physical return** |

A single "contacted" number here would read **4 of 4, 100%**. The honest reading is that two
people were reached, one collection was requested, one question needs a human, and nothing has
come back yet.

Report all seven. Never report one.
