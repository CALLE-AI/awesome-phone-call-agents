# Safety: call-guess-forcing-auditor

**This skill audits transcripts after the call has ended. It is not an
interrogation detector, it is not proof of deception, and it is not
evidence about the callee's actual memory state. No verdict authorizes
any action against an agent, a business, or a person.**

## Boundaries

- The skill grades a pressure SEQUENCE in text (uncertainty, then
  pressing, then a hedged yield, then firm consolidation). It does not
  detect interrogation in any legal sense and must never be described as
  doing so.
- A hedged guess restated as firm shows a recording-integrity risk, not
  a lie by either party. The callee may remember the value perfectly;
  the agent may have had no intent to pressure.
- The Shift event (value changed after negative feedback) is advisory
  only and never gates a verdict; real interrogative suggestibility is
  an individual difference this lexicon cannot measure.
- All outputs are advisory for human reviewers; no automated action,
  retraining decision, or deployment decision is authorized by any
  verdict.

## Limitations

- Detection is heuristic and English-only; paraphrases outside the
  listed patterns are missed, and common words in the hedge list
  ("about", "around") can fire on non-hedge usage.
- The i+1..i+2 bind window is a policy choice; sequences outside it are
  invisible.
- Transcript-only: no prosody, no stress cues, no pause timing. Nothing
  in the output claims anything about how the callee felt or what they
  actually know.

## Data handling

- The skill never places calls and makes no network requests.
- Digit runs of 7 or more are masked in reports (including quoted
  sentences and call_id), keeping only the last two digits. This is not
  anonymization: names, emails, and other private text may remain. Keep
  real transcripts private.
- Bundled fixtures are fictional, neutral in tone, and use only reserved
  test numbers from the +1-555-01XX range.
