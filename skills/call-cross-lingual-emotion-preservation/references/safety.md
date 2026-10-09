# Safety: call-cross-lingual-emotion-preservation

## Data handling

- The skill never places calls and makes no network requests.
- Evidence spans use a limited ASCII digit-run masker that retains the last
  two characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- The intensity lexicon is English-only and bounded on BOTH inputs. Supply
  English source and relay text, or operator-prepared English translations.
  Non-English text is out of scope and can produce misleading low scores;
  the script does not detect language eligibility.
- There is no negation handling: phrases like "no danger" or "nothing
  important" still count their marker words. Treat marginal high-vs-medium
  boundaries with human judgment.
- Drift findings are a reason to re-check the relay wording, not proof of
  harm; AMPLIFIED is flagged symmetrically with FLATTENED because
  over-urgency can also misrepresent the requester.
- Only the relay agent's own turns are scored; the requester's private
  emotional state is inferred from words alone, never asserted as fact.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; a suggested follow-up is not permission to call again.
