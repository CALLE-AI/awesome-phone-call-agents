# Outbound Call Skill Creator Interaction Logic Plan

**Branch:** `feat/outbound-call-skill-creator-interaction-logic`

**Goal:** Simplify the user-facing interaction flow for `outbound-call-skill-creator` so users can move from a business request to a usable generated outbound-call skill without needing to understand internal binding, onboarding, provider, or execution-mode terminology upfront.

**Design direction:** Keep the creator as a generator for focused outbound phone-call business skills. The creator should not process campaign data or place calls itself. It should capture the workflow contract, create the generated business skill, validate it, and clearly explain how the generated skill will be used later.

---

## Current User Journey

The current flow has two distinct layers that should stay separate in the user experience.

### 1. Creator Skill Usage

The user asks whether the creator can build an outbound-call workflow, or directly asks for a workflow such as:

```text
Create a skill that follows up with authorized Google Form leads by phone.
```

The agent detects `outbound-call-skill-creator` and starts a creation conversation. The creator then collects or derives:

- business skill name
- output scope and generated skill directory
- source family, such as Google Forms, TikTok Ads, local CSV, or custom source
- binding level
- source access and representative sample
- field mapping for phone number, recipient label, dedupe key, date filter, outreach basis, and goal inputs
- outbound call goal contract
- provider route readiness for the CALL-E MCP provider route
- execution mode
- verified durable result-output behavior
- validation result and reload or discovery note

The result of this layer is a generated business skill directory, not a completed call campaign.

### 2. Generated Business Skill Usage

After creation, a future user invokes the generated business skill with a concrete runtime request, such as:

```text
Process all June 20 submissions for form <form-id>.
```

The generated skill should:

- verify the concrete runtime request is specific enough
- read source records
- normalize candidates
- validate phone numbers, outreach basis, dedupe, writeback, and provider readiness
- show a dry-run preview when approval is required
- process the approved candidate list serially
- finalize provider results
- write results back or produce a session table
- return one final batch summary

This runtime layer should be presented as the future behavior of the generated skill, not as work performed by the creator during skill creation.

## Current Interaction Issues

The current creator flow is correct but too implementation-shaped for a normal user:

- It exposes internal choices such as binding level, execution mode, provider onboarding, runtime gate, and writeback binding before the user has seen a simple recommended path.
- It can make the user feel they are filling out a technical form instead of describing a business workflow.
- Creation-time and runtime responsibilities are easy to blur because both layers mention source access, validation, provider readiness, and writeback.
- Advanced modes compete with the default happy path even though most workflows should use `parameterized-bound` plus `dry-run-then-batch-approval`.
- The final result can read like a contract dump unless it clearly separates fixed creation-time values from runtime parameters and blockers.

## Test Feedback: Interaction Rules

The tested interaction should behave like a guided setup, not a form that asks for every contract field at once.

Hard rules:

- Ask for only the next missing piece of information needed to continue.
- Every user choice should include a recommended option and a short copyable example when practical.
- If the user already provided information earlier, do not ask for it again.
- If the user provides multiple answers at once, record all of them and advance to the next missing step.
- Only require extra user work when the user has a special preference or a manual step is unavoidable, such as OAuth completion, a source locator, or confirming a writeback target.
- Treat early result-output, writeback, direct-execution, or preview input as a preference until source sampling and provider evidence make the option verifiable.
- Confirm writeback targets only after source access and representative sampling identify supported paths.
- Finalize the selected execution mode only after source onboarding, verified durable result-output capability, and provider onboarding evidence are known.
- Do not expose internal concepts as the first decision surface. Use business-language labels first and keep terms such as binding level, execution mode, provider onboarding, runtime gate, and writeback binding as secondary technical detail.

### Information Reuse Rule

Maintain a running set of known values during creation:

- workflow
- source family
- source locator
- call goal
- binding level
- execution mode
- skill name
- result-output preference
- verified writeback or result-output target
- output target
- auth status

