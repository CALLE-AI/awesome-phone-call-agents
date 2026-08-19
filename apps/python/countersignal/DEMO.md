# CounterSignal judge demo — target 2:30

The demo should prove the product boundary, not narrate the README. Everything below can be shown with the deterministic judge console and no credentials. A real-call clip can replace the marked section later without changing the story.

## 0:00–0:18 — The problem

**Screen:** CounterSignal judge console, frozen hypothesis visible.

**Narration:**

> Customer discovery is supposed to reduce uncertainty, but it is easy to turn five conversations into confirmation theater. Questions drift, founders pitch, and contradictory answers disappear into notes. CounterSignal makes the phone interview a falsifiable experiment instead.

## 0:18–0:42 — Freeze what would change your mind

**Screen:** Highlight hypothesis, fixed questions, protocol hash, and the `5 / 3 / 2` reviewer rule.

**Narration:**

> Before any call, I freeze the segment, hypothesis, exact questions, and decision rule. That generates a protocol hash. Changing a question changes the experiment identity, so I cannot quietly rewrite the study after hearing the answers.

**Proof to show:** briefly change one question in the JSON or point to the test that asserts the hash changes.

## 0:42–1:02 — CALL-E is the interview instrument, not the decision maker

**Screen:** no-call preview / exact task contract.

**Narration:**

> The default is a no-call preview. A live run requires a reviewed recipient, an exact allowlist match, a live-call flag, and the CALL-E key. CALL-E discloses that it is an AI research assistant, asks the frozen questions, may use only a neutral clarification, and is explicitly forbidden from selling, negotiating, offering discounts, or adding a substantive question.

**Later live-proof replacement:** show one consented CALL-E interview creation/result ID here if an authorized dogfood call is available.

## 1:02–1:38 — The result must carry evidence

**Screen:** evidence ledger; add supporting and voicemail entries.

**Narration:**

> A completed call is not automatically evidence. CounterSignal binds the result to the exact experiment, protocol hash, call ID, and recipient, and requires the key quote to exist in recipient-side transcript text. Refusal, voicemail, unreachable, low-confidence, unbound, and ungrounded outcomes never become positive evidence and never inflate the answered denominator.

**Action:** press `+ Voicemail`; point out that the answered denominator does not increase.

## 1:38–2:02 — Make contradiction load-bearing

**Screen:** add enough answered evidence to cross five, including two contradictions, until the decision becomes `hypothesis_weakened`.

**Narration:**

> This is the part a lead funnel normally cannot do. Once the frozen weakening threshold is reached, contradictions win. CounterSignal returns `hypothesis_weakened`; it does not relabel those respondents as objections to overcome. Provisional support is allowed only under the pre-registered rule and with zero disconfirming interviews.

## 2:02–2:20 — Engineering boundary

**Screen:** source/test summary or terminal with tests.

**Narration:**

> The live path uses the published CALL-E Python SDK. The deterministic suite pins protocol drift, exact result shape, transcript grounding, denominator integrity, and idempotency identity. Repository validation runs without credentials or a real phone call.

**If durable reservation is on the upstream branch by recording time:** add: “The call intent is durably reserved before dispatch, and an ambiguous provider outcome blocks blind redial.”

## 2:20–2:30 — Real-world evidence

**Screen:** `smallbet-experiment.json` / aggregate evidence packet when available.

**Narration:**

> The real dogfood run is pre-registered before the first interview. I report answered and nonresponse counts, contradictions, decision sequence, and measured operator minutes — not invented product-market fit or ROI.

## Recording rules

- Keep the final public video under 3:00; target 2:20–2:35.
- Do not show real phone numbers, CALL-E keys, full transcripts, or recipient identities.
- Label deterministic/simulated evidence on screen; never present it as a live call.
- If a live clip is available, show the provider call ID and redacted structured result, but keep the claim boundary unchanged.
- End on the decision change, not on a code editor.
