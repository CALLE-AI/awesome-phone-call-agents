# Interaction Flow

Use this reference before asking the user creation questions. The creator should feel like a guided setup for a business workflow, not a technical intake form.

## Hard Rules

- Ask for only the next missing piece of information needed to continue.
- Every user choice should include a recommended option and a short copyable example when practical.
- If the user already provided a value, do not ask for it again.
- If the user provides several values at once, record all of them and continue from the first missing value.
- Only require extra user work when the user has a special preference or a manual step is unavoidable, such as OAuth completion, a source locator, or writeback target confirmation.
- Do not ask for skill name, output target, binding level, execution mode, full field mapping, or writeback behavior before workflow, source family, and call goal are established, unless the user already supplied those later values.
- Do not confirm writeback targets before source access and representative sampling have identified supported writeback paths.
- Record early writeback or result-output input as a preference only.
- Confirm the verified writeback or durable result-output target only after the source access check and representative sample identify supported paths.
- Record early direct-execution or preview input as a preference only. Finalize the selected execution mode only after source onboarding, verified durable result-output capability, and provider onboarding evidence are known.
- Do not make the user choose by internal terms such as binding level, execution mode, provider onboarding, runtime gate, or writeback binding. Use plain user-facing labels first and keep internal terms as optional parenthetical detail for contracts, summaries, and advanced users.

## Known Values

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

Before each prompt, inspect this set and ask only for the first missing value needed for the next step. If a known value conflicts with a later user message, ask one short conflict-resolution question and recommend the safer interpretation.

## User-Facing Language Boundary

The user-facing conversation must not read like a configuration menu. Start with the business goal, recommend the default path, and reveal internal terms only after the plain-language choice is clear.

Use these labels in prompts:

| User-facing label | Internal contract term |
| --- | --- |
| Reusable workflow | `parameterized-bound` |
| Fixed source workflow | `fully-bound` |
| Preview before calling | `dry-run-then-batch-approval` |
| Direct execution after checks | `approved-direct-execution` |
| Call provider connection | provider onboarding |
| Checks before real calls | runtime gate |
| Write results back | writeback policy or writeback target |

Do not ask users to choose by internal terms unless they explicitly ask for technical details. It is acceptable to include the internal term in parentheses after the plain label when confirming the final contract or when the user is choosing an advanced option.

When a setup step requires manual user action, describe the visible action instead of the internal phase. For example, say "Action needed: connect the call provider" instead of asking the user to perform "provider onboarding."

## Prompt Order

1. Ask for either the business workflow or the data source.
2. If only the workflow is provided, ask for the data source with examples.
3. If only the data source is provided, recommend a likely business workflow and ask the user to confirm or adjust it.
4. Confirm the provisional outbound call goal with a recommended goal draft.
5. Recommend workflow reuse and preview preference together, using plain labels first.
6. Confirm the skill name with one recommended lowercase hyphenated slug.
7. Continue with source access check and representative sample fetch.
8. Confirm the discovered field mapping and final goal contract derived from sampled fields.
9. Confirm the writeback target only after the source access check and representative sample identify supported writeback paths.
10. Continue with call provider connection.
11. Finalize the selected execution mode only after source onboarding, verified durable result-output capability, and provider onboarding evidence are known.
12. Continue with output target confirmation when needed, generation, validation, and creation summary.

## Copyable Examples

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

## Source-Only Recommendations

When the user provides only a source family, recommend a likely workflow before asking for more details:

- `google-form`: follow up with form submitters who requested or authorized a phone call.
- `tiktok-ads`: call leads who submitted product interest through TikTok Ads and authorized phone follow-up.
- `local-csv`: call approved rows from a CSV for confirmations, reminders, callbacks, or follow-up tasks.
- `other`: ask how records are accessed, then ask one missing contract question at a time.

Example:

```text
You selected `google-form`. I recommend creating a workflow that follows up with form submitters who requested a phone call.

You can reply with:
Use that workflow.
```

## Workflow Reuse And Preview Prompt

Recommend workflow reuse and call-preview preference together after workflow, source family, and provisional goal are known:

```text
Recommended: Reusable workflow (`parameterized-bound`) with preview before calling (`dry-run-then-batch-approval`).

Why: the skill can be reused for matching forms, CSV files, campaigns, or source instances, while every real run still shows the candidate list before calls.

Other option: Fixed source workflow (`fully-bound`) when one source and writeback target should be fixed at creation time.
Advanced option: Direct execution after checks (`approved-direct-execution`) only for stable workflows whose checks before real calls can pass for each concrete request.

You can reply with:
Use the recommended reusable workflow with preview-before-calling.
```

Do not present unsupported binding levels or per-candidate approval modes. Treat this as a preference prompt, not final execution-mode selection; final selection happens only after source onboarding, verified durable result-output capability, and provider onboarding evidence are known.

## Writeback Prompt

Use this prompt only after source access and representative sampling have identified the supported writeback paths. If the user mentioned writeback or output earlier, treat that as a preference until this step. List only options proven by the source access check, representative sample, linked metadata, or exposed source tools, and recommend the safest one:

- Google Form: linked response spreadsheet writeback only when the linked spreadsheet or approved writeback route is discovered.
- TikTok Ads: approved MCP writeback tool or approved connector action only when the source route exposes it.
- Local CSV: separate result CSV by default; source CSV update only when explicitly requested.
- Custom source: source writeback only when an exact approved writeback action and field mapping are known.

Do not list session-table output as a normal writeback option. Treat it as a last-resort attended fallback when durable writeback or durable result output is unavailable, blocked, or intentionally omitted.

Example:

```text
Recommended: Write results back to the linked response spreadsheet.

Other option: Write a separate result CSV if source writeback is unavailable or not requested.

You can reply with:
Write results back to the linked response spreadsheet.
```

## Manual Actions

When user action is unavoidable, isolate it in an `Action needed` block with one exact command, URL, or input request. Continue automatically after the action is completed and verified.

Example:

```text
Action needed: complete the Google OAuth browser flow.

After you finish, reply:
Done
```

## Prompt Shape

Each prompt should contain:

- one short statement of what is already known
- one recommended next choice
- one copyable answer or action
- no unrelated questions

Avoid broad prompts such as "please provide all details" and internal menus such as "choose a binding level." They slow the setup down and cause repeated questions when the user already supplied part of the contract.