Before each prompt, ask only for the first missing value needed for the next step. Never ask the user to restate values already known unless there is a conflict, the value is invalid, or the user asks to change it.

### Copyable Prompt Examples

Use simple examples that users can copy or answer with a short phrase:

Workflow:

```text
Follow up with form submitters who requested a phone call.
```

Data source:

```text
google-form
tiktok-ads
local-csv
other
```

Goal:

```text
Call the respondent, confirm their request, ask one follow-up question, and summarize the outcome.
```

Binding and execution:

```text
Use the recommended reusable workflow with preview-before-calling.
```

Skill name:

```text
quote-request-callback
```

Writeback:

```text
Write results back to the linked response spreadsheet.
```

### Additional Simplification Ideas

- Use plain labels first and internal terms second, for example "Reusable workflow (`parameterized-bound`)".
- Show defaults as sentences, not configuration menus.
- Treat fallback or session-table output as a safety result, not a standard writeback option.
- Put manual actions in a distinct "Action needed" block with one exact command, URL, or input request.
- End every prompt with one obvious next action the user can copy or answer in a few words.

## Target Interaction Model

The creator should follow a guided, recommendation-first conversation.

### Default Path

Use this as the default unless the user explicitly asks for a different mode:

- Binding level: `parameterized-bound`
- Execution mode: `dry-run-then-batch-approval`
- Output target: user-level reusable skill, unless the user asks for repository-scoped output or the workflow depends on project-local files
- Source onboarding: agent attempts safe route discovery and read-only sample fetch before asking for manual field mapping
- Provider onboarding: agent verifies or requests setup for the CALL-E MCP route without creating provider plans or placing calls
- Real calls: never happen during creation; they can happen only when the generated skill later receives a concrete runtime request and the runtime gate passes

### Progressive Disclosure

The agent should start from the user's business goal, then disclose technical choices only when they affect a decision.

Preferred prompt order:

1. Ask for either the business workflow or the data source.
2. If only the workflow is provided, ask for the data source with examples such as `google-form`, `tiktok-ads`, `local-csv`, or `other`.
3. If only the data source is provided, recommend a likely business workflow and ask the user to confirm or adjust it.
4. Confirm a provisional outbound call goal with a recommended goal draft based on the workflow and source.
5. Recommend binding level and call-preview preference together, defaulting to "Reusable workflow (`parameterized-bound`)" plus "Preview before calling (`dry-run-then-batch-approval`)", while showing other options briefly.
6. Confirm the skill name with one recommended lowercase hyphenated slug.
7. Continue with source onboarding and representative sample fetch.
8. Confirm inferred field mapping and the final goal contract from the sampled fields.
9. Confirm the verified writeback or durable result-output target by listing only source-specific options proven by source access, representative sample, linked metadata, or exposed source tools.
10. Continue with provider check.
11. Finalize the selected execution mode from the earlier preference and verified onboarding evidence.
12. Continue with output target confirmation when needed, generation, validation, and creation summary.

If the user supplies several of these values in one message, skip the matching prompts and continue from the first missing item.

### User-Facing Language

Prefer business-language labels in prompts and summaries:

- "Reusable workflow" instead of leading with `parameterized-bound`
- "Fixed now" and "provided at run time" instead of "binding level"
- "Preview before calling" instead of leading with `dry-run-then-batch-approval`
- "Call provider connection" instead of leading with "provider onboarding"
- "Checks before real calls" instead of leading with "runtime gate"

Internal terms can still appear in generated skill contracts and validation details, but the conversation should not require the user to understand them before making progress.

## Target Happy Path

1. User describes the workflow.
2. Agent identifies the source family and confirms a provisional call goal.
3. Agent recommends a reusable workflow with preview before calling as the default preference.
4. Agent proposes a skill name.
5. Agent checks source access or asks for the minimum missing locator.
6. Agent fetches a small read-only sample.
7. Agent proposes field mapping with redacted sample evidence.
8. User confirms or corrects the mapping and final goal contract.
9. Agent confirms the source-specific durable result-output target, or records session-table output only as a fallback when durable output is unavailable or intentionally not configured.
10. Agent verifies the CALL-E MCP provider route.
11. Agent finalizes the selected execution mode.
12. Agent chooses the output target and explains discoverability.
13. Agent writes the generated skill folder.
14. Agent runs the generated-skill checker.
15. Agent reports the creation summary and future usage example.

