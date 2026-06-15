# Outbound Skill Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an `outbound-skill-creator` Agent Skill that generates directly usable outbound phone-call workflow skills for Google Form, ttmcp, local CSV, and custom data sources.

**Architecture:** Add one procedural creator skill under `skills/outbound-skill-creator/`. Keep the main `SKILL.md` concise and route details into references for output target selection, binding contracts, execution modes, data sources, generated skill contracts, MCP provider usage, safety, creation summaries, and examples. Add a small Node.js checker script so generated skill folders can be validated before repository validation runs.

**Tech Stack:** Agent Skills markdown, repository Python validation, Node.js standard library helper scripts, MCP provider route `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`.

---

## File Structure

- Create `skills/outbound-skill-creator/SKILL.md`: primary skill instructions, trigger behavior, creator workflow, required generated-skill output.
- Create `skills/outbound-skill-creator/README.md`: user-facing overview, binding model, execution modes, example creation flow, and validation commands.
- Create `skills/outbound-skill-creator/references/binding-contract.md`: binding-level selection rules and generated skill requirements.
- Create `skills/outbound-skill-creator/references/creation-summary.md`: creation summary shape and safety rules.
- Create `skills/outbound-skill-creator/references/data-sources.md`: built-in `google-form`, `ttmcp`, `local-csv`, and custom source guidance.
- Create `skills/outbound-skill-creator/references/execution-modes.md`: approval modes, runtime request standard, and direct execution guardrails.
- Create `skills/outbound-skill-creator/references/generated-skill-contract.md`: exact generated skill folder contract, normalized candidate schema, goal contract, writeback contract, and session-table fallback.
- Create `skills/outbound-skill-creator/references/mcp-provider-route.md`: default MCP provider route, plan/run/status expectations, auth blockers, and no-CLI rule.
- Create `skills/outbound-skill-creator/references/output-targets.md`: scope-first, host-aware output target rules for user-level, project-local, explicit-path, and reference-repository generation.
- Create `skills/outbound-skill-creator/references/safety.md`: safety rules that the creator must apply and copy into generated business skills.
- Create `skills/outbound-skill-creator/references/examples.md`: concrete creation examples for Google Form, ttmcp, local CSV, and custom sources.
- Create `skills/outbound-skill-creator/scripts/check-generated-skill.mjs`: validate a generated skill directory for required files, frontmatter, MCP route use, no `template.md`, and English-only content.
- Modify `scripts/validate_repository.py`: require the new creator skill files in repository validation.

---

## Current Design Alignment

The implemented creator now uses a three-level binding model:

- `fully-bound`: concrete source and writeback target fixed at creation time
- `parameterized-bound`: default; schema, consent, dedupe, goal, and writeback policy fixed while approved runtime parameters provide source or target instances
- `unbound-generic`: dry-run-only by default until a complete runtime contract is supplied

Generated skills select one execution mode:

- `dry-run-then-batch-approval`
- `per-call-approval`
- `approved-direct-execution`

`approved-direct-execution` is valid only for `fully-bound` or runtime-verified `parameterized-bound` workflows. It is not valid for `unbound-generic`.

Creation-time preflight is best effort. Runtime gating is mandatory before real calls. The checker now requires generated skills to declare a selected binding level, selected execution mode, the default MCP provider route, runtime gate requirements, and the required safety sections.

---

### Task 1: Add Repository Expectations For The New Skill

**Files:**
- Modify: `scripts/validate_repository.py`

- [ ] **Step 1: Add the failing expected-file check**

In `validate_expected_files()`, add these entries after the existing `skills/call-reminder/...` expected files:

```python
        "skills/outbound-skill-creator/SKILL.md",
        "skills/outbound-skill-creator/README.md",
        "skills/outbound-skill-creator/references/binding-contract.md",
        "skills/outbound-skill-creator/references/creation-summary.md",
        "skills/outbound-skill-creator/references/data-sources.md",
        "skills/outbound-skill-creator/references/execution-modes.md",
        "skills/outbound-skill-creator/references/generated-skill-contract.md",
        "skills/outbound-skill-creator/references/mcp-provider-route.md",
        "skills/outbound-skill-creator/references/output-targets.md",
        "skills/outbound-skill-creator/references/safety.md",
        "skills/outbound-skill-creator/references/examples.md",
        "skills/outbound-skill-creator/scripts/check-generated-skill.mjs",
```

