# What `locale` actually does

CALL-E's schema documents `locale` as a **"BCP 47 locale hint for the conversation"**, on
the `locale` attribute of `CallTaskRecipientRequest` in `calle/generated/models/`. The word
hint sets a low expectation. Ten real calls say the expectation is wrong, and they also say the failure sits
somewhere other than where you would look for it.

Ten, and then eight, and the difference between those two numbers matters enough to state
before anything else. Ten calls bear on `locale`: the two that first suggested this, placed
by one command in `en-IN` and `ta-IN` and coming back with identical extracted fields, and
the eight below. The eight are the measurement, run afterwards as four matched pairs
because two calls agreeing is an anecdote. Every count in this document after this
paragraph refers to the eight.

## This repository already has a skill that depends on this being true

[`skills/language-bridge-call`](../../../../skills/language-bridge-call/SKILL.md) places one
call in the recipient's language and one back in the requester's, and returns a structured
outcome from both. Its whole premise is that CALL-E holds a real conversation in the
recipient's language and still returns a result the caller's code can read.

That skill is well scoped and its safety boundaries are good. What it does not have is
evidence: its preview "does not dial", and its fixtures are fixtures. What follows is the
missing half, offered as support for that skill's premise rather than as a competing claim.

## The measurement

Eight live calls against `api.heycall-e.com`, in four matched pairs. One of them ran on its
own first, so that a mistake in the design would cost one call instead of eight. Each pair is one
scenario answered in `en-IN` and in `ta-IN`, by the same speaker, with the same goal, the
same schema and the same code path. Only the locale column differs.

The comparison was **written down before any call was placed**: three enumerated fields
across four pairs, twelve comparisons. `free_text_note` was excluded in advance because it
is prose and code should not depend on it. No pair was dropped afterwards and no field was
added.

| Pair | Scenario |
|---|---|
| 1 | Illness, returning soon |
| 2 | Family emergency, no return date |
| 3 | Parent did not know about the absence |
| 4 | Refusal: "I'm at work, I can't talk now" |

## The result, and the part that matters

**Nine of twelve matched. Three did not.** Reading the transcripts accounts for all three
without a single extraction error.

| Pair | Field | What the two calls actually contained |
|---|---|---|
| 1 | `expected_return` | English: "she will be back tomorrow" gives `tomorrow`. Tamil: "if the fever gets better we'll come", **no date offered**, gives `unknown`. Both correct |
| 2 | `expected_return` | English: "I don't know when" gives `unknown`. Tamil: "maybe a couple of days" gives `later_this_week`. Both correct |
| 2 | `reason_category` | The speaker said *family emergency* in both. The Tamil transcript records **"family annual"**. From a transcript that says nothing, `other` is the right answer |

So the honest headline is not nine of twelve:

> **Extraction was faithful to the transcript in twelve of twelve, in both languages. Two of
> the three mismatches are the speaker saying different things, and one is transcription.**

## Where the failure actually lives

Two transcription errors turned up across these calls, one in each language:

| Locale | Said | Transcribed | Extracted |
|---|---|---|---|
| `en-IN` | "high fever" | "5 fevers" | `reason_category: illness`, correct |
| `ta-IN` | "family emergency" | "family annual" | `reason_category: other`, correct given the text |

Both times the structured result was right and the transcript was wrong. Whatever performs
the extraction is not naively reading the ASR output.

**This is the operational point.** Build on `transcript_turns[]` and you will one day print
"5 fevers" to a school office as a parent's own words. Build on the structured result and
you will not. Treat the transcript as a display artefact and the structured result as the
data, which is the opposite of the intuition most people start with.

## The safety rule holds across languages

Pairs 3 and 4 agreed on all six comparisons.

- **The refusal returned every required field as `unknown` in both English and Tamil.** The
  rule this app added after a refusal was once scored `resolved` is therefore not
  language-dependent. See [`proving-a-gate-fires.md`](proving-a-gate-fires.md), mutation 10.
- **`parent_confirmed_aware: no` came back correctly in both**, which is the safeguarding
  case: a parent who did not know their child was absent at all.

Of everything measured here, that is the result worth having. A safety rule that works in
the language the app was written in and quietly fails in the other one is worse than no rule
at all, because it fails exactly where nobody is checking.

## What this removes from a multilingual build

No per-language prompts, no per-language schemas, no per-language result parsing, no
translation step before you can act on an answer. One goal, one schema, and a locale column
on the row. Adding a language becomes a configuration change instead of a project.

## Where this evidence stops

- **None of it applies to a United States number.** CALL-E offers English and no other
  language in the US (`calle_double/regions.py`, mirroring the vendor's own region table),
  so the effect measured here cannot be delivered where every figure in this entry is
  priced. That is why this experiment was run to India in the first place, and it is the
  limit a district decides on rather than a caveat about method. Reproduce it with no
  account: `python -m firstbell --work-file examples/absences-oneroster.csv` prints
  `unsupported_language: Spanish is not available for United States of America` on the
  second row. This list named four things and did not name this one for a fortnight, while
  naming the inverse below it, which is the more embarrassing half.
- **One speaker, bilingual, who knew what was being tested.** The largest remaining
  confound, and not fixable here.
- **The matched-pair control failed twice.** A bilingual person cannot reliably say the same
  thing twice from memory, which is exactly how pairs 1 and 2 diverged. A stronger version
  needs a written script per language, agreed before dialling, or different speakers.
- **One language pair, one region.** Nothing here speaks to a language CALL-E is weaker in,
  and Tamil is not low-resource.
- **Language is not the biggest obstacle anyway.** These calls to India arrived from a US
  caller ID, shown as Oakland CA. A family will not answer an unknown foreign number about
  their child. Reaching people is a routing problem before it is a language problem, and
  this app cannot solve the routing half.

## Verify it

Every one of these calls is listed on the [evidence page](https://firstbell-evidence.vercel.app)
with the two ids CALL-E issues for it. The API's `id` resolves through
`GET /v1/calls/{id}`, which places no call, and the `provider_call_id` beside it appears on
CALL-E's own usage page with the duration and the charge. So the claims above can be checked
against the vendor's records and not only against ours.

Neither id is in this repository. They identify real conversations, and
[`../evidence/README.md`](../evidence/README.md) explains why that keeps them out of the
tree; `../tests/test_privacy.py` is what enforces it. The reasoning, the pre-registration
and the counts above are all here, because none of them names a call. See also
[`receipt-provenance.md`](receipt-provenance.md) for what makes a receipt checkable in the
first place.
