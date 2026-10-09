---
name: call-semantic-barge-in-analyzer
description: Post-call cooperation skill. Classifies callee turns in a CALL-E transcript as backchannels ("mm-hmm", "right, okay"), frustration barge-ins ("wait", "hold on", "slow down"), or substantive answers - disambiguating answers from backchannels via the preceding agent question - and computes pacing metrics including backchannel density and whether the agent shortened its turns after the first interruption. Returns a cooperation profile (ENGAGED_COOPERATIVE / NEUTRAL / FRUSTRATED_INTERRUPTING / DISENGAGED) with a pacing recommendation and a ready-to-use pacing goal for the next plan_call. Heuristic mode only, runs offline. Grounded in full-duplex turn-taking research (Moshi arXiv 2410.00037, DuplexGen arXiv 2607.26178), adapted to post-call transcripts.
license: MIT
---

# call-semantic-barge-in-analyzer

> **Was the person on the other end with you, against you, or barely there?**

`call-review` audits call compliance, including ignored stop requests.
This skill answers a different question: how cooperative was the callee,
and how should the NEXT call be paced? A callee who answers "Mm-hmm."
while you explain is with you; a callee who says "Wait, slow down." three
times is telling you your pacing failed - and the fix is a shorter-turn
script, not more repetition.

## When To Use

- after any CALL-E call where the agent delivered multi-part information,
  to check whether the callee could keep up
- to decide whether the next call should use a pacing goal (short turns,
  explicit confirmation points)
- to generate that pacing goal for `plan_call` directly

## When Not To Use

- to audit compliance or ignored stop requests; use `call-review`
- to detect fraud; use `call-fraud-shield`
- during a call; CALL-E exposes transcripts, not live audio, so
  interruptions are read post-hoc from turn text, not from overlapping
  speech timing
- as a judgment about the person; profiles are pacing advice only and the
  card says so

## Workflow

### Analyze a finished call

```bash
python3 scripts/barge_in_analyzer.py analyze --transcript path/to/call-result.json
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat shape used by sibling skill fixtures. Emits a card:

- `cooperation_profile`: ENGAGED_COOPERATIVE / NEUTRAL /
  FRUSTRATED_INTERRUPTING / DISENGAGED
- `metrics`: callee turn counts by class, backchannel density, average
  agent turn length, and whether the agent shortened its turns after the
  first barge-in (adaptation)
- `evidence`: turn index, masked span, classification for every backchannel
  and barge-in
- `pacing_assessment: "unclear"` with a reason when the callee never spoke
- `pacing_recommendation`: `shorten_turns` (with the pacing goal text),
  `maintain_pacing`, or `pause_and_confirm`

Classification rules: a turn is a backchannel when it is at most 4 words of
listening vocabulary after an agent STATEMENT; the same words answering a
trailing agent QUESTION count as substantive answers. Bare "look" is
deliberately not a barge-in marker (too many benign uses: "I will look
into that").

### Craft the pacing goal

```bash
python3 scripts/barge_in_analyzer.py craft --scenario pacing-followup --language en
```

Emits the plan_call inputs JSON whose `goal` is the same template the card
recommends on `shorten_turns`, so analysis and next call stay consistent.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Moshi: a speech-text foundation model for real-time dialogue (Kyutai, 2024, arXiv 2410.00037) | Full-duplex turn-taking with backchannels; this skill is the post-call, transcript-only approximation |
| DuplexGen: Adaptive Synthesis of Human-AI Turn-Taking Dialogues (2026, arXiv 2607.26178) | Turn-taking dialogue synthesis; motivates the backchannel-vs-barge-in distinction |

Both papers model real-time full-duplex behavior; CALL-E exposes
transcripts without timing, so this skill deliberately implements the
text-side approximation and labels every output `analysis_mode: "heuristic"`.

## Differences from sibling skills

- `call-review` flags ignored stop requests (a compliance failure by the
  agent); this skill profiles callee cooperation and tunes pacing for the
  next call.
- `call-verbal-irony-detector` reads what the callee meant versus what they
  said; this skill reads how they participated.
