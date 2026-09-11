# CounterSignal real-world validation: SmallBet permit-ops experiment

This is the pre-registration for the first real CounterSignal dogfood run. It exists so the result cannot be rewritten after hearing the calls.

## Study question

Do small and midsize US commercial contractors experience enough permit-status ambiguity to already spend recurring operator time on a manual workaround?

The purpose is **problem discovery**, not selling a permit service. The phone task must not quote a price, pitch automation, book a sales meeting, or convert a respondent into a lead score.

## Frozen protocol

Use [`smallbet-experiment.json`](smallbet-experiment.json) unchanged for the run. Its SHA-derived `protocol_hash` is the experiment version. If wording or thresholds change, create a new experiment ID rather than continuing the old denominator.

Target segment:

- US commercial/general contractors or permit-heavy specialty contractors;
- small or midsize operating teams rather than national enterprise headquarters;
- business appears to manage permit-dependent work directly; and
- a public business contact channel is available for an operator-reviewed participation invitation.

Do not infer that a generic construction company belongs in the segment merely because it exists. The operator must review the company context first.

## Decision rule

- Minimum answered interviews: **8**.
- Provisional support threshold: **5 supporting** and **0 disconfirming**.
- Weaken threshold: **3 disconfirming** once the minimum answered denominator is reached.
- Refusal, voicemail, unreachable, low-confidence, ungrounded, or schema-invalid outcomes never enter the answered denominator.

A supporting interview means the respondent reports that the problem occurs and that an existing workaround/process is used. A disconfirming interview means the respondent directly says the problem does not occur, is immaterial, or the assumed workflow is wrong. Everything else is neutral.

This is an operational decision rule for one discovery experiment. It is not a prevalence estimate, confidence interval, total-addressable-market estimate, or product-market-fit claim.

## Recipient and consent rules

For this US dogfood run, a public business phone number is **not** treated as permission for an AI-voice call. Candidate businesses are contacted first through a non-phone participation invitation such as a published business email or contact channel. CALL-E is used only after the intended participant affirmatively agrees to the AI phone research interview and confirms the business number/time window to use.

This deliberately conservative study rule exists because AI-generated speech is treated as an artificial voice under the US TCPA framework, consent requirements can depend on the type of destination number and calling context, and state law may be more restrictive. CounterSignal does not attempt to infer legal permission from the fact that a number is publicly listed.

For every CALL-E dogfood interview:

- retain a private operator-side reference to the affirmative participation response before execution;
- review the exact recipient, number, time window, segment fit, and suppression status;
- identify the caller as an AI research assistant at the start of the call;
- ask whether the participant is still willing to continue before substantive questions;
- end immediately on refusal or uncertainty; and
- do not reuse the permission for a sales call or a separate PermitDiff municipal call.

Maintain an operator-side suppression list for any business that asks not to be contacted again. A refusal is a completed compliance outcome, not a failed conversion.

## Permission funnel metrics

The permission stage is part of the evidence packet rather than hidden operational overhead. Record:

- reviewed candidate businesses;
- participation invitations sent;
- affirmative opt-ins;
- explicit declines;
- nonresponses;
- opt-in-to-valid-interview conversion; and
- elapsed/operator time required to obtain permission.

A low permission rate is real evidence about deployability and must not be excluded from the product story.

## What to measure during CALL-E interviews

Record these directly rather than estimating them after the fact:

- authorized attempted calls;
- answered calls;
- interviews that continue after AI disclosure;
- refusals / voicemail / unreachable;
- supporting / disconfirming / neutral / invalid outcomes;
- number of transcript-grounded contradictions preserved;
- operator minutes spent preparing/reviewing each delegated call;
- for a small manual baseline, operator minutes required to conduct and summarize the same interview without delegation; and
- whether the frozen experiment decision changes after each valid answered interview.

The primary product KPI is **operator minutes displaced per valid answered discovery interview**, reported together with the permission funnel and outcome-integrity metrics. Do not turn a short call into a dollar ROI claim without observed labor-cost inputs.

## Stop conditions

Stop the experiment instead of spending the remaining call budget when any of the following occurs:

- an implementation or evidence-binding defect makes results unreliable;
- recipient sourcing is no longer clearly within the intended segment;
- a compliance/consent issue is discovered;
- the frozen rule reaches `hypothesis_weakened` and further calls would only be used to rescue the idea; or
- enough evidence has been collected to move to a separately defined pilot-recruitment experiment.

Reaching `hypothesis_supported_under_rule` does not authorize a sales blast. It authorizes the next explicit experiment: ask a small number of qualified operators whether they will separately opt in to providing an authorized real permit case for a PermitDiff pilot.

A CounterSignal research opt-in is not permission to call a municipality about that respondent's permit. PermitDiff requires its own applicant-side authorization and case-specific validation.

## Judge evidence packet

After the run, publish a privacy-minimized aggregate containing the frozen experiment JSON/hash, permission-funnel counts, counts by interview outcome bucket, decision sequence by interview number, measured operator-time methodology, failures/nonresponses, and a few redacted evidence excerpts where publication is permitted. Do not publish phone numbers, identities, email thread IDs, full transcripts, or private recordings.
