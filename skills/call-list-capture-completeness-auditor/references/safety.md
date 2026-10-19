# Safety: call-list-capture-completeness-auditor

**This skill audits transcripts after the call has ended. No verdict is
a record of what was actually promised, ordered, or agreed: it is a
heuristic grade of transcript text for human review only.**

## Boundaries

- The skill never places calls and makes no network requests.
- No verdict authorizes any business action: do not charge, book,
  cancel, or promise anything on the basis of an output.
- `ITEMS_ADDED` flags items the transcript does not tie back to the
  callee; it does not prove the agent lied, and `ITEMS_DROPPED` does
  not prove the request was lost - both are review pointers.
- All outputs are advisory for human reviewers; no automated action,
  reconciliation, or deployment decision is authorized by any verdict.

## Limitations

- Chunk splitting on commas and "and"/"plus" is a heuristic for
  natural speech; item boundaries can be mis-split in either direction.
- Item matching uses a 0.5 token-overlap threshold plus containment -
  a policy choice, not a validated parameter.
- Detection is English-only.
- Items are noun phrases; quantities are carried as notes and are not
  separately verified ("two pizzas" vs "three pizzas" is not counted).

## Data handling

- Digit runs of 7 or more are masked in reports, keeping only the last
  two characters. This is not anonymization: names, emails, and other
  private text may remain. Keep real transcripts private.
- All bundled fixtures use reserved fictional numbers only (NANP
  555-01XX range, e.g. +14155550149 / display 415-555-0149); no real
  subscriber numbers appear anywhere in this skill.
- Fixture dialogues are neutral hospitality scenarios; they contain no
  sensitive personal content.
