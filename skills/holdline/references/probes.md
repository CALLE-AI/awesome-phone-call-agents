# Writing probes

A probe is how the gate recognises that the agent raised a topic. It is a list
of phrases matched case-insensitively against the turns the agent spoke.

```json
{
  "name": "accepts_new_patients",
  "asks": ["new patients", "accepting new", "taking patients"],
  "required": true
}
```

## The trade you are making

Matching is lexical. It cannot see a paraphrase.

If the agent asks *"is your list open, or are you full?"* and the probes only
contain `"new patients"`, the gate finds no match. It does not accuse the field
of being invented — a question was asked and answered, so it returns
`unattributed` — but it does withhold the value. A real answer is lost.

The measured cost, from the engine repository's `npm run eval` over 400 seeded
cases — reproduce it there, not from this directory:

| | |
| --- | --- |
| Invented values caught | 50/50 — 100% |
| Paraphrases wrongly accused of invention | 0/50 — 0% |
| Paraphrases withheld | 50/50 — 100% |
| Prose non-answers caught | 50/50 — 100% |
| Genuine prose answers wrongly withheld | 0/50 — 0% |
| Topic mentioned but never asked, caught | 50/50 — 100% |

Every paraphrase in that corpus is withheld. Better probes are the only thing
that moves that number.

## Rules that help

**Write what the agent says, not what the field is called.** The field is
`reference_status`; the agent says *"the status of reference 88431"*. Probe on
`"status of"` and `"reference"`, never on `"reference_status"`.

**Prefer short, common fragments.** `"in stock"` matches far more phrasings
than `"do you have that part in stock today"`.

**Cover the two or three ways a question is normally put.** Reading the task
text aloud and writing down the phrasings you would naturally use gets most of
the way there.

**Do not probe on words the answer contains.** `"yes"` matches nothing useful
and will match the wrong turn. Probes match the agent's turns only, never the
other party's — a caller volunteering information is not the agent verifying
it.

**Avoid a phrase that appears in the greeting or the sign-off.** `"thank you"`
or `"calling on behalf"` appear in almost every call and would mark every field
as asked.

## Regular expressions

An `asks` entry may be a regular expression when a substring is too blunt:

```ts
{ field: "reached_department", required: true, asks: [/am i (through|speaking) to/i, "department"] }
```

Keep them anchored to distinctive vocabulary. A pattern broad enough to match
any question defeats the check entirely — the gate would mark everything asked
and verify values the call never established.

## When a probe misses anyway

Every gate report carries `unclaimedQuestions` — the questions the agent asked
that no probe claimed, quoted exactly. That list is the repair kit: read it
after a run, and if one of those questions is the one you meant to ask, paste
its wording into that field's `asks`.

There is also a fallback for the case where you cannot fix the probe. If
exactly one question went unclaimed and exactly one field went unmatched, the
answer cannot have come from anywhere else, and enabling
`attributeByElimination` returns it with the verdict `attributed` rather than
withholding it. Measured on the evaluation corpus, that recovered every
withheld answer without letting a single unestablished value through — but that
corpus probes one field per call, which is the friendliest possible case. It is
off by default for a reason.

## Checking your probes

Run a call in simulation and read the `supportingTurn` on each field. It quotes
the exact turn the probe matched. If that quote is not the question you meant,
the probe is matching the wrong thing, and the field is being verified against
the wrong evidence.

From a clone of the engine repository — this skill directory holds no runnable
code, so the command does nothing from here:

```bash
git clone https://github.com/Elioz404/HOLDLINE && cd HOLDLINE && npm install
HOLDLINE_SIMULATE=1 npm run mcp
```
