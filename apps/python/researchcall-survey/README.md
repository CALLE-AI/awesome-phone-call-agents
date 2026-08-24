# Standardized survey runner

Run a telephone survey — and report it honestly afterwards.

A survey that dials is easy. A survey whose numbers survive scrutiny is not, and almost
every way of getting it wrong flatters the result. Four of those ways are structural here
rather than configurable.

## The denominator

Reporting completions against the people who *picked up* hides the non-response. The
shipped study makes the gap visible instead of leaving the reader to compute it:

```text
Drawn:          12
Withdrew:       1  (removed from the data and every denominator)
Included drawn: 11
Completed:      4

Completion yield: 36.4%  (4 of 11 included drawn)
  For contrast, not the result: 57.1% against the 7 who picked up.
```

Same four interviews, two very different numbers. The second is printed only as a contrast
and is labelled as not the result, because the distance between them *is* the non-response.

## Coding stays checkable

A category stored without the words it came from is unfalsifiable — nobody can later check
whether the reading was fair. So a coded answer without its raw text is refused at
construction:

```text
  [r05] What would have to change for you to use it more often?
      said:  "The last bus back is at half past six. That is the whole problem."
      coded: evening_service
```

An uncoded raw answer is fine. Coded-without-source is not.

## Withdrawal removes, it does not flag

A withdrawal deletes the identifier, the number and the answers **from the record itself**
— the drawn entry and the whole interview (person id, note, answers) leave memory, not
merely the rendered output — and the record leaves every later denominator. In the shipped
study one respondent completed the interview and then withdrew: their completion no longer
counts, the drawn total stays at 12, and `included_drawn` falls to 11. Regressions assert
that the data is gone from the record and that neither their id nor their number appears
anywhere in either output.

## Locked ethics

| Rule | |
| --- | --- |
| `ai_disclosure_before_consent` | The call states, before anything else and before it asks for consent, that an automated assistant is calling. |
| `explicit_consent_before_questions` | No question is asked before the person has consented in this call. |
| `right_to_stop_immediately` | The interview ends the moment the person asks, without a further question. |
| `right_to_withdraw_afterwards` | A withdrawal removes the identifier and the number, and the record leaves every later denominator. |
| `no_high_risk_topics` | Medical, legal, financial and emergency topics are refused, not handled — checked for the study subject and for every single question. |

`ai_disclosure_before_consent` is listed first because it is also an ordering requirement,
not only a rule to keep: consent obtained from someone who was never told they were talking
to a machine is not informed consent, so the disclosure has to land before the consent
question, not folded into it or spoken after.

A study file may **add** rules. It cannot overwrite these — the load path raises instead. A
survey whose consent requirement can be switched off in configuration does not have a
consent requirement.

## Setup

Python 3.11 or newer. No dependencies.

```bash
cd apps/python/researchcall-survey
python survey.py --fixture example-study.json
```

## Sampling

The seed is the point: same frame, same size, same seed — same people, same contact
windows. A sample nobody else can redraw cannot be checked by anybody.

Contact windows are spread across the day and the week, because calling everyone at eleven
in the morning samples the people who are home at eleven in the morning. Non-response is
reported per window, so that bias stays visible:

```text
Non-response by contact window:
  Mon-Fri 09-12: completed 2
  Mon-Fri 12-15: completed 1, consent_refused 1, no_answer 1
  Mon-Fri 15-18: busy 1
  Sat 10-14: broke_off 1, completed 1, ineligible 1, no_answer 1, not_attempted 1
```

## Safety

- **No calls.** There is no live transport and no `--live` flag in this edition. Every
  outcome comes from the study file.
- **No credentials.** No account, no API key, no network request of any kind.
- **One attempt per person.** No scheduler, no retry, no automatic second round. A person
  drawn twice is refused outright.
- **Numbers are validated as E.164 before processing** and masked in every output path. A
  regression asserts no full number reaches either output.
- **Fictional data only.** The frame uses the `+1 555-0100…555-0199` range, reserved for
  fiction and belonging to nobody. It stands in for a public directory listing filtered by
  postcode.
- **Cancellation.** Stopping the process stops it. Nothing was dispatched, so nothing needs
  recalling.

## Deliberate limits

- **`consent_refused`, `broke_off`, `no_answer`, `busy`, `voicemail`, `ineligible` and
  `not_attempted` stay distinct.** Collapsing them loses exactly the information a methods
  section needs — a mailbox pickup is not the same non-response as an unanswered line, and
  neither counts toward `reached`.
- **A break-off keeps no partial answers.** Someone who ended the call did not finish
  answering, and half an answer is not data — partial answers after stopping are deleted
  at construction, so they are never stored and never emitted.
- **High-risk subjects are refused at load time**, before a sample is even drawn — and
  every single question is screened again when it is constructed, because a benign
  subject can still smuggle in a medical, legal, financial or emergency question.
- Not for medical, legal, financial or emergency workflows — that is the same rule, stated
  where readers of this file expect it.

## Tests

```bash
cd apps/python/researchcall-survey
python -m pytest -q
```

```text
..............................................                           [100%]
46 passed in 0.50s
```

The regressions guard the ways a study could flatter itself: an irreproducible sample, a
person contacted twice, a locked ethics rule overwritten, disclosure spoken after consent
instead of before it, answers recorded without consent, a category without its source, the
wrong denominator, a mailbox pickup counted as reached, a withdrawal that only sets a flag
instead of deleting the data, a break-off that keeps partial answers, a high-risk question
hiding under a benign subject, and a full number reaching an output.

## The full application

This is a focused, self-contained proof of the instrument. The complete application —
the eight-station workbench, form definitions, ethics configuration, web interface and the
live CALL-E transport — lives at <https://github.com/ellmos-ai/researchcall>. It has since
been field-tested twice against the real CALL-E service (2026-08-11 and 2026-08-22), with a
live-verified withdrawal path -- a spoken deletion announcement, the local record actually
cleared, the number added to a do-not-call registry; its README carries a "How We Tested"
section, and its test suite currently stands at 293 passing.
