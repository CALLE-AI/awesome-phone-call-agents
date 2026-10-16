# Safety: call-crisis-response-auditor

**This skill is NOT an emergency system. It audits transcripts after the
call has ended. It cannot help anyone during a live crisis. If you or
someone you know is in crisis: in the US call or text 988 (Suicide &
Crisis Lifeline) or call 911; elsewhere use your local emergency
number.**

## Content and data handling

- All bundled fixtures are clinical and neutral in tone; they contain no
  graphic content.
- Hotline numbers that appear in outputs (911, 988) are US defaults; the
  goal templates explicitly instruct a local-emergency-number fallback
  for non-US regions.
- The skill never places calls and makes no network requests.
- Digit runs of 7 or more are masked in reports, keeping only the last
  two characters. This is not anonymization: names, emails, and other
  private text may remain. Keep real transcripts private.

## Honest capability statement

- No diagnosis, no risk scoring, no profiling of persons: the report
  grades agent conduct against listed patterns, nothing else.
- Detection is heuristic and English-only; missed cues are possible for
  unlisted phrasings.
- Weak signals and `care_acknowledged` are advisory and never gate a
  verdict.
- All outputs are advisory for human reviewers; no automated action,
  triage, or deployment decision is authorized by any verdict.
