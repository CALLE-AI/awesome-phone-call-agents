# CounterSignal

**Falsifiable customer discovery over real phone calls.** CounterSignal uses CALL-E as a bounded interview instrument, then applies a pre-registered decision rule that preserves evidence against the founder's own hypothesis.

CounterSignal is deliberately not a lead-qualification or booking workflow. It does not close, persuade, negotiate, offer discounts, or convert a call into a sales action. The unit of work is an experiment: freeze a hypothesis and question protocol, call one reviewed recipient, preserve what was actually said, and decide whether the accumulated evidence says to continue, weaken the hypothesis, or — under an explicit rule — provisionally support it.

## Why this exists

Customer discovery has an asymmetric failure mode: supportive anecdotes are memorable while contradictions get explained away. A founder can change the wording between interviews, pitch during the call, silently exclude refusals, or reinterpret an ambiguous answer after seeing it. CounterSignal treats those as data-integrity problems rather than prompt-writing problems.

This is not a problem invented for the demo. The US National Cancer Institute's SPRINT program describes customer discovery as turning a potential venture into business-model hypotheses, interviewing stakeholders to validate **or disprove** them, and making substantive changes when assumptions fail in the real world. Independent interview-method research reports that leading question wording can influence responses and weaken the trustworthiness of findings. In a 2022 experimental analysis spanning 2,084 simulated interviews, interviewers' preliminary assumptions predicted their conclusions, confidence, use of non-recommended question types, and likelihood of reaching the correct conclusion.

Sources:

- [NCI SPRINT: customer discovery as hypothesis testing](https://pmc.ncbi.nlm.nih.gov/articles/PMC7184906/)
- [Cairns-Lee, Lawley & Tosey: influence of leading questions in interviews](https://doi.org/10.1177/00218863211037446)
- [Zhang: confirmation bias in simulated interviews](https://doi.org/10.1111/lcrp.12213)

Those studies do not prove that CounterSignal itself improves research quality. They establish the failure mode that its protocol is designed to constrain; the app's own effect must be measured separately.

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
              collect_more   hypothesis_weakened   hypothesis_supported_under_rule / inconclusive
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

The `--allow` value must exactly match the selected recipient. The production base URL is pinned to the official CALL-E HTTPS origin; plain HTTP is accepted only for an explicit loopback test server. The CALL-E SDK is imported only after the live gates pass. A loopback test server receives only a fixed non-secret test key; `CALLE_API_KEY` is required and used only for the production origin.

Before crossing the real-call boundary, CounterSignal reserves the exact stable intent in SQLite. Once CALL-E returns a call ID, that ID is bound to the reservation. If a timeout or exception leaves the outcome ambiguous, the ledger moves to `outcome_unknown` and the same intent cannot automatically redial. This follows the repository's production-workflow rule that an unknown submission outcome is a state to reconcile, not permission to create another call.

## Experiment contract

`example-experiment.json` contains a complete frozen example protocol. The important fields are:

- `experiment_id`: stable experiment identity;
- `segment`: the population being explored;
- `problem`: the bounded workflow/problem under investigation;
- `hypothesis`: what the operator currently believes;
- `questions`: 3–8 fixed substantive questions;
- `decision_rule.min_answered`: minimum valid answered interviews before a terminal experiment decision;
- `decision_rule.support_if_at_least`: supporting interviews required for provisional support;
- `decision_rule.weaken_if_at_least`: disconfirming interviews required to weaken the hypothesis.

The protocol hash changes if the hypothesis, segment, questions, or rule changes. A changed protocol is a new experiment version, not a silent continuation.

The real SmallBet dogfood protocol is separate from the compact example and is frozen in `smallbet-experiment.json`: 8 minimum answered interviews, 5 supporting for provisional support with zero contradictions, and 3 grounded contradictions to weaken the hypothesis.

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

Legal/compliance obligations for outbound research calls vary by jurisdiction and deployment context. The operator owns recipient sourcing, lawful basis/consent where applicable, calling windows, suppression lists, and retention policy; CounterSignal does not infer those from a phone number. The current US dogfood protocol is stricter: a public business number alone is not treated as AI-call permission; the respondent must affirmatively opt in before CALL-E is used.

## Tests

The deterministic suite covers:

- protocol-hash stability and drift detection;
- no-call preview and masking;
- exact result-schema contract;
- CALL-E metadata/call/recipient binding;
- transcript grounding of the evidence quote;
- refusal/voicemail denominator integrity;
- disconfirming-evidence priority;
- frozen support-rule behavior and claim boundary;
- invalid experiment rejection;
- idempotency separation by protocol and recipient;
- durable duplicate-intent prevention;
- ambiguous provider outcome -> `outcome_unknown` with no blind redial; and
- judge-console alignment with the real pre-registered SmallBet protocol.

All tests run without credentials, network access, or a real phone call.

## What judges can verify quickly

1. Run `pytest -q`.
2. Run the preview command and inspect the frozen task and masked recipient.
3. Change one question and observe the protocol hash/idempotency identity change.
4. Open `judge-console.html`, add voicemail and observe that the answered denominator stays fixed, then add three contradictions and observe `hypothesis_weakened` under the frozen 8/5/3 rule.
5. Inspect `execute()` to verify that the published CALL-E Python SDK is the live transport boundary and that a durable reservation precedes dispatch.

## Real-world validation

`DOGFOOD.md` pre-registers the first SmallBet study before any CALL-E interview. The private first-wave pool contains 16 manually reviewed commercial-construction candidates. Participation is requested through a non-phone channel first; only an affirmative opt-in may become a CALL-E interview recipient. Permission-channel outcomes are reported separately from the answered interview denominator.

The evaluation reports only directly measured quantities: reviewed candidates, permissions, completed interviews, nonresponse, operator minutes displaced, contradictory evidence captured, and whether additional valid answers changed the pre-registered experiment decision. It preserves negative outcomes rather than selecting only successful conversations. Current live-evidence status is kept in `DEVPOST.md`; deterministic reviewer evidence is never relabeled as a live call.
