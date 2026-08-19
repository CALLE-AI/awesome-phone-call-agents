# CounterSignal

**Falsifiable customer discovery over real phone calls.** CounterSignal uses CALL-E as a bounded interview instrument, then applies a pre-registered decision rule that preserves evidence against the founder's own hypothesis.

CounterSignal is deliberately not a lead-qualification or booking workflow. It does not close, persuade, negotiate, offer discounts, or convert a call into a sales action. The unit of work is an experiment: freeze a hypothesis and question protocol, call one reviewed recipient, preserve what was actually said, and decide whether the accumulated evidence says to continue, weaken the hypothesis, or — under an explicit rule — provisionally support it.

## Why this exists

Customer discovery has an asymmetric failure mode: supportive anecdotes are memorable while contradictions get explained away. A founder can change the wording between interviews, pitch during the call, silently exclude refusals, or reinterpret an ambiguous answer after seeing it. CounterSignal treats those as data-integrity problems rather than prompt-writing problems.

The app therefore makes five things load-bearing:

1. **Pre-registration.** The hypothesis, segment, fixed questions, and decision thresholds are hashed before the first call.
2. **No protocol drift.** The CALL-E task contains the exact frozen questions and permits only one neutral clarification per answer.
3. **Negative evidence is first-class.** A grounded contradiction can weaken the hypothesis; it is never rewritten as a lead objection.
4. **Honest denominators.** Refusal, voicemail, unreachable, and invalid results do not become answered interviews.
5. **Evidence binding.** A result is useful only when it belongs to the exact experiment, protocol, CALL-E call, and recipient, and its key quote is grounded in recipient-side transcript text.

## Distinction from existing CALL-E examples

The repository already contains sales follow-up/booking and a standardized survey runner. CounterSignal has a different objective and decision boundary:

- a **lead workflow** asks whether a person should advance toward a commercial next step;
- a **survey runner** standardizes collection of respondent answers;
- **CounterSignal** asks whether accumulated phone evidence should cause the operator to lose confidence in a pre-registered business hypothesis.

That distinction changes the call script, state model, evidence policy, denominator, and final output. CounterSignal never returns `qualified`, never books a meeting, and never treats willingness to talk again as proof of demand.

## Core flow

```text
pre-registered hypothesis + fixed questions + decision rule
                         |
                         v
               deterministic protocol hash
                         |
                         v
reviewed recipient -> no-call preview -> explicit live gates -> CALL-E
                                                      |
                                                      v
                                             structured result
                                                      |
                                                      v
                                      call/experiment/recipient binding
                                                      |
                                                      v
                                         transcript quote grounding
                                                      |
                       +------------------------------+------------------+
                       |                              |                  |
                       v                              v                  v
                 supporting                    disconfirming        neutral
                       \______________________________|__________________/
                                                      |
                                                      v
                                      frozen experiment decision rule
                                                      |
                    +----------------+----------------+----------------+
                    |                |                                 |
                    v                v                                 v
              collect_more   hypothesis_weakened       supported_under_rule / inconclusive
```

The decision is an **operational experiment rule**, not a population-level statistical estimate and not a claim of product-market fit.

## Run the credential-free path

Requires Python 3.11+.

```bash
cd apps/python/countersignal
python -m pytest -q
python countersignal.py \
  --experiment example-experiment.json \
  --recipient example-recipient.json
```

Preview is the default. It masks the phone number, emits the exact CALL-E task, result schema, protocol hash, and idempotency key, and places no call.

## Real-call boundary

A live call requires all of the following independently:

```bash
export CALLE_API_KEY="<your key>"
export CALLE_LIVE_CALLS_ENABLED="true"

python countersignal.py \
  --experiment experiment.json \
  --recipient recipient.json \
  --execute \
  --confirm-one-reviewed-recipient \
  --allow +14155550123
```

The `--allow` value must exactly match the selected recipient. The production base URL is pinned to the official CALL-E HTTPS origin; plain HTTP is accepted only for an explicit loopback test server. The CALL-E SDK is imported only after the live gates pass.

