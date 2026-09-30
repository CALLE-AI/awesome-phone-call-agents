# Constraints: deciding whether an answer is good enough

A call that ends with a cheerful "yes, we can do that" is a **success** to the telephony
layer and can still be a **failure** to the user, because it costs sixty dollars over their
limit or lands two days after they needed it.

This is the single most important idea in the pattern. The loop replans on the constraint
verdict, not on the call status.

## Keep it deterministic

A model decides what was said. A comparison operator decides whether it is good enough.

Putting the money and the deadline behind a rule rather than a prompt is what makes the
approval screen trustworthy. "Do not accept anything over $500" in a system prompt is a
suggestion; `offer.price > limit` is not.

## Kinds

| Kind | `value` | Test |
|---|---|---|
| `budget` | a bare number | `offer.price <= value` |
| `deadline` | ISO date | `offer.eta <= value`, compared as dates, never as strings |
| `required_fact` | a field name | that field is present and non-empty |
| `forbidden` | a term | the term does not appear in the offer summary |
| `preference` | a term | the term appears in the offer summary |

## Four judgements, not two

| Judgement | Meaning | Blocks? |
|---|---|---|
| `satisfied` | Checked and met | no |
| `violated` | Checked and not met | **only if the constraint is hard** |
| `unknown` | Not enough information — no price was quoted | no |
| `not_applicable` | Constraint not configured | no |

`unknown` deliberately does not block. Refusing every offer that failed to mention a detail
nobody asked about on the call would strand every run behind a missing field. Surface it at
the approval step instead, where a human can weigh it.

Distinguishing `unknown` from `violated` is the whole reason a missing price must parse to
`null` rather than `0`.

## Hard and soft

- **Hard** — a violation disqualifies the offer. The agent keeps working.
- **Soft** — a violation only ranks the offer lower. The agent may still take it, and shows
  the violation at the approval step.

Among acceptable offers, rank by: fewest soft violations, then cheapest, then earliest. An
unquoted price sorts **last**, not free.

## Show soft and hard differently

On any screen a human uses to approve something, a soft violation must not look like a hard
one. Rendering "no reference number was given" with the same red cross as "$112 over your
limit" teaches the user that the crosses mean nothing — on the one screen where they must.
Use a distinct mark and colour.

## Stop at the first acceptable offer

Default to taking the first offer that satisfies every hard constraint, rather than
canvassing every remaining lead for a better one. With a metered account, exhaustive search
is not a neutral default: it spends the user's credits to improve an answer they already
said they would accept.

Make it a flag, not an assumption, so a caller with cheap credits can opt in.

## Declining must not loop

When the user declines an offer at the approval step, record that offer as declined. The
next planning pass must not propose it again. Without that, "no" is an infinite loop, and
the user's only escape is to abandon the run.
