---
name: call-total-cost-disclosure-auditor
description: Offline experimental CALL-E transcript helper that detects the commitment question, locates the callee's consent, and grades whether the total price, recurring terms, and fees or restrictions were disclosed before that consent, flagging drip-pricing reveals that surface only after it, plus a transparent-offer goal template. It is not price verification, a legal ruling, or authorization to act.
license: MIT
---

# call-total-cost-disclosure-auditor

> **The price belongs before the question. Anything revealed after "yes"
> is a fee the person never agreed to.**

The FTC Telemarketing Sales Rule requires that, before a customer consents
to pay, the seller truthfully disclose the total cost to purchase, receive,
or use the goods or services. On agent-driven calls that timing is easy to
break: the agent asks for the booking first, and the deposit, the monthly
renewal, or the handling fee surfaces only after the callee has already
said yes. This skill finds the commitment elicitation, finds the consent,
and grades what the callee had been told before that moment.

The economic harm it targets is drip pricing: partitioned prices make
consumers underestimate the full cost at the decision point, because the
surcharges arrive after the mental commitment is already made. A call that
reveals a "small handling fee" one turn after "Yes, go ahead" is exactly
that pattern in transcript form - legal-sounding, auditable, and fixable
by front-loading the offer block.

## When To Use

- after any CALL-E call that ends in a booking, order, purchase, or
  subscription commitment
- when reviewing whether the callee could have known the full price
  before saying yes
- before placing calls, to craft a transparent-offer goal that states the
  full price before a single commitment question

## What It Checks

| Verdict | Meaning |
|---|---|
| `FULL_DISCLOSURE_BEFORE_CONSENT` | A total amount was stated pre-consent, and every required element (recurring terms, fees/restrictions) that appears in the call was also disclosed pre-consent |
| `PARTIAL_DISCLOSURE` | A total was stated, but a required element (recurring terms or fees/restrictions) appears in the call yet was not disclosed before consent |
| `COMMITMENT_WITHOUT_AMOUNT` | The agent elicited a monetary commitment with no total amount stated beforehand |
| `DRIP_PRICING_DETECTED` | After consent, the agent revealed a fee that had never been mentioned pre-consent, or a new amount absent from the pre-consent text |
| `NO_MONETARY_COMMITMENT` | No commitment elicitation detected in any agent turn |

Disclosure elements:

- `total_amount` - a digits-and-"dollars" amount lexicon (`$45`,
  `45 dollars`, `total comes to 45`) anywhere in the pre-consent agent text
- `recurring` - `per month`, `monthly`, `subscription`, `renews`, etc.;
  required if the term appears anywhere in the call, covered if it appears
  pre-consent
- `fees_restrictions` - fees, deposits, taxes, cancellation windows,
  expiry, minimums - or an explicit negation ("no additional fees",
  "fully refundable", "free cancellation")

Consent rule: the first callee turn after the elicitation whose FIRST
sentence is an assent ("sure", "yes, go ahead", "okay, book it") - decided
by the first sentence only, with a leading-negation guard ("No, but go
ahead if you must" and "Hmm, sure" are not consent). If the callee never
consents, the card still grades what was disclosed before the offer itself.

Drip pricing requires a consent point: a fee first mentioned only after
consent, or a post-consent amount whose normalized digits were absent
pre-consent (`$45.` and `$45` are the same amount). A recurring term
surfacing only after consent is not drip - it makes recurring
required-but-uncovered and yields `PARTIAL_DISCLOSURE`.

## Research Grounding

1. 16 CFR section 310.3(a)(1)(i), FTC Telemarketing Sales Rule - before a
   customer consents to pay, the seller must truthfully disclose "the
   total costs to purchase, receive, or use, and the quantity of" the
   goods or services -
   https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-310
2. Trade Regulation Rule on Unfair or Deceptive Fees ("Junk Fees Rule"),
   16 CFR Part 464 - Federal Register 2025-01-10 (doc 2024-30293),
   effective 2025-05-12 -
   https://www.federalregister.gov/documents/2025/01/10/2024-30293/trade-regulation-rule-on-unfair-or-deceptive-fees
3. Mahoney, Neale - "Why Regulate Junk Fees?" - Journal of Economic
   Perspectives 39(4):203-220, Fall 2025 - doi:10.1257/jep.20241409

## Limitations

- Presence-and-timing audit, not price verification: a stated total can be
  wrong or incomplete and still count as covered.
- Amounts lexicon is digits-and-"dollars" only: no number words ("a
  hundred twenty"), no non-USD currencies in v1.
- Multi-item calls may interleave disclosures; the skill does not bind
  amounts to the specific item the callee consented to.
- Consent and elicitation lexicons are lexical and English-only;
  uncontracted forms are covered ("let us get you signed up", "I will go
  ahead and book"), but paraphrases outside the lexicon are not.
- `_norm_amount` strips separators when comparing amounts, so "$45.50" and
  "4550 dollars" normalize identically; decimal-vs-separator collisions
  are an accepted ambiguity of the drip comparison.
- When no consent point is found, the call falls back to pre-elicitation
  grading and drip detection does not run; a drip-shaped call can card as
  COMMITMENT_WITHOUT_AMOUNT rather than DRIP_PRICING_DETECTED.
- ANY new amount after consent triggers drip detection, including
  legitimate new line items or later offers in the same call.
- counts.amounts_pre_consent counts regex mentions, not distinct amounts;
  a repeated "$45" spoken twice before consent counts as 2.
- Findings route to human review; this is not a legal ruling.

## Usage

```bash
python3 skills/call-total-cost-disclosure-auditor/scripts/total_cost_disclosure_auditor.py analyze \
  --transcript path/to/call-result.json
python3 skills/call-total-cost-disclosure-auditor/scripts/total_cost_disclosure_auditor.py craft \
  --scenario transparent-offer
```
