# CounterSignal judge demo — target 2:25

The demo should prove the product boundary, not narrate the README. Everything below can be shown with the deterministic judge console and no credentials. A real-call clip can replace the marked section later without changing the story.

## 0:00–0:18 — The problem

**Screen:** CounterSignal judge console, frozen hypothesis visible.

**Narration:**

> Customer discovery is supposed to reduce uncertainty, but it is easy to turn conversations into confirmation theater. Questions drift, founders pitch, and contradictory answers disappear into notes. CounterSignal makes the phone interview a falsifiable experiment instead.

## 0:18–0:42 — Freeze what would change your mind

**Screen:** Highlight `smallbet-permit-ops-v1`, the five fixed questions, protocol hash, and the **8 / 5 / 3** decision rule.

**Narration:**

> Before any call, I freeze the segment, hypothesis, exact questions, and decision rule. This real dogfood protocol requires eight valid answered interviews, five supporting interviews for provisional support, and three grounded contradictions to weaken the hypothesis. That generates a protocol hash. Changing a question creates a new experiment identity, so I cannot quietly rewrite the study after hearing the answers.

**Proof to show:** point to `smallbet-experiment.json` and the full protocol hash `a7229d00…b47a56` displayed in the console.

## 0:42–1:02 — CALL-E is the interview instrument, not the decision maker

**Screen:** no-call preview / exact task contract.

**Narration:**

> The default is a no-call preview. A live run requires affirmative participation permission, a reviewed recipient, an exact allowlist match, a live-call flag, and the CALL-E key. CALL-E discloses that it is an AI research assistant, asks the frozen questions, may use only a neutral clarification, and is explicitly forbidden from selling, negotiating, offering discounts, or adding a substantive question.

**Later live-proof replacement:** show one consented CALL-E interview creation/result ID here if an authorized dogfood call is available.

## 1:02–1:32 — Honest denominator and evidence binding

**Screen:** judge console starts at 8 answered: 5 supporting, 3 neutral, 0 contradictory. Current decision is `hypothesis_supported_under_rule`.

**Narration:**

> This reviewer preset begins exactly at provisional support under the frozen rule. But a completed call is not automatically evidence. CounterSignal binds the result to the exact experiment, protocol hash, accepted CALL-E call ID, and reviewed recipient, and requires the key quote to exist in recipient-side transcript text. Refusal, voicemail, unreachable, low-confidence, unbound, and ungrounded outcomes never become positive evidence.

**Action:** press `+ Voicemail` once. Point out that nonresponse increases but the answered denominator remains **8**.

## 1:32–2:00 — Make contradiction load-bearing

**Screen:** press `+ Contradiction` three times.

**Narration:**

> Now add evidence against the founder's own idea. The first contradiction removes provisional support; the experiment becomes inconclusive rather than pretending the negative answer does not exist. At the third grounded contradiction, the frozen weakening threshold is reached and CounterSignal returns `hypothesis_weakened`. Five supportive interviews are still in the ledger. CounterSignal simply refuses to let them erase the three contradictions.

**Judge point:** this is the behavior a lead funnel is structurally not designed to produce.

## 2:00–2:16 — Consequential-call reliability

**Screen:** source/test summary or reservation state diagram.

**Narration:**

> The live path uses the published CALL-E Python SDK. The exact intent is durably reserved in SQLite before dispatch. If the network outcome is ambiguous after CALL-E may already have accepted the call, the record becomes `outcome_unknown` and blind redial is blocked. Protocol drift, result shape, transcript grounding, denominator integrity, and duplicate-intent behavior are regression-tested.

## 2:16–2:25 — Real-world evidence boundary

**Screen:** `DOGFOOD.md` / `smallbet-experiment.json`.

**Narration:**

> The real dogfood run is pre-registered before the first interview. I report permission rate, answered and nonresponse counts, contradictions, decision sequence, and measured operator time — not invented product-market fit or ROI.

## Recording rules

- Keep the final public video under 3:00; target 2:20–2:30.
- Do not show real phone numbers, CALL-E keys, full transcripts, or recipient identities.
- The console uses deterministic simulated evidence and says so on screen; never present it as a live call.
- The displayed rule must remain the real SmallBet **8 / 5 / 3** rule. Do not revert to the earlier reviewer-only 5 / 3 / 2 toy threshold.
- If a live clip is available, show the provider call ID and redacted structured result, but keep the claim boundary unchanged.
- End on the decision changing to `hypothesis_weakened`, not on a code editor.