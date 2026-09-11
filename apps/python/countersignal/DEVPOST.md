# CounterSignal — CALL-E Devpost submission packet

This file is the final copy source for the CALL-E Devpost entry. It is intentionally honest about what is deterministic, what has been live-tested, and what is still pending.

## Title

CounterSignal

## One-line summary

CounterSignal turns CALL-E customer interviews into falsifiable experiments: freeze the hypothesis and questions first, preserve contradictions, and refuse to count ungrounded or non-answer outcomes as evidence.

## Problem

Customer discovery is supposed to reduce uncertainty, but its incentives often run in the opposite direction. Founders remember supportive anecdotes, change wording between interviews, pitch when a respondent pushes back, silently exclude voicemail/refusal, and reinterpret ambiguous answers after seeing them. A generic voice agent can scale that bias rather than remove it.

CounterSignal treats those behaviors as data-integrity failures. The real-world phone task is narrow: run one consented, bounded customer-discovery interview under a frozen protocol, then decide whether the accumulated evidence should make the operator more or less confident in the hypothesis.

This failure mode is grounded outside this project. The US National Cancer Institute's SPRINT program describes customer discovery as turning potential ventures into business-model hypotheses, interviewing stakeholders to validate **or disprove** them, and making substantive changes when assumptions fail. Interview-method research has also shown that leading question wording can influence responses and undermine trustworthiness; a 2022 experimental analysis of 2,084 simulated interviews found that interviewers' preliminary assumptions predicted conclusions, confidence, use of non-recommended question types, and correctness.

References: [NCI SPRINT customer discovery](https://pmc.ncbi.nlm.nih.gov/articles/PMC7184906/), [leading-question influence](https://doi.org/10.1177/00218863211037446), and [confirmation bias in simulated interviews](https://doi.org/10.1111/lcrp.12213). These sources establish the problem class; they do **not** prove CounterSignal improves research quality. That remains an empirical product question.

## Solution

Before the first interview, CounterSignal freezes the target segment, problem, hypothesis, ordered question set, and decision thresholds into a deterministic protocol hash. CALL-E then acts only as the interview instrument. It discloses that it is an AI research assistant, asks the fixed questions in order, may use one neutral clarification for ambiguity, and is forbidden from selling, negotiating, offering a discount, scheduling a purchase, or introducing a new substantive question.

A completed phone call is not automatically evidence. CounterSignal requires a complete structured result, terminal success, sufficient confidence, exact call/experiment/protocol/recipient binding, and a key quote grounded in recipient-side transcript text. Refusal, voicemail, unreachable, low-confidence, malformed, unbound, and ungrounded outcomes stay outside the answered denominator.

The experiment decision is deterministic. Disconfirming evidence is first-class and takes priority once the frozen weakening threshold is reached. Provisional support is allowed only under the pre-registered rule and with zero disconfirming interviews. The output is an operational experiment decision, not a population estimate and not a product-market-fit claim.

## Why this matters

The value is not “AI can make calls.” The value is preventing an operator from rationalizing bad evidence while still delegating the repetitive mechanics of interviewing and summarization. CounterSignal can save human interview time, but the more important product property is epistemic integrity: a scaled research workflow that is allowed to tell the founder to stop.

The first dogfood experiment studies permit-status ambiguity among small and midsize US commercial contractors. Its protocol was frozen before any CALL-E interview: minimum 8 valid answered interviews, provisional support at 5 supporting with zero contradictions, and hypothesis weakening at 3 grounded contradictions. Permission to participate is obtained before any AI phone interview; a public business number alone is not treated as permission.

## What is technically non-trivial

- Published CALL-E Python SDK is imported and called on the real execution path.
- Protocol identity changes when the hypothesis, segment, questions, or rule changes.
- Exact CALL-E result schema prevents silent field drift.
- Success evidence binds to the accepted CALL-E call ID, experiment ID, protocol hash, and exact reviewed recipient.
- The key evidence quote must exist in recipient-side transcript text.
- Voicemail/refusal/unreachable outcomes cannot inflate the answered denominator.
- The exact call intent is durably reserved in SQLite before dispatch.
- If network ambiguity occurs after a call may have been accepted, the ledger becomes `outcome_unknown` and automated redial is blocked.
- Production origin is pinned; live execution additionally requires an exact allowlist match, explicit reviewed-recipient confirmation, live-call enable flag, and CALL-E API key.
- Default tests and the judge console require no credentials, network, or real call.

## Distinction from existing CALL-E projects

CounterSignal is not lead qualification and it is not merely a standardized telephone survey. A lead workflow asks whether a person should advance toward a commercial next step. A survey runner standardizes data collection. CounterSignal asks whether accumulated phone evidence should cause the operator to lose confidence in a pre-registered business hypothesis. That changes the script, evidence model, denominator, state machine, and final decision authority.

A current search of the official contribution repository found no directly overlapping customer-discovery/falsification project. Novelty is not claimed from absence alone; the substantive distinction is the falsification state machine and contradiction-preserving evidence contract.

## Product experience

The browser judge console is a deterministic no-call surface. It uses the **actual pre-registered SmallBet 8/5/3 rule**, exposes the frozen hypothesis, evidence ledger, answered denominator, supporting/disconfirming counts, and decision state, and displays the exact protocol hash.

The strongest demo sequence starts at `hypothesis_supported_under_rule` with 8 answered interviews (5 supporting, 3 neutral), adds voicemail to prove the answered denominator remains 8, then adds three grounded contradictions. The first contradiction removes provisional support; at the third the exact frozen rule returns `hypothesis_weakened` while all five supporting interviews remain visible.

## Testing instructions

1. Clone the contribution branch and enter `apps/python/countersignal`.
2. Use Python 3.11+.
3. Run `python -m pytest -q`; tests require no credentials or network.
4. Run `python countersignal.py --experiment example-experiment.json --recipient example-recipient.json`; preview is the default and creates no call.
5. Inspect the masked recipient, exact CALL-E task, result schema, protocol hash, and idempotency key.
6. Open `judge-console.html` locally. It is explicitly labeled deterministic reviewer mode and contains no network fetch.
7. Inspect `smallbet-experiment.json` and `DOGFOOD.md` for the frozen real-world validation rule and permission-first sampling protocol.
8. For live execution, use only an explicitly permitted reviewed recipient and follow the independent gates documented in README. Do not use a random public number for testing.

## Demo video outline — target 2:25

**0:00–0:18 — Problem.** Show the frozen hypothesis. Explain that customer discovery can become confirmation theater when questions drift and contradictions disappear.

**0:18–0:42 — Freeze the experiment.** Show `smallbet-experiment.json`, the five fixed questions, 8/5/3 decision rule, and protocol hash. State that changing a question creates a new experiment identity.

**0:42–1:02 — CALL-E boundary.** Show preview and exact task. Explain disclosure, no-pitch rule, exact recipient allowlist, and CALL-E SDK runtime use.

**1:02–1:32 — Honest evidence.** Start from the console's 8 answered / 5 support / 0 contradiction state. Add voicemail and demonstrate that answered denominator does not increase. Point to call/protocol/recipient/transcript grounding.

**1:32–2:02 — Contradiction wins.** Add three grounded contradictions and show the decision become `hypothesis_weakened`. Emphasize that CounterSignal does not relabel those respondents as objections and does not delete the five supporting interviews.

**2:02–2:18 — Consequential-call reliability.** Show SQLite reservation and `outcome_unknown` no-redial behavior.

**2:18–2:25 — Real-world boundary.** Show DOGFOOD.md and state that permission rate, nonresponse, contradictions, decision sequence, and measured operator time will be reported without inventing PMF or ROI.

## Screenshot shot list

1. Hero: “Try to kill the hypothesis” with `smallbet-permit-ops-v1`, protocol hash and 8/5/3 rule visible.
2. Evidence ledger with one voicemail visibly excluded from answered denominator.
3. Decision state immediately before and after the third contradiction threshold.
4. Preview showing masked recipient, protocol hash, and CALL-E result schema.
5. Test/CI proof showing repository validation success.
6. Optional live proof: redacted CALL-E call ID/result from an explicitly consented interview, only if obtained.

## Official CALL-E form fields

- **Submitter Type:** Individual
- **Country of residence/incorporation:** TODO — user must supply the truthful country value used for eligibility.
- **Organization name:** leave blank unless applicable.
- **App status:** Newly created
- **If pre-existing, explain updates:** Not applicable — CounterSignal was newly created during the submission period.
- **Testing instructions for application:** use the Testing instructions section above.
- **Functional demo URL:** optional; TODO if a hosted judge console is published.
- **Project submission pull request URL:** TODO — required upstream PR into `CALLE-AI/awesome-phone-call-agents`; staging PR is https://github.com/yangyangnovelist-hub/awesome-phone-call-agents/pull/4 and is not a substitute for the required upstream PR.
- **Email associated with CALL-E account:** TODO — confirm the actual CALL-E account email; do not infer it from Devpost email.
- **Primary use case:** Other
- **One-sentence real-world task:** Runs consented customer-discovery phone interviews under a frozen protocol and turns transcript-grounded supporting and contradictory evidence into an auditable experiment decision.
- **Eligible Age / Country eligibility / Conflict of interest:** user must affirm truthfully on Devpost.

## Current evidence status

- Repository-level `Validate` workflow: passed on the latest 8/5/3-aligned staging head before this evidence-only documentation update.
- Staging PR: open, draft, mergeable.
- Real-world candidate pool: 16 reviewed commercial-construction candidates prepared privately.
- Permission outreach: 3 unique candidates contacted; due to an execution-layer duplicate-send error, 7 total messages were sent across those 3 candidates. All three are frozen from further proactive outreach. This operational mistake must not be hidden in the final evidence packet if permission-funnel statistics are discussed.
- Affirmative opt-ins: 0 as of the latest read-only check.
- CALL-E dogfood interviews: 0 as of the latest read-only check.
- Extra CALL-E credits: no approval evidence observed yet.

## Final readiness gates

Before final Devpost submission: obtain the required upstream PR URL; confirm truthful country and CALL-E account email; record/upload the <3 minute public video; publish privacy-minimized live evidence only if an explicitly consented interview exists; otherwise keep deterministic evidence clearly labeled and do not manufacture a live claim.