# What `locale` actually does

CALL-E's schema documents `locale` as a **"BCP 47 hint"**. The word hint sets a low
expectation, and the expectation is wrong in a way worth writing down, because it changes
how you build anything that has to reach people who do not share a language.

## What was measured

Two rows of one work file, one command, one code path. The only difference between them is
one column.

| | S-3001 | S-3002 |
|---|---|---|
| `locale` | `en-IN` | `ta-IN` |
| goal, schema, prompt | identical | identical |
| conversation | fluent English | fluent Tamil |

Both calls were placed against `api.heycall-e.com` on 2026-09-04. The receipt is
[`../evidence/01-two-languages-one-command.json`](../evidence/01-two-languages-one-command.json)
and both call ids are in it.

The structured results came back:

| field | `en-IN` | `ta-IN` |
|---|---|---|
| `parent_confirmed_aware` | `yes` | `yes` |
| `reason_category` | `illness` | `illness` |
| `expected_return` | `tomorrow` | `tomorrow` |
| `free_text_note` | "Fever since last night. No additional information to add." | "Student has had fever since last night." |

**Every enumerated field is identical. Only the free-text note differs.** The agent held a
whole conversation in Tamil, including a follow-up question and a closing, and the
downstream code could not tell which language the call had been in.

## What that means if you are building

You do not need per-language prompts, per-language schemas, per-language result parsing, or
a translation step before you can act on an answer. One goal, one schema, and a locale
column on the row. The language becomes data, not a branch.

That is the difference between supporting one more language being a configuration change
and being a project. For any workflow with a legal or practical duty to reach people in
their own language, it is the whole cost model.

## Where this evidence stops

Be precise about what two calls can support.

- **n = 2, one language pair, one region.** English and Tamil, both `-IN`, one provider
  route. Nothing here says anything about a language CALL-E is weaker in.
- **The same person answered both calls and gave the same answer.** That is the honest
  limit of the result. It shows the extraction agreed across two languages *for the same
  information*; it is not evidence that extraction is language-independent in general. A
  proper version of this test needs different speakers giving different answers.
- **The free-text field is not stable and should not be compared.** It is prose, it
  differed, and code should not depend on it.
- **Language is not the biggest obstacle.** Calls to India arrived from a US caller ID
  (shown as Oakland CA). A family will not answer an unknown foreign number about their
  child, and no amount of language support fixes that. Reaching people is a routing problem
  before it is a language problem, and this app cannot solve the routing half.

## Why the hint framing is worth reporting

A developer reading "hint" reasonably assumes best-effort pronunciation, and builds a
translation layer they do not need. The observed behaviour is much stronger than the
documentation promises, and under-promising costs adopters real work.