- [ ] **Step 2: Run validation to verify the new expectation fails**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected: `ERROR: Missing file: skills/outbound-skill-creator/SKILL.md`

- [ ] **Step 3: Do not commit yet**

Leave the validation change unstaged until the skill files exist and repository validation passes.

---

### Task 2: Create The Creator Skill Entry Point

**Files:**
- Create: `skills/outbound-skill-creator/SKILL.md`

- [ ] **Step 1: Create the skill directory**

Run:

```bash
mkdir -p skills/outbound-skill-creator/references skills/outbound-skill-creator/scripts
```

- [ ] **Step 2: Create `SKILL.md`**

Write `skills/outbound-skill-creator/SKILL.md` with this content:

```markdown
---
name: outbound-skill-creator
description: Create directly usable outbound phone-call Agent Skills that connect data sources such as Google Forms, ttmcp, local CSV, or custom systems to an MCP one-off call provider route, compile per-record call goals, enforce safety rules, and configure writeback or session-table output.
---

# Outbound Skill Creator

Use this skill when the user wants to create a new outbound phone-call workflow skill that can later process source records directly, compile one call goal per eligible record, run calls through the configured MCP provider route, and write results back or display a session table.

`outbound-skill-creator` creates focused business skills. It does not process campaign data itself, does not create a generic outbound runtime platform, and does not use a CLI bootstrap path.

## Core Rule

Generate a directly usable business skill using the scope-first output rule in `references/output-targets.md`. Do not assume the current project has a usable `skills/` directory.

When this creator is used from a normal project after being installed by a skill installer, default to a user-level reusable skill unless the workflow depends on project-local files or the user asks for repository-scoped output. If the installed `outbound-skill-creator` folder is inside a recognized user-level skills root, create the generated business skill as a sibling of this creator. Otherwise choose a host-compatible skills root from `references/output-targets.md`, or ask the user when discoverability is unclear.

Use a project-local skills directory only when the user explicitly wants the generated skill versioned with the current project, when the skill depends on project files, or when working inside this reference repository. Never write a generated business skill into the downloaded `outbound-skill-creator` skill folder itself.

The generated skill must let a future user make a concrete request such as "process all June 20 records" and have the skill handle source access, filtering, candidate validation, outbound goal compilation, approved MCP execution, dedupe, and writeback or session-table output.

Do not create `template.md`. The creator captures the source, goal, execution, and writeback contract during skill creation and writes that contract into the generated skill instructions and reference files.

## Required Creator Workflow

1. Confirm that the user wants to create a new outbound phone-call workflow skill.
2. Ask for or derive a lowercase hyphenated business skill name.
3. Read `references/output-targets.md`, choose the scope, and choose a host-compatible output parent.
4. Ask which source family to use: `google-form`, `ttmcp`, `local-csv`, or `other`.
5. Read `references/data-sources.md` for the selected source family.
6. Capture the source fields for phone number, recipient label, dedupe key, date filtering, and goal inputs.
7. Capture the outbound goal contract: call purpose, required context, allowed questions, completion criteria, result values, and escalation cases.
8. Read `references/mcp-provider-route.md` and use the default MCP provider route in the generated skill.
9. Capture execution policy: dry-run first or approved direct execution after a concrete processing request, including serial processing after approval.
10. Capture writeback policy: source writeback, local CSV writeback, or session table fallback.
11. Read `references/safety.md` and include the required safety boundaries in the generated skill.
12. Generate the business skill folder and files in the selected output parent using `references/generated-skill-contract.md`.
13. Run this skill's bundled checker script with `--skill-dir <generated-business-skill-dir>`.
14. Run repository validation only when the generated skill is being committed to a repository that provides a validation command.

## Built-In Choices

Present these source families by default:

- `google-form`: Google Forms responses with local OAuth or an explicitly configured Apps Script fallback.
- `ttmcp`: records obtained through known ttmcp MCP tools or resources.
- `local-csv`: records from a user-provided CSV file.
- `other`: a custom source that requires multi-turn clarification before generating the skill.

If the user selects `other`, do not guess API schemas, credentials, identifiers, date filters, writeback behavior, or MCP tool names. Ask for the missing contract details one at a time.

## Generated Skill Requirements

Every generated business skill must include:

- `SKILL.md`
- `references/safety.md`
- `references/examples.md`

Generate additional reference files when the workflow is too detailed for the main `SKILL.md`, such as:

- `references/source-contract.md`
- `references/goal-contract.md`
- `references/writeback-contract.md`

Generate scripts only when deterministic handling is valuable, such as CSV parsing, candidate validation, dedupe state checks, dry-run rendering, or writeback payload generation.

## Default Provider Route

Generated skills must use this MCP provider route by default:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

The generated skill must use the MCP tools exposed by the host for that route. It must not invent tool names or schemas. If the route is unavailable or authentication is missing, the generated skill must stop before real calls and report the blocker.

## Direct Execution Policy

A generated skill may support approved direct execution when the user gives a concrete processing request such as "process all June 20 records" and the creation-time contract explicitly allowed direct execution.

Even in direct execution mode, the generated skill must:

- validate E.164 phone numbers
- validate outreach basis or consent
- deduplicate by the configured key
- mask phone numbers in summaries
- skip unsafe or ambiguous records
- avoid hidden recurring schedules
- report writeback status or produce a session table

If direct execution was not configured, the generated skill must dry-run first and ask the user to approve the exact pending call list before real calls.

## Session Table Fallback

If writeback is not configured, generated skills must output a table with one row per task and these columns:

- candidate ID
- source record
- recipient label
- masked phone
- status
- skip reason or result
- processed timestamp

## Validation

After generating a business skill, run:

```bash
node <path-to-outbound-skill-creator>/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

