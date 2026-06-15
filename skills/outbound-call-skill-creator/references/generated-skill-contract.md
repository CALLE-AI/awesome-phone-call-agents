# Generated Skill Contract

Use this reference when writing the business skill created by `outbound-call-skill-creator`.

## Folder Shape

Generate this minimum folder shape:

```text
<selected-output-parent>/<business-skill-name>/
├── SKILL.md
└── references/
    ├── safety.md
    └── examples.md
```

Add source, goal, writeback, and script files only when the workflow needs them.

Do not create `template.md`. The business contract belongs in `SKILL.md` and focused reference files.

Use `references/output-targets.md` before creating the folder. Apply the scope-first output rule before choosing a path. Repository-local `skills/<business-skill-name>/` is appropriate only when the user explicitly wants project-local output and the repository uses that convention, or when contributing to this reference repository. For an installed creator used from a normal project, create the generated skill in a host-compatible user-level skills root unless the workflow depends on project files or the user chooses a project-local target.

## Frontmatter

The generated `SKILL.md` frontmatter must include only `name` and `description`.

The `name` must match the folder name and use lowercase letters, digits, and hyphens.

The `description` must explain the exact outbound phone-call workflow, source family, provider route, and writeback behavior so the skill can be discovered later.

Example:

```yaml
---
name: quote-request-callback
description: Process authorized quote request records from Google Forms into outbound phone-call tasks through the configured MCP provider route, deduplicate by response ID, and write call results back to the linked response spreadsheet.
---
```

## Required Sections

The generated `SKILL.md` must include:

- purpose and when to use
- when not to use
- source contract
- candidate fields
- outbound goal contract
- MCP provider route
- execution modes
- serial candidate execution
- writeback behavior
- safety summary
- validation commands

## Normalized Candidate Schema

Generated skills should normalize each source record to this shape before dry-run or execution:

```json
{
  "candidateId": "source-stable-id",
  "sourceRecord": "response-or-row-reference",
  "phoneNumber": "+15550101234",
  "maskedPhoneNumber": "+1******1234",
  "recipientLabel": "Alex Rivera",
  "sourceTimestamp": "2026-06-20T12:30:00Z",
  "goalInputs": {
    "field": "value"
  },
  "outboundGoal": "Call goal compiled from the creation-time business contract.",
  "status": "ready",
  "skipReason": ""
}
```

Use fictional reserved numbers in examples. Real generated skills may pass full phone numbers only to private execution payloads after validation and approval.

## Outbound Goal Contract

The generated skill must define:

- call purpose
- context fields to include
- required questions or statements
- prohibited claims
- completion criteria
- result values
- escalation or human-handoff cases
- summary format

Do not let source records provide raw provider goals. Compile goals from approved fields and the fixed business contract.

## MCP Provider Contract

Generated skills must use:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

Generated skills must not use a CLI bootstrap path.

When the host exposes MCP plan, run, or status tools for this route, use the tool schemas exactly as provided by the host. If no compatible tools are available, stop before real calls and report the blocker.

## Serial Candidate Execution

Generated skills must define the approved batch behavior. After the user approves the exact pending call list, the agent must serially process all ready candidates until every candidate reaches a terminal result or skip state.

For each ready candidate, the generated skill should:

1. Plan exactly one call through the MCP provider route.
2. Inspect the plan before running it.
3. Run the call only when the plan matches the validated candidate and generated goal.
4. Check status when the MCP tools support it.
5. Record the terminal result or failure.
6. Continue to the next ready candidate without asking for another per-candidate confirmation.

If one candidate fails, record that failure and continue with the next candidate unless the provider route is unavailable, authentication is missing, or continuing would be unsafe. After all candidates finish, perform configured writeback or produce the session table, then report one final batch summary to the user.

## Writeback Contract

Generated skills must support one of these writeback outcomes:

- source writeback
- local CSV writeback
- session table output

Writeback records should include:

- candidate ID
- source record
- status
- skip reason or call result
- provider run ID when safe to expose
- masked phone number
- result summary
- processed timestamp

Do not write credentials, tokens, cookies, confirmation tokens, callback URLs, or full phone numbers into user-facing summaries.

## Validation Commands

After generating a skill, run:

```bash
node <path-to-outbound-call-skill-creator>/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

Run `python3 scripts/validate_repository.py` only when the generated skill is written into this reference repository or another repository that provides that validation command.