## Final Creation Summary Shape

The final summary should be short and reviewable:

```text
Skill: <business-skill-name>
Directory: <generated-skill-directory>
Discovery: <reload-needed | known-active-root | add-location-needed>
Workflow: <plain-language source and call purpose>
Fixed now: <source family, schema, outreach basis, dedupe, goal, writeback policy>
Provided at run time: <form ID, CSV path, campaign ID, date window, output path, or none>
Source check: <passed | blocked | dry-run-only blocker>
Provider check: <passed | blocked | dry-run-only blocker>
Execution: preview candidates first, then process approved list serially
Writeback: <source writeback | local CSV | none configured>
Fallback: <session table if writeback is unavailable, blocked, or intentionally omitted>
Before real calls: <checks that must pass>
Validation: <command and result>
```

The summary must not expose credentials, tokens, callback URLs, confirmation tokens, cookies, or full phone numbers.

## Implementation Plan

### Task 1: Document The Two-Layer Mental Model

Update creator-facing docs and skill instructions to clearly distinguish:

- creator skill creation flow
- generated business skill runtime flow

The creator should always make clear that its output is a generated skill, while real outbound calls happen later through that generated skill.

### Task 2: Make The Default Path Recommendation-First

Update `SKILL.md` and relevant references so the creator recommends:

- `parameterized-bound` by default
- `dry-run-then-batch-approval` by default
- user-level reusable skill output by default when the creator is installed in a user skills root

Advanced alternatives should be shown only when the user asks for a fixed source, direct execution, scheduled usage, exploratory dry-runs, or another explicit need.

### Task 3: Reduce Early Manual Mapping Prompts

Keep the existing source-onboarding rule, but make the interaction expectation sharper:

- attempt route discovery before asking for route choice
- run safe auth-readiness checks when available
- fetch a representative sample before asking for full mapping
- propose inferred fields before asking the user to fill gaps

This should make source onboarding feel like assisted setup instead of a blank questionnaire.

### Task 4: Rewrite Execution Mode Presentation

Make "preview before calling" the user-facing default preference. Keep internal execution mode names in contracts, but do not make the user choose from all modes unless they request a non-default approval model. Finalize the selected execution mode only after source onboarding, verified durable result-output capability, and provider onboarding evidence are known.

If advanced modes remain supported, document them as opt-in:

- fixed production workflow
- direct execution after concrete request
- special high-control pilot

### Task 5: Improve Creation Summary Language

Update creation summary guidance so it separates:

- fixed creation-time values
- runtime parameters
- passed checks
- blockers
- dry-run-only limitations
- future usage example

The summary should be concise enough for the user to review before reloading or using the generated skill.

### Task 6: Align Examples And Validation

Update examples after the interaction wording changes. If the generated skill contract changes, update the checker and repository validation fixtures so generated skills still include required safety, runtime gate, source onboarding, provider onboarding, and writeback behavior.

### Task 7: Validate Repository

Run:

```bash
python3 scripts/validate_repository.py
```

Fix any validation failures before the branch is considered ready.

## Non-Goals

- Do not turn the creator into a runtime campaign processor.
- Do not place real calls during skill creation.
- Do not require provider-side recurrence.
- Do not build a generic telephony vendor directory.
- Do not remove safety gates to make the flow shorter.
- Do not hide blockers that affect whether real calls can run.

## Resolved Decision

The creator should not expose a generic unbound binding level or a per-candidate approval execution mode. The user-facing and generated-skill model should stay centered on `fully-bound` or `parameterized-bound` workflows, with `dry-run-then-batch-approval` as the default execution preference and `approved-direct-execution` reserved for stable workflows whose creation-time evidence and concrete runtime requests pass the mandatory gates.