When developing inside this reference repository, the checker path is `skills/outbound-skill-creator/scripts/check-generated-skill.mjs`; after editing this repository, also run `python3 scripts/validate_repository.py`.
```

- [ ] **Step 3: Run repository validation**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected: validation still fails, now at the next missing outbound-skill-creator reference file.

---

### Task 3: Add Source And Generated-Skill References

**Files:**
- Create: `skills/outbound-skill-creator/references/data-sources.md`
- Create: `skills/outbound-skill-creator/references/generated-skill-contract.md`

- [ ] **Step 1: Create `data-sources.md`**

Write `skills/outbound-skill-creator/references/data-sources.md` with this content:

```markdown
# Data Sources

Use this reference when selecting and documenting the generated business skill's source records.

## Required Source Contract

Capture these values before generating a business skill:

- source family
- access method
- date-window filtering semantics
- record identifier or row reference
- E.164 phone-number field
- recipient label field
- dedupe key
- goal input fields
- outreach basis or consent field
- writeback capability

Do not guess missing identifiers, credentials, field names, date filters, or country codes.

## Google Form

Use `google-form` when records come from Google Forms responses.

Capture:

- form ID or discovery rule
- local OAuth path or Apps Script fallback path
- submitted-time window behavior
- linked response spreadsheet availability
- phone-number question
- recipient name question
- dedupe key, normally response ID
- fields to include in the outbound goal
- form-level phone follow-up basis or per-response consent field
- writeback columns for status, result summary, call run ID, and processed timestamp

Generated Google Form skills must require a clear basis for phone follow-up. The basis can come from the form description, ad copy, terms, or an explicit per-response consent field.

If the form has no linked response spreadsheet and the user wants writeback, require an Apps Script fallback or ask the user to link a response spreadsheet before real writeback.

## ttmcp

Use `ttmcp` when records come from TikTok or related MCP tools exposed by the host.

Capture:

- MCP server or connector name
- exact tool or resource names available in the host
- account, advertiser, campaign, lead, audience, or record scope
- date-window fields and timezone semantics
- record ID field
- phone-number field
- recipient label field
- dedupe key
- goal input fields
- outreach basis or consent evidence
- approved writeback tool or the decision to use session-table output

