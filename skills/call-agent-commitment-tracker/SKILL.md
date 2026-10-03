---
name: call-agent-commitment-tracker
description: Offline heuristic CALL-E phone call transcript skill that extracts and classifies agent Commissive Speech Acts — promises, follow-up pledges, and delegation statements — into WITH_DEADLINE, WITHOUT_DEADLINE, and CONDITIONAL buckets, then emits a verification follow-up call goal. It is not proof a commitment was broken, a legal analysis, or authorization to act automatically.
license: MIT
---

# call-agent-commitment-tracker

> **An agent that says "I'll send that right away" and doesn't — is worse
> than one that said nothing.**

When an automated agent makes a call, it often commits to future actions:
sending a confirmation email, having a specialist call back, filing a
referral. Those commitments are audible, remembered by the person, and
completely untracked unless this skill reads the transcript.

This is the post-call layer: it reads the finished `get_call_run` transcript,
extracts every agent commitment, classifies it by urgency, and hands you a
ready-to-use follow-up call goal to verify fulfillment.

## When To Use

- after any CALL-E call where the agent may have made forward-looking promises
- as part of a quality-assurance pipeline to prevent "ghost commitments"
- before a follow-up call to understand what the previous call committed to
- in collection, healthcare, or support workflows where broken commitments
  carry legal or reputational risk

## When Not To Use

- to audit the *callee's* promises (this skill only tracks agent turns)
- during a call; strictly post-call analysis plus pre-call goal crafting
- as a definitive legal record; it is heuristic and advisory only
- to replace CRM or ticketing systems for obligation tracking

## Workflow

### Audit a finished call

```bash
python3 scripts/commitment_tracker.py analyze \
  --transcript path/to/call-result.json
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat fixture shape used by sibling skills. Emits a commitment card:

- `commitments[]`: each detected commitment with `turn_index`, `classification`,
  and `evidence` (PII-masked, capped at 200 chars)
- `commitment_count`: counts by `WITH_DEADLINE`, `WITHOUT_DEADLINE`, `CONDITIONAL`
- `verdict`: `COMMITMENTS_FOUND` / `NONE_FOUND`, plus `unclear` paths
  (empty transcript, no agent turns)
- `recommended_action`: `schedule_followup_call` with guidance, or
  `no_followup_required`
- `disclaimer`: heuristic advisory disclaimer on every card

#### Commitment classifications

| Class | Description | Examples |
|---|---|---|
| `WITH_DEADLINE` | Commitment with explicit time window | "within 30 min", "by end of day", "ASAP", "right away" |
| `WITHOUT_DEADLINE` | Open-ended pledge | "I will follow up", "we will send" |
| `CONDITIONAL` | Pledge contingent on callee action | "I will if you confirm", "once you approve" |

#### Callee turns are always excluded

The skill only scans AGENT turns (speakers not in `callee / customer / patient /
caller / recipient / user`). A callee saying "I will think about it" is never
recorded as an organization commitment.

### Craft the follow-up call goal

```bash
python3 scripts/commitment_tracker.py craft --scenario commitment-followup
```

Emits the `plan_call` inputs JSON whose `goal` instructs the next call to:
verify whether the promised action was carried out, acknowledge any gap without
blame, and escalate to a human colleague if needed — without making new
commitments itself.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Searle, J.R. — *Speech Acts: An Essay in the Philosophy of Language* (Cambridge Univ. Press, 1969) | Taxonomy origin of Commissive acts — utterances that commit the speaker to a future action; the theoretical basis for the classification in this skill |
| Austin, J.L. — *How to Do Things with Words* (2nd ed., Oxford Univ. Press, 1975) | Foundational theory of performative utterances; commissives are one of five illocutionary act classes |
| Burdisso et al. — *Dialog2Flow: Pre-training Soft-Contrastive Action-Driven Sentence Embeddings for Automatic Dialog Flow Extraction* (EMNLP 2024, arXiv:2410.18481) | Methodology for mapping utterances by communicative function; commitment extraction is a direct application of the commissive-action region |
| Choubey et al. — *Turning Conversations into Workflows: A Framework to Extract and Evaluate Dialog Workflows for Service AI Agents* (Salesforce AI Research, ACL 2025, arXiv:2502.17321) | Empirical validation of extracting procedural commitments from customer-agent transcripts; confirms the practical grounding of this skill |
| SemEval-2025 Task 6 — *PromiseEval: Multinational, Multilingual, Multi-Industry Promise Verification* (ACL Anthology 2025, aclanthology.org/2025.semeval-1.321) | The most recent benchmark for promise detection and verification; provides taxonomy and evaluation methodology directly applicable to this skill |

This skill implements a lexical/regex heuristic that operationalizes the
commissive-speech-act class. It does not use model internals and labels every
output `analysis_mode: "heuristic"`.

## Differences from sibling skills

- `call-cross-call-consistency-checker` compares *stated facts* across two
  calls for contradictions; this skill tracks *future-action pledges* within
  one call.
- `call-review` audits general call quality and compliance; this skill
  specializes exclusively in forward-looking agent commitments.
- `call-agent-certainty-calibrator` grades how confidently the agent stated
  facts; this skill grades whether the agent made promises it should follow up on.
