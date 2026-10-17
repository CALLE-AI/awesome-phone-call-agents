# PR description: contact-preference-guard

## Summary

This contribution adds a post-call Skill that turns spoken contact preferences into structured proposals with duration, scope, transcript evidence, and a recommended action. It includes a small mock CRM preview, explicit operator approval before mock write-back, and synthetic behavioral tests. It does not place calls or connect to a real CRM.

## CALL-E and community boundary

CALL-E Core and the provider execute the phone call and return the transcript. This community Skill interprets the business meaning of contact preferences after the call. A host or CRM adapter owns downstream state changes and any approval policy. That division keeps workflow-specific preference semantics out of the call execution layer.

## Problem and opportunity

Existing community artifacts handle pieces of contact preference behavior in specific workflows: [CallGuardian for Google Sheets](https://github.com/CALLE-AI/awesome-phone-call-agents/blob/main/plugins/google-sheets-callguardian/README.md) gates consent, call windows, DNC, attempt caps, and live opt-out; [Google Form Callback](https://github.com/CALLE-AI/awesome-phone-call-agents/blob/main/skills/google-form-callback/SKILL.md) supports reviewed one-off callbacks with dry-run, scheduling, and Sheets writeback; and [Human Context Handoff](https://github.com/CALLE-AI/awesome-phone-call-agents/blob/main/skills/human-context-handoff/SKILL.md) asks one bounded human preference or workflow question and returns a durable structured result. `contact-preference-guard` does not replace them. It extracts the reusable post-call interpretation problem: turning free-form recipient language into a proposal with explicit preference type, duration, scope, transcript evidence, and downstream action.

Developers and product teams building CALL-E workflows are the direct users. The person receiving the call benefits when their preference is neither ignored nor expanded beyond what they said.

Four failures make the boundary concrete:

| Recipient says | Wrong downstream interpretation |
| --- | --- |
| “Don't call me today” | Permanent DNC |
| “Don't call me again about this order” | Organization-wide DNC |
| “Text me instead” | Marketing SMS consent |
| “I'm not interested” | Contact suppression |

## Why a Skill

CALL-E Core owns call execution, not business-specific contact rules. A single CRM can store preferences but should not define the meaning of every transcript. A large App would add a user interface and integration surface that the first contribution does not need. A Skill packages the interpretation rules and output contract in a small artifact that different hosts can review and reuse.

## Solution

```text
completed transcript + call context
  -> detect supported contact preferences
  -> choose duration and the narrowest supported scope
  -> quote recipient evidence
  -> return a recommended action
  -> preview any downstream change in the host/adapter
```

The product decision is to separate **meaning** from **execution**. If the recipient's meaning is unclear, the Skill returns `request_confirmation` and a clarification. If the recipient clearly says, “You should never call me again from your company,” the Skill returns an ongoing organization-wide DNC proposal without asking them again. Changing `global_do_not_call: false -> true` is then a separate execution decision: the mock adapter displays the change and requires operator approval before writing it.

## Product decisions and trade-offs

V1 runs after a completed call. It supports exactly five types: `call_window`, `channel`, `language`, `do_not_call`, and `voicemail`. The minimum-scope rule prevents task or temporary language from becoming a broader durable rule. Ambiguous meaning fails closed. A channel preference is not consent; business rejection is not DNC. Later explicit corrections override earlier wording.

The Skill only returns proposals. Its mock CRM exists to show the likely downstream impact and approval step; it is not an integration or an enforcement system. There is no real-time clarification flow in this MVP. That leaves some cases for a human to resolve rather than guessing a policy from a transcript.

## Validation

- **35/35 core behavioral cases passed**.
- **12/12 supplemental synthetic evaluation cases passed**.
- **19/19 safety tests passed**.
- Recorded *encoded* Over-broad Update Rate: **0/35 core cases, 0/12 supplemental cases**. The metric tests specified widening of scope/duration/action and consent fields. It does not catch every wider free-text value or semantic mistake.

The scorer checks preference type, duration, scope, recommended action, review requirement, and proposal count. It compares `value` where an expected value is specified, checks that evidence quotes a recipient turn, and enforces structural safety rules. Separate tests exercise forbidden consent fields, temporary and task-scoped DNC mapping, semantic-review blocking, operator approval, rejection, and no-write defaults. The recorded model outputs are distinct from the static demo fixtures.

These are synthetic behavioral evaluations, not production accuracy on real phone calls. The [README](README.md) has runnable commands; the [targeted change report](SEMANTIC_APPROVAL_REVIEW.md) and [saved outputs](evaluation/semantic-approval-fix/actual-results.json) support review.

An attempted real CALL-E E2E check with the author's own +86 number stopped at planning: CALL-E returned `ready_to_run: false` because China-region availability could not be verified for the account. No call was placed, so real CALL-E E2E validation remains incomplete.

## What changed during testing

The first core evaluation passed **31/35** cases. Four Chinese-language outputs used `zh` where the expected contract required `zh-CN`. The language normalization contract was clarified, and a fresh evaluation passed 35/35. The expected golden answers were not changed. Later, the product requirement separated semantic clarification from operator approval. Explicit organization-wide DNC became a definite proposal; the old safety test that required semantic review failed as expected and was explicitly replaced with tests for a definite proposal and approval-gated mock write-back. Unchanged supplemental expectations and historical results remain available in the evaluation records.

## Risks and safety

A rule wider than the recipient's words can suppress legitimate contact. Under-interpreting an explicit opt-out can cause unwanted contact. Channel preference must not be treated as marketing consent. Transcript quality, ASR errors, later corrections, and missing context can affect interpretation. A real CRM write would have material side effects, so the Skill never performs one and the mock adapter previews its change before approval.

The 35 core cases and 12 supplemental cases are synthetic, were developed during this work, and do not establish performance on real calls. The structural validator cannot prove that a quoted excerpt supports the proposed meaning. Approval in the CLI is an explicit token, not an authenticated identity check.

## Safety checklist

| Safety concern | Current handling |
| --- | --- |
| User intent | Explicit future preferences produce proposals; ambiguous intent requires semantic review and `request_confirmation`. |
| Phone numbers | The Skill input does not require a raw phone number, and the mock CRM does not store one. |
| Credentials | The Skill and local dry-run require no CALL-E or CRM credentials. |
| Cancellation | Not applicable: the Skill does not place or schedule calls. |
| Dry-run | The mock CRM change is previewed before any local write. |
| Duplicate execution | The mock adapter skips identical scoped records, and repeating an identical applied proposal yields no change. It has no production idempotency or call-execution dedupe. |
| Result handling | Typed proposals include transcript evidence, confidence, and review state; the validator checks structure, not semantic correctness. |
| Real-world write | The demo writes only `demo/mock_crm.json`, after `--confirm` and interactive `approve`. No real CRM is connected. |

## Next steps

Potential follow-ups, outside this contribution: validate against authorized real CALL-E transcripts end to end; design a real CRM adapter with its own approval and conflict rules; add a real-time clarification path; and evaluate multilingual and noisy transcripts. None is implemented here.

## AI use and human judgment

AI assisted repository research, code reading, implementation, synthetic test generation, test execution support, and documentation. The human selected the opportunity and MVP scope and set the Minimum-Scope Rule, the preference-versus-consent boundary, the separation of semantic clarification from execution approval, and the safety/risk decisions. Human review of the final contribution remains necessary.