Generated ttmcp skills must not assume every record is callable. They must validate outreach basis and E.164 phone numbers before creating call candidates.

Do not invent ttmcp tools or schemas. If the host does not expose a writeback-capable tool, use session-table output or local CSV output.

## Local CSV

Use `local-csv` when records come from a user-provided CSV file.

Capture:

- CSV path
- delimiter when it is not comma
- header row presence
- date column and date parsing format
- phone-number column
- recipient label column
- dedupe key column or deterministic row key rule
- goal input columns
- outreach basis or consent column
- output CSV path when local writeback is configured

Generated CSV skills should use deterministic scripts when parsing, validating, deduplicating, or writing output would otherwise be fragile.

If writeback is not configured, output the session table described in the generated skill.

## Other Sources

Use `other` when the source is not one of the built-in families.

Ask one question at a time until the source contract is complete:

- How does the agent access records?
- What exact fields are returned?
- Which field is the E.164 phone number?
- Which field proves phone follow-up is authorized?
- Which field is stable enough for dedupe?
- How should date-window filtering work?
- Can results be written back?
- If writeback is possible, what exact action and fields should be used?

If the user cannot provide enough detail for safe access, generate a skill that can produce a dry-run from manually supplied records and states the missing integration blocker.
```

- [ ] **Step 2: Create `generated-skill-contract.md`**

Write `skills/outbound-skill-creator/references/generated-skill-contract.md` with this content:

```markdown
# Generated Skill Contract

Use this reference when writing the business skill created by `outbound-skill-creator`.

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
node <path-to-outbound-skill-creator>/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

Run `python3 scripts/validate_repository.py` only when the generated skill is written into this reference repository or another repository that provides that validation command.
```

- [ ] **Step 3: Run repository validation**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected: validation still fails at the next missing outbound-skill-creator file.

---

### Task 4: Add MCP, Safety, And Examples References

**Files:**
- Create: `skills/outbound-skill-creator/references/mcp-provider-route.md`
- Create: `skills/outbound-skill-creator/references/safety.md`
- Create: `skills/outbound-skill-creator/references/examples.md`

- [ ] **Step 1: Create `mcp-provider-route.md`**

Write `skills/outbound-skill-creator/references/mcp-provider-route.md` with this content:

```markdown
# MCP Provider Route

Generated outbound phone-call skills use this MCP provider route by default:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

## Rules

- Use MCP tools exposed by the host for this route.
- Do not use a CLI bootstrap path.
- Do not invent MCP tool names, schemas, confirmation tokens, or run IDs.
- Stop before real calls when the route is unavailable, authentication is missing, or the host cannot call the route safely.
- Pass full phone numbers only inside private execution payloads after validation and approval.
- Mask phone numbers in user-facing summaries.

## One-Off Provider Flow

Generated skills should follow this provider flow when compatible tools are available:

```text
auth readiness -> call plan -> plan inspection -> call run -> status check -> writeback
```

The plan inspection step must confirm:

- the destination phone number matches the validated candidate
- the generated goal matches the business contract
- the request is one-off and not a recurring provider schedule
- no credentials or confirmation tokens are exposed in user-facing summaries

If the MCP route returns a confirmation token or run identifier, keep it private unless the host documentation states that a run ID is safe to show.

## Scheduled Runs

Recurring schedules belong to the host scheduler, not the provider route.

```text
Host scheduler handles recurrence.
Phone-call provider handles exactly one call per scheduled run.
```

A scheduled generated skill run must still validate records, deduplicate candidates, and use the MCP provider route for only one call per approved candidate.
```

- [ ] **Step 2: Create `safety.md`**

Write `skills/outbound-skill-creator/references/safety.md` with this content:

```markdown
# Safety

Use this reference when creating a generated outbound phone-call business skill.

## Creator Safety

The creator must not generate a business skill that calls arbitrary phone-looking values. It must capture a source contract, outreach basis, E.164 phone-number field, dedupe key, execution policy, and writeback behavior.

If the user cannot explain why records are authorized for phone follow-up, generate a dry-run-only skill or stop and ask for a consent field or approved source basis.