A production deployment should additionally persist the authorized call intent before crossing the network boundary and reconcile an ambiguous submission outcome instead of redialing. This repository's production-workflow guide is the reference for that next hardening layer. CounterSignal's current contribution focuses on the experiment protocol and evidence/decision integrity that are unique to this use case.

## Experiment contract

`example-experiment.json` contains the complete frozen protocol. The important fields are:

- `experiment_id`: stable experiment identity;
- `segment`: the population being explored;
- `problem`: the bounded workflow/problem under investigation;
- `hypothesis`: what the operator currently believes;
- `questions`: 3–8 fixed substantive questions;
- `decision_rule.min_answered`: minimum valid answered interviews before a terminal experiment decision;
- `decision_rule.supporting_needed`: supporting interviews required for provisional support;
- `decision_rule.disconfirming_needed_to_weaken`: disconfirming interviews required to weaken the hypothesis.

The protocol hash changes if the hypothesis, segment, questions, or rule changes. A changed protocol is a new experiment version, not a silent continuation.

## Result contract

CALL-E is asked for these exact fields:

- `continued_after_ai_disclosure`
- `disposition`
- `problem_occurred`
- `current_workaround`
- `would_take_followup`
- `contradicts_hypothesis`
- `key_quote`
- `notes`

`key_quote` is intentionally required. A well-formed model conclusion without recipient-side evidence is routed to `invalid` rather than counted toward the experiment.

## Decision semantics

CounterSignal classifies an answered and bound result as:

- **disconfirming** when the recipient directly contradicts the hypothesis or reports that the problem does not occur;
- **supporting** only when the problem occurs and the recipient has a current workaround;
- **neutral** when the answer is valid but does not satisfy either rule;
- **nonresponse** for refusal, voicemail, unreachable, or other non-answered outcomes;
- **invalid** for incomplete, low-confidence, unbound, or ungrounded results.

Disconfirming evidence takes priority once the minimum answered sample is reached. Provisional support requires the configured support count **and zero disconfirming interviews** under the current rule.

## Safety and integrity boundaries

- AI use is disclosed before substantive questions.
- Refusal ends the interview.
- No selling, bargaining, payment request, discount, purchase commitment, or scheduling authority.
- The hidden hypothesis is not read to the recipient, reducing demand-characteristic pressure.
- The model cannot add substantive questions mid-call.
- No answer is treated as demand merely because CALL-E completed successfully.
- No market-size, ROI, conversion-rate, or product-market-fit claim is inferred from a small exploratory sample.
- Every real recipient must be reviewed and explicitly allowlisted by the operator.

Legal/compliance obligations for outbound research calls vary by jurisdiction and deployment context. The operator owns recipient sourcing, lawful basis/consent where applicable, calling windows, suppression lists, and retention policy; CounterSignal does not infer those from a phone number.

## Tests

The initial deterministic suite covers:

- protocol-hash stability and drift detection;
- no-call preview and masking;
- exact result-schema contract;
- CALL-E metadata/call/recipient binding;
- transcript grounding of the evidence quote;
- refusal/voicemail denominator integrity;
- disconfirming-evidence priority;
- frozen support-rule behavior and claim boundary;
- invalid experiment rejection; and
- idempotency separation by protocol and recipient.

All tests run without credentials, network access, or a real phone call.

## What judges can verify quickly

1. Run `pytest -q`.
2. Run the preview command and inspect the frozen task and masked recipient.
3. Change one question and observe the protocol hash/idempotency identity change.
4. Read the decision tests showing that voicemail does not inflate the denominator and one grounded contradiction cannot be silently converted into support.
5. Inspect `execute()` to verify that the published CALL-E Python SDK is the live transport boundary.

## Next validation

The award version will dogfood CounterSignal on a bounded SmallBet customer-discovery experiment and report only directly measured quantities: reviewed recipients, completed interviews, nonresponse rate, operator minutes displaced, contradictory evidence captured, and whether additional calls changed the pre-registered experiment decision. The evaluation will preserve negative outcomes rather than selecting only successful conversations.
