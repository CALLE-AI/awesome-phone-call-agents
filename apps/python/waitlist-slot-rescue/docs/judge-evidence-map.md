# Judge evidence map

This page separates demonstrated behavior from modeled impact and remaining
submission work. It is designed to make every competition claim traceable.

| Criterion | Claim | Reproducible evidence | Known limitation | Final-video proof |
| --- | --- | --- | --- | --- |
| Real World Impact | A last-minute cancellation can be offered fairly without manual dialing or a queue race. | `evaluation_results.json` models 10,000 queues with a fixed seed and explicit assumptions. `judge_proof.py` reproduces the result. | The model is fictional and is not customer or production data. | Show the 81% operator-time reduction and EUR 3.10 labor-only break-even at EUR 35/hour with the model disclaimer visible. |
| Quality of Idea | The app turns an expiring slot into a sequential, consent-first decision workflow rather than a broadcast campaign. | `rescue.py` preserves queue order, stops on the first verified yes or any ambiguity, and never books. | No claim is made that this is the only or globally optimal waitlist policy. | Contrast the ordered cascade with unsafe parallel fan-out in one sentence. |
| Technical Implementation | CALL-E is invoked at runtime behind explicit consent, evidence, expiry, idempotency, and privacy gates. | `CalleTransport`, the result schema, `judge_bundle.json`, tests, and `docs/live-verification.md`. | The recorded live boundary ended before a successful acceptance; it proves connectivity and fail-closed behavior, not the golden outcome. | Show one authorized call and then the redacted normalized result. Never expose credentials, a number, or raw transcript. |
| Product Experience & Demo | A judge can understand and replay the golden, adversarial, and live-boundary paths without credentials or side effects. | Hosted console, self-contained fallback, downloadable audit JSON, and `python judge_proof.py`. | The final human-narrated competition video is still required. | Use actual console interaction, a readable phone scene, English narration/subtitles, and a final evidence screen. |

## One-command verification

From this directory:

```bash
python judge_proof.py
```

The command creates no phone calls. It regenerates the committed judge bundle
through `rescue.run_rescue`, checks exact artifact equality, verifies the golden
and safe-halt stopping rules, and reproduces the modeled impact and labor-only
break-even sensitivity.

## Claims that must not appear in the submission

- “81% measured customer improvement” — it is a modeled result.
- “The live call proved acceptance” — it ended with an unknown outcome.
- “The app books the slot” — a human performs the commitment.
- “The hosted demo places calls” — it is a no-call judge console.
- “Winning is guaranteed” — judging and competitor quality are outside the
  entrant's control.