## Generated Skill Safety

Every generated business skill must include rules for:

- explicit user intent before processing records for calls
- E.164 phone numbers
- no country-code guessing
- masked phone numbers in summaries
- no credential exposure
- no hidden recurring schedules
- no duplicate jobs
- dedupe by stable candidate ID or source record ID
- clear cancellation behavior for scheduled workflows
- dry-run or approved direct execution policy
- sensitive-domain boundaries

## Direct Execution

Direct execution is allowed only when the generated skill's creation-time contract explicitly says that a concrete request such as "process all June 20 records" authorizes real calls after validation.

Direct execution still requires:

- candidate validation
- outreach basis validation
- dedupe checks
- masked summaries
- skipping unsafe records
- writeback or session-table output

If direct execution is not configured, generated skills must dry-run first and ask the user to approve the exact pending call list.

## Sensitive Domains

Generated goals must not provide medical, legal, financial, or emergency advice.

For sensitive workflows, generated calls may collect logistics, confirm preferences, schedule follow-up, or route to a human. They must not provide diagnosis, legal conclusions, investment advice, emergency instructions, or other professional judgment.

## Credentials

Do not expose:

- OAuth access tokens or refresh tokens
- MCP auth tokens
- provider credentials
- callback URLs
- confirmation tokens
- cookies
- private full phone numbers in user-facing summaries

## Cancellation

For one-off calls, cancellation is possible only before the provider call runs.

For scheduled processing, cancellation belongs to the host scheduler. Generated skills must explain how to find and disable the scheduler job when the host supports it.
```

- [ ] **Step 3: Create `examples.md`**

Write `skills/outbound-skill-creator/references/examples.md` with this content:

```markdown
# Examples

Use fictional reserved phone numbers in examples.

## Google Form Quote Callback Skill

User request:

```text
Create an outbound skill named quote-request-callback. It should process Google Form quote requests, call leads who authorized phone follow-up, and write results back to the linked response spreadsheet.
```

Captured contract:

- source family: `google-form`
- phone field: `phone`
- recipient label field: `name`
- dedupe key: Google Forms response ID
- date filtering: submitted-time window
- outreach basis: form description states that submission authorizes a phone follow-up
- provider route: `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`
- writeback: linked response spreadsheet
- execution: dry-run first unless the generated skill is configured for approved direct execution

Generated future use:

```text
Use quote-request-callback to process all June 20 submissions.
```

## ttmcp Lead Follow-Up Skill

User request:

```text
Create an outbound skill named tiktok-lead-followup. It should read callable lead records from ttmcp, call leads about their submitted product interest, and write status back only if an approved ttmcp writeback tool exists.
```

Captured contract:

- source family: `ttmcp`
- MCP tool names: captured from the host before generation
- phone field: captured from returned lead records
- recipient label field: captured from returned lead records
- dedupe key: lead record ID
- date filtering: record creation time in the source account timezone
- outreach basis: lead form includes phone follow-up consent
- writeback: approved ttmcp writeback tool or session table fallback

Generated future use:

```text
Use tiktok-lead-followup to process yesterday's callable leads.
```

## Local CSV Appointment Confirmation Skill

User request:

```text
Create an outbound skill named appointment-confirmation-calls. It should read a CSV of appointment records, call each patient to confirm logistics only, and write a result CSV.
```

Captured contract:

- source family: `local-csv`
- CSV path: provided at runtime
- phone column: `phone_e164`
- recipient label column: `patient_name`
- dedupe key column: `appointment_id`
- date filtering: `appointment_date` in `YYYY-MM-DD`
- outreach basis column: `phone_followup_authorized`
- writeback: local result CSV
- sensitive boundary: logistics only, no medical advice

Generated future use:

```text
Use appointment-confirmation-calls to process appointments on 2026-06-20 from /path/to/appointments.csv.
```

## Custom Source Skill

User request:

```text
Create an outbound skill for records from our internal API.
```

Creator behavior:

