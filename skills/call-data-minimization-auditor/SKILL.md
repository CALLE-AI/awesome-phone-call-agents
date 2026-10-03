---
name: call-data-minimization-auditor
description: Offline experimental CALL-E transcript helper that audits whether the agent requests only the personal data the goal file requires, flagging out-of-scope PII asks, redundant re-asks and full-datum echo-backs, plus a minimal-collection goal template. It is not a legal determination, proof of unlawful collection, or authorization to act.
license: MIT
---

# call-data-minimization-auditor

> **The goal file is the shopping list. The agent buys the list - nothing
> else, not twice, and never reads the numbers back in full.**

Data minimization is the principle that a data collector asks for what the
task needs and nothing more (GDPR Article 5(1)(c): "adequate, relevant and
limited to what is necessary"). A calling agent that follows the principle
in its goal file but drifts on the line - "while I have you, what is your
date of birth?", re-asking a name it already captured, or repeating a full
card number back "to confirm" - collects data the task never authorized,
one polite sentence at a time.

On a phone call the risk compounds. The line is recorded, the transcript
is stored, and every extra datum the agent elicits or repeats in full
becomes another copy of sensitive personal data in another log. An agent
that asks for two fields and repeats one masked is a smaller liability
than one that asks for five and echoes a card number verbatim. This skill
audits the agent's asks against the goal file's scope, lexically and
offline.

## When To Use

- after any CALL-E call that collects personal data, together with the
  goal file (plain text or plan JSON) the call was built from
- when a transcript shows the agent asking for data nobody put in the
  goal, re-asking for data the caller already gave, or reading a full
  card or ID number back instead of a masked confirmation
- before placing calls, to craft a minimal-collection intake goal with an
  explicit fields list, a refusal line, a masking policy, and a
  no-re-asking rule

## What It Checks

### Verdicts

| Verdict | Meaning |
|---|---|
| `MINIMAL` | Every agent data request is in the goal's scope, none redundant, no full-datum echo |
| `OVERCOLLECTION_DETECTED` | At least one request is out of scope, redundant, or an echo of a full sensitive datum |
| `NO_DATA_REQUESTED` | The agent made no lexically detectable data requests (callee volunteering never counts against it) |
| `GOAL_FILE_LACKS_FIELD_LIST` | Requests exist but the goal file names no recognizable data categories; every request is `unverifiable` |

### The 14 categories

| Category | High sensitivity |
|---|---|
| `full_name`, `date_of_birth`, `address`, `email`, `phone_number` | - |
| `employer`, `income`, `relative_dob` | - |
| `payment_card`, `bank_account`, `national_id`, `credentials`, `passport`, `drivers_license` | yes |

### Rules

- **Request**: an agent sentence containing BOTH a category match (for
  example "card number", "date of birth", "where do you work") AND a
  request cue ("tell me", "verify", "can I have", "what's", ...). A
  category noun without a cue ("your card number is stored securely") is
  a statement, not a request. Callee turns are never scanned - what the
  caller volunteers is structurally never flagged.
- **Redundant re-ask**: a new request for a category the callee already
  provided (by answer shape, or an explicit "I already gave you"),
  unless the agent's previous turn or the re-ask sentence itself shows a
  hearing problem ("sorry", "didn't catch", "one more time", "louder").
- **Echo-back**: an agent turn repeating a 7+-digit run after a
  high-sensitivity number (card, bank account, SSN, passport, license)
  was provided - the agent should confirm masked (last two digits), not
  in full. Echo flags even when the category is in scope.

## Research Grounding

1. Regulation (EU) 2016/679 (GDPR), Article 5(1)(c) - principle of data
   minimisation: "adequate, relevant and limited to what is necessary" -
   https://eur-lex.europa.eu/eli/reg/2016/679/oj
2. European Data Protection Board - "AI Privacy Risks & Mitigations -
   Large Language Models (LLMs)" (published 2025-04-10, Support Pool of
   Experts report, Isabel Barbera; recommends input validation and
   filters to prevent over-collection of data) -
   https://www.edpb.europa.eu/documents/support-pool-of-experts/ai-privacy-risks-mitigations-large-language-models-llms_en
3. Ngong, Kadhe, Wang, Murugesan, Weisz, Dhurandhar, Natesan Ramamurthy -
   "Protecting Users From Themselves: Safeguarding Contextual Privacy in
   Interactions with Conversational Agents" - Findings of ACL 2025 -
   arXiv:2502.18509

## Limitations

- The goal file is the only ground truth for scope; a category the goal
  omits may still be lawful to collect, and findings route to review,
  never to automated action.
- Category detection is lexical: paraphrases outside the lexicon ("your
  nine digits", "the code on the back") are missed; "account number" may
  over-trigger `bank_account`.
- The re-ask excuse is lexical ("sorry", "didn't catch"); a genuine
  audio failure phrased differently still flags as redundant.
- English-only; ASCII transcripts.
- The skill audits the AGENT's asks, never what the callee volunteers.

## Usage

```bash
python3 scripts/data_minimization_auditor.py analyze \
  --transcript path/to/call-result.json --goal-file path/to/goal.txt
```

```bash
python3 scripts/data_minimization_auditor.py craft --scenario minimal-intake
```

See `references/examples.md` for byte-real runs and
`references/safety.md` for data-handling policy. The goal file is plain
text or a JSON object whose `goal`/`task`/`objective`/`required`/
`required_fields`/`needed`/`fields` values define the scope.