Ask for source access, returned fields, phone field, outreach basis, dedupe key, date filtering, and writeback capability. If any critical value is unknown, generate a dry-run-only skill or stop before generation.
```

- [ ] **Step 4: Run repository validation**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected: validation still fails at `skills/outbound-skill-creator/scripts/check-generated-skill.mjs`.

---

### Task 5: Add Generated Skill Checker Script

**Files:**
- Create: `skills/outbound-skill-creator/scripts/check-generated-skill.mjs`

- [ ] **Step 1: Create `check-generated-skill.mjs`**

Write `skills/outbound-skill-creator/scripts/check-generated-skill.mjs` with this content:

```javascript
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REQUIRED_ROUTE = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing file: ${filePath}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseFrontmatter(text, filePath) {
  if (!text.startsWith("---\n")) {
    fail(`Missing YAML frontmatter: ${filePath}`);
    return {};
  }

  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    fail(`Unterminated YAML frontmatter: ${filePath}`);
    return {};
  }

  const result = {};
  const block = text.slice(4, end).trim();
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      fail(`Invalid frontmatter line in ${filePath}: ${line}`);
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, "");
    result[key] = value;
  }
  return result;
}

function walkTextFiles(dirPath) {
  const files = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTextFiles(fullPath));
      continue;
    }
    if (/\.(md|mjs|json|yaml|yml|txt)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseArgs(argv) {
  const args = { skillDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skill-dir") {
      args.skillDir = argv[index + 1] || "";
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.skillDir) {
  fail("Usage: check-generated-skill.mjs --skill-dir <path>");
  process.exit();
}

const skillDir = path.resolve(args.skillDir);
const skillName = path.basename(skillDir);
const skillMd = path.join(skillDir, "SKILL.md");
const safetyMd = path.join(skillDir, "references", "safety.md");
const examplesMd = path.join(skillDir, "references", "examples.md");

if (!SLUG_RE.test(skillName)) {
  fail(`Skill directory is not a lowercase slug: ${skillName}`);
}

const skillText = readText(skillMd);
const frontmatter = parseFrontmatter(skillText, skillMd);

if (frontmatter.name !== skillName) {
  fail(`Skill name '${frontmatter.name || ""}' must match directory '${skillName}'`);
}

if (!frontmatter.description || frontmatter.description.length < 40) {
  fail("Skill description must be at least 40 characters");
}

if (!/phone|call/iu.test(frontmatter.description || "")) {
  fail("Skill description must mention phone or call workflow");
}

readText(safetyMd);
readText(examplesMd);

if (fs.existsSync(path.join(skillDir, "template.md"))) {
  fail("Generated outbound skills must not use template.md");
}

const textFiles = fs.existsSync(skillDir) ? walkTextFiles(skillDir) : [];
const allText = textFiles.map((filePath) => readText(filePath)).join("\n");

if (!allText.includes(REQUIRED_ROUTE)) {
  fail(`Generated skill must mention MCP provider route ${REQUIRED_ROUTE}`);
}

for (const filePath of textFiles) {
  const text = readText(filePath);
  if (CJK_RE.test(text)) {
    fail(`CJK text found in generated skill file: ${filePath}`);
  }
}

if (process.exitCode) {
  process.exit();
}

console.log(`Generated skill validation passed: ${skillDir}`);
```

- [ ] **Step 2: Make the script executable**

Run:

```bash
chmod +x skills/outbound-skill-creator/scripts/check-generated-skill.mjs
```

- [ ] **Step 3: Run repository validation**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected: `Repository validation passed.`

---

### Task 6: Test The Checker Script With A Temporary Generated Skill

**Files:**
- No repository files modified.

- [ ] **Step 1: Create a temporary valid generated skill**

Run:

```bash
tmpdir="$(mktemp -d)"
mkdir -p "$tmpdir/sample-callback/references"
cat > "$tmpdir/sample-callback/SKILL.md" <<'EOF'
---
name: sample-callback
description: Process authorized sample records into outbound phone-call tasks through the configured MCP provider route and output a session table.
---

# Sample Callback

## Purpose and When to Use

Use this generated skill for authorized sample outbound phone-call records.

## When Not to Use

Do not use this skill for emergency, medical, legal, or financial advice workflows.
Do not use a CLI bootstrap path.

## Source Contract

The source contract defines the approved data source and row ownership boundary.

## Candidate Fields

Candidate fields include candidate_id, name, phone_e164, timezone, and callback_reason.

## Outbound Goal Contract

The outbound goal contract defines the single-call goal and allowed conversation boundary.

## MCP Provider Route

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

## Execution Modes

Supported execution modes are dry run, preview, and confirmed one-off run.

## Serial Candidate Execution

After approval, serially process all ready candidates. For each candidate, plan, inspect, run, check status when available, record the result, and continue to the next candidate without another per-candidate confirmation.

## Writeback Behavior

Writeback behavior records call status, timestamps, summaries, and masked phone numbers.

## Safety Summary

Safety summary: require explicit user intent, E.164 phone numbers, no duplicate jobs, no hidden recurring schedules, no credential exposure, and clear cancellation behavior.

## Validation Commands

Run node skills/outbound-skill-creator/scripts/check-generated-skill.mjs --skill-dir <skill-dir>.
EOF
cat > "$tmpdir/sample-callback/references/safety.md" <<'EOF'
# Safety

Require explicit intent, E.164 phone numbers, masked summaries, dedupe, and no credential exposure.
EOF
cat > "$tmpdir/sample-callback/references/examples.md" <<'EOF'
# Examples

Use +15550101234 only as a fictional reserved example number.
EOF
node skills/outbound-skill-creator/scripts/check-generated-skill.mjs --skill-dir "$tmpdir/sample-callback"
```

Expected output starts with:

```text
Generated skill validation passed:
```

- [ ] **Step 2: Verify the checker rejects `template.md`**

Run:

```bash
touch "$tmpdir/sample-callback/template.md"
node skills/outbound-skill-creator/scripts/check-generated-skill.mjs --skill-dir "$tmpdir/sample-callback"
```

Expected:

```text
ERROR: Generated outbound skills must not use template.md
```

- [ ] **Step 3: Clean up the temporary directory**

Run:

```bash
rm -rf "$tmpdir"
```

Expected: command exits with status `0`.

---

### Task 7: Final Validation And Commit

**Files:**
- Modified: `scripts/validate_repository.py`
- Created: `skills/outbound-skill-creator/SKILL.md`
- Created: `skills/outbound-skill-creator/references/data-sources.md`
- Created: `skills/outbound-skill-creator/references/generated-skill-contract.md`
- Created: `skills/outbound-skill-creator/references/mcp-provider-route.md`
- Created: `skills/outbound-skill-creator/references/output-targets.md`
- Created: `skills/outbound-skill-creator/references/safety.md`
- Created: `skills/outbound-skill-creator/references/examples.md`
- Created: `skills/outbound-skill-creator/scripts/check-generated-skill.mjs`

- [ ] **Step 1: Run repository validation**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected:

```text
Repository validation passed.
```

- [ ] **Step 2: Check worktree status**

Run:

```bash
git status --short
```

Expected output includes only the outbound-skill-creator implementation files and `scripts/validate_repository.py`.

- [ ] **Step 3: Commit the implementation**

Run:

```bash
git add scripts/validate_repository.py skills/outbound-skill-creator
git commit -m "feat: add outbound skill creator"
```

Expected: commit succeeds with the new skill files.

---

## Self-Review

Spec coverage:

- Built-in sources are covered by `references/data-sources.md`.
- Generated direct-use skill behavior is covered by `SKILL.md` and `references/generated-skill-contract.md`.
- MCP provider route is covered by `references/mcp-provider-route.md`.
- No `template.md` rule is covered by `SKILL.md`, `references/generated-skill-contract.md`, and `scripts/check-generated-skill.mjs`.
- Writeback and session-table fallback are covered by `SKILL.md` and `references/generated-skill-contract.md`.
- Safety rules are covered by `references/safety.md`.
- Validation is covered by repository validation and the generated skill checker script.

Deferred-work marker scan:

- The plan contains no deferred-work markers or unspecified code steps.

Type and name consistency:

- The skill name is consistently `outbound-skill-creator`.
- The MCP provider route is consistently `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`.
- The checker script option is consistently `--skill-dir`.
