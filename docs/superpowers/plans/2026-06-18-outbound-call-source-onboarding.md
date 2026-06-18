# Outbound Call Source Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add creation-time source authentication, sample fetch, schema confirmation, and default goal definition requirements to `outbound-call-skill-creator` so bound generated skills can be used directly after creation.

**Architecture:** Keep this as a contract and validation enhancement, not a new runtime platform. Update the creator instructions and generated skill references to introduce a required "Creation-Time Source Onboarding" phase, then strengthen the generated-skill checker and repository validation fixtures so generated skills cannot silently omit onboarding.

**Tech Stack:** Agent Skills markdown, Node.js standard library checker script, Python standard library repository validator, existing Google Form callback OAuth/export scripts as reference patterns.

---

## File Structure

- Modify `skills/outbound-call-skill-creator/SKILL.md`: add source onboarding to the required creator workflow and bind it to the binding-level rules.
- Modify `skills/outbound-call-skill-creator/references/data-sources.md`: define authentication and sample-fetch requirements for Google Form, TikTok Ads, local CSV, and custom sources.
- Modify `skills/outbound-call-skill-creator/references/generated-skill-contract.md`: require generated skills to record source onboarding, authentication or access check result, sample fetch result, and default goal contract.
- Modify `skills/outbound-call-skill-creator/references/creation-summary.md`: add source onboarding status to the user-facing summary contract.
- Modify `skills/outbound-call-skill-creator/references/examples.md`: update examples to show auth, sample fetch, and default goal definition during creation.
- Modify `docs/outbound-call-skill-creator/README.md`: reflect the new creation-time onboarding flow for humans.
- Modify `skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs`: reject generated skills that omit source onboarding markers or use unsupported binding levels.
- Modify `scripts/validate_repository.py`: add checker smoke tests for source onboarding acceptance and rejection.

## Task 1: Add Failing Validator Coverage For Source Onboarding

**Files:**
- Modify: `scripts/validate_repository.py`

- [ ] **Step 1: Extend the valid generated skill fixture with source onboarding**

In `validate_outbound_generated_skill_checker()`, update the `valid_skill_md` string so it contains this section after `## Source Contract`:

```markdown
## Source Onboarding

Source onboarding completed for this parameterized-bound workflow.
Authentication or access check result: passed with local source credentials.
Sample fetch result: passed with a representative source instance.
Sampled source instance: representative-callback-source.
Discovered field mapping: candidate_id, phone_e164, name, submitted_at, consent, and callback_reason.
Default goal contract derived from sampled fields: call the respondent about callback_reason and summarize the result.

```

- [ ] **Step 2: Add a failing fixture for missing source onboarding**

After the current missing-serial-execution fixture and before the maximum-only execution fixture, add this test block:

```python
    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_source_onboarding_md = valid_skill_md.replace(
            """## Source Onboarding

Source onboarding completed for this parameterized-bound workflow.
Authentication or access check result: passed with local source credentials.
Sample fetch result: passed with a representative source instance.
Sampled source instance: representative-callback-source.
Discovered field mapping: candidate_id, phone_e164, name, submitted_at, consent, and callback_reason.
Default goal contract derived from sampled fields: call the respondent about callback_reason and summarize the result.

""",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_source_onboarding_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_source_onboarding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_source_onboarding_output = (
            missing_source_onboarding_failure.stdout + missing_source_onboarding_failure.stderr
        )
        if missing_source_onboarding_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing source onboarding.")
        if (
            "Generated skill SKILL.md must include source onboarding"
            not in missing_source_onboarding_output
        ):
            fail("Generated outbound skill checker missing-source-onboarding message changed.")
```

- [ ] **Step 3: Add a failing fixture for incomplete bound onboarding**

Add this block after the missing source onboarding test:

```python
    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        incomplete_bound_onboarding_md = valid_skill_md.replace(
            "Authentication or access check result: passed with local source credentials.\n",
            "",
        ).replace(
            "Sample fetch result: passed with a representative source instance.\n",
            "",
        )
        (skill_dir / "SKILL.md").write_text(incomplete_bound_onboarding_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        incomplete_bound_onboarding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        incomplete_bound_onboarding_output = (
            incomplete_bound_onboarding_failure.stdout + incomplete_bound_onboarding_failure.stderr
        )
        if incomplete_bound_onboarding_failure.returncode == 0:
            fail("Generated outbound skill checker must reject incomplete bound source onboarding.")
        if (
            "Bound generated skill SKILL.md must include authentication or access check result"
            not in incomplete_bound_onboarding_output
        ):
            fail("Generated outbound skill checker incomplete-bound-onboarding message changed.")
```

- [ ] **Step 4: Run repository validation and verify RED**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected: validation fails with `ERROR: Generated outbound skill checker must reject missing source onboarding.`

## Task 2: Implement Source Onboarding Checks In The Generated Skill Checker

**Files:**
- Modify: `skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs`
- Verify through: `python3 scripts/validate_repository.py`

- [ ] **Step 1: Add source onboarding marker requirements**

In `check-generated-skill.mjs`, add these constants after `REQUIRED_SKILL_MARKERS`:

```javascript
const BOUND_ONBOARDING_MARKERS = [
  {
    label: "authentication or access check result",
    patterns: [/authentication or access check result/iu, /auth(?:entication)? check result/iu],
  },
  {
    label: "sample fetch result",
    patterns: [/sample fetch result/iu],
  },
  {
    label: "default goal contract derived from sampled fields",
    patterns: [/default goal contract derived from sampled fields/iu],
  },
];
```

- [ ] **Step 2: Require source onboarding for all generated skills**

After the existing required section marker loop, add:

```javascript
if (!/source onboarding/iu.test(skillText)) {
  fail("Generated skill SKILL.md must include source onboarding");
}
```

- [ ] **Step 3: Require complete onboarding for bound skills**

After `selectedExecutionMode` is extracted and before the unbound/direct-execution compatibility check, add:

```javascript
if (["fully-bound", "parameterized-bound"].includes(selectedBindingLevel)) {
  for (const marker of BOUND_ONBOARDING_MARKERS) {
    if (!marker.patterns.some((pattern) => pattern.test(skillText))) {
      fail(`Bound generated skill SKILL.md must include ${marker.label}`);
    }
  }
}
```

- [ ] **Step 4: Reject unsupported binding levels**

Immediately after the bound onboarding block, add:

```javascript
if (UNSUPPORTED_BINDING_LEVEL_RE.test(skillText)) {
  fail("Generated skill must use fully-bound or parameterized-bound");
}
```

- [ ] **Step 5: Run repository validation and verify GREEN for checker tests**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected: validation still fails later because creator docs do not yet include the new required acceptance text, or passes if no acceptance text has been added yet. If it fails, keep the failure and continue to Task 3.

- [ ] **Step 6: Commit checker and validator changes when validation reaches a meaningful state**

If validation passes after this task, run:

```bash
git add scripts/validate_repository.py skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs
git commit -m "test: require source onboarding in generated outbound skills"
```

If validation fails because later tasks have not been implemented, do not commit yet.

## Task 3: Update Creator Workflow Instructions

**Files:**
- Modify: `skills/outbound-call-skill-creator/SKILL.md`

- [ ] **Step 1: Update the creator workflow list**

Replace steps 7 through 12 under `## Required Creator Workflow` with:

```markdown
7. Run creation-time source onboarding for the selected binding level:
   - `fully-bound`: authenticate or verify the concrete source, fetch a representative sample from that source, confirm schema and durable result-output readiness, and stop before generating a real-call skill if onboarding cannot complete.
   - `parameterized-bound`: authenticate or verify the source family, fetch a representative sample from one approved source instance, confirm the schema contract, and record which runtime parameters may vary later.
   If source onboarding cannot satisfy the minimum `parameterized-bound` contract, do not write the generated skill yet; continue onboarding or stop with the missing contract details.
8. Capture the source fields from the sampled schema for phone number, recipient label, dedupe key, date filtering, outreach basis or consent, goal inputs, and any runtime parameters allowed by the binding level.
9. Show a small redacted sample summary and prompt the user to confirm or adjust field mapping.
10. Prompt the user to define the default outbound goal from the sampled fields: call purpose, required context, allowed questions, prohibited claims, completion criteria, result values, summary format, and escalation cases.
11. Read `references/mcp-provider-route.md` and use the default MCP provider route in the generated skill.
12. Read `references/execution-modes.md` and ask the user to choose an execution mode, defaulting to `dry-run-then-batch-approval`: `dry-run-then-batch-approval` or `approved-direct-execution`.
13. Capture result-output policy at creation time and capture field mapping or allowed runtime output parameters: source writeback, source-adjacent result artifact, local result CSV, or last-resort session table fallback.
14. Run best-effort creation-time preflight checks when tools and permissions are available: read-only source auth/schema checks, non-mutating result-output target or field checks, and MCP route/tool readiness. If preflight cannot run for a bound workflow, record the blocker and do not generate a real-call skill until runtime onboarding requirements are satisfied.
15. Read `references/safety.md` and include the required safety boundaries in the generated skill.
16. Generate the business skill folder and files in the selected output parent using `references/generated-skill-contract.md`.
17. Run this skill's bundled checker script with `--skill-dir <generated-business-skill-dir>`.
18. Read `references/creation-summary.md` and show the user a creation summary covering skill name, path, binding level, source onboarding, source contract, goal contract, execution mode, result-output target, provider route, validation result, and reload or discovery note.
19. Run repository validation only when the generated skill is being committed to a repository that provides a validation command.
```

- [ ] **Step 2: Add a new `## Creation-Time Source Onboarding` section**

Add this section after `## Built-In Choices`:

```markdown
## Creation-Time Source Onboarding

Creation-time source onboarding happens after source family and binding level selection, and before final goal and result-output contract generation.

For `fully-bound` generated skills, authenticate or verify the concrete source, fetch a representative sample from that exact source, confirm schema and durable result-output readiness, and stop before generating a real-call skill when onboarding cannot complete.

For `parameterized-bound` generated skills, authenticate or verify the source family, fetch a representative sample from one approved source instance, confirm the schema contract, and allow runtime instances only when the runtime gate verifies the same schema and source contract.

If source onboarding cannot produce enough source, schema, consent, dedupe, and durable result-output detail for the minimum `parameterized-bound` contract, stop before writing the generated skill and ask for the missing contract details.

During onboarding, show the user a small redacted sample summary, never full private phone numbers, credentials, tokens, cookies, callback URLs, or provider confirmation tokens. Use the sampled fields to help the user define the default outbound goal.
```

- [ ] **Step 3: Update `## Creation Summary` required fields**

Add `source onboarding status, sampled source instance, and sample fetch result` after `binding level and allowed runtime parameters`.

- [ ] **Step 4: Update `## Runtime Contract Formats`**

Add this bullet:

```markdown
- source onboarding report with `binding_level`, `source_family`, `access_method`, `auth_or_access_check`, `sample_fetch`, `sampled_source_instance`, `field_mapping`, `default_goal_source`, and `onboarding_blocker`
```

- [ ] **Step 5: Run repository validation**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected: validation passes or fails only on missing acceptance text that Task 7 will add.

## Task 4: Update Data Source Guidance

**Files:**
- Modify: `skills/outbound-call-skill-creator/references/data-sources.md`

- [ ] **Step 1: Extend the required source contract**

In `## Required Source Contract`, add these bullets after `access method`:

```markdown
- authentication or access check method
- creation-time source onboarding status
- sampled source instance or representative runtime instance
- sample fetch result and redaction rule
```

- [ ] **Step 2: Replace the preflight paragraph with onboarding-aware language**

In `## Preflight and Runtime Gate`, replace the first paragraph and bullet list with:

```markdown
Creation-time source onboarding is required for `fully-bound` and `parameterized-bound` real-call skills. Run non-mutating checks when tools and permissions are available:

- verify source authentication, connector availability, or local file access
- fetch a small representative sample from the concrete or representative source instance
- inspect source schema or sample rows without placing calls
- confirm the phone, recipient, date, consent, dedupe, and goal input fields exist
- confirm the sample can support the default outbound goal contract
- confirm source writeback target and fields exist, configure a source-adjacent result artifact, or configure a local result CSV target; session table is only a last-resort non-persistent fallback
- confirm the MCP provider route and compatible plan, run, or status tools are available
```

- [ ] **Step 3: Update the Google Form section**

Add these bullets to the `Capture:` list:

```markdown
- Google authentication or Apps Script access check result
- sampled form ID or representative runtime form ID
- sample response fetch result and redacted sample summary
- default goal fields derived from the sampled form questions
```

Add this paragraph after the linked spreadsheet paragraph:

```markdown
For `fully-bound`, creation must verify access to the concrete form and fetch a small response sample before generating a real-call skill. For `parameterized-bound`, creation must verify Google access and sample one representative form so the generated skill can later accept a runtime form ID only when the runtime gate confirms the form matches the sampled schema. Use the existing `google-form-callback` local OAuth and export scripts as the preferred reference pattern when available.
```

- [ ] **Step 4: Update TikTok Ads, Local CSV, and Other Sources**

Add one paragraph to each section:

```markdown
During creation-time onboarding, fetch a small sample through the exact MCP tool or resource names exposed by the host. Record the tool names, sampled scope, returned fields, and redaction rule in the generated skill.
```

```markdown
During creation-time onboarding, read a small sample from the concrete or representative CSV path. Confirm headers, delimiter, date parsing, consent, dedupe, goal input columns, and output path behavior before generating a bound real-call skill.
```

```markdown
For custom sources, do not generate a skill until the source can be authenticated or accessed, sampled safely, and mapped to the required phone-call fields.
```

- [ ] **Step 5: Run repository validation**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected: no new English or expected-file failures.

## Task 5: Update Generated Skill, Summary, Example, And Human Docs

**Files:**
- Modify: `skills/outbound-call-skill-creator/references/generated-skill-contract.md`
- Modify: `skills/outbound-call-skill-creator/references/creation-summary.md`
- Modify: `skills/outbound-call-skill-creator/references/examples.md`
- Modify: `docs/outbound-call-skill-creator/README.md`

- [ ] **Step 1: Add source onboarding to required generated sections**

In `generated-skill-contract.md`, add `source onboarding` to the `## Required Sections` list after `source contract`.

- [ ] **Step 2: Add a source onboarding contract section**

In `generated-skill-contract.md`, add this section after `## Runtime Request Contract`:

```markdown
## Source Onboarding Contract

Generated bound skills must record creation-time source onboarding:

- binding level
- source family
- access method
- sampled source instance or representative runtime instance
- authentication or access check result
- sample fetch result
- safe sample fetch command, tool, or route when it can be disclosed
- discovered field mapping
- redaction policy for sample summaries
- default goal contract derived from sampled fields
- runtime parameters still allowed

Missing source onboarding blocks skill generation until the source contract is complete enough for at least `parameterized-bound`.
```

- [ ] **Step 3: Update creation summary shape**

In `creation-summary.md`, add `source onboarding status, sampled source instance, sample fetch result, and default goal source` to required fields.

Update the summary shape by inserting:

```text
Source onboarding: <auth/access check, sampled source instance, sample fetch result, and blocker if any>
```

after the `Binding level:` line.

- [ ] **Step 4: Update examples**

In `examples.md`, update each captured contract list to include:

```markdown
- source onboarding: authentication or access check completed, representative sample fetched, schema confirmed, and default goal fields confirmed from the sample
```

For the Custom Source example, add:

```markdown
If source onboarding cannot authenticate or sample the source safely, stop before generation and explain the missing contract detail.
```

- [ ] **Step 5: Update human docs**

In `docs/outbound-call-skill-creator/README.md`, add a new section after `## Creation Prompt Flow`:

```markdown
## Source Onboarding

For bound workflows, creation includes a source onboarding pass before the generated skill is written. The creator verifies or repairs source access, fetches a small representative sample, confirms the schema, and uses the sampled fields to help define the default outbound goal. This lets a later runtime request provide only the intended processing scope, such as a date window, instead of rebuilding the source and goal contract.

If source onboarding cannot satisfy the minimum `parameterized-bound` contract, stop before generation and record the blocker in the creation conversation.
```

- [ ] **Step 6: Run repository validation**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected: validation passes or fails only on explicit acceptance text added in Task 7.

## Task 6: Update Checker Fixture For Bound And Unbound Cases

**Files:**
- Modify: `scripts/validate_repository.py`

- [ ] **Step 1: Add an unsupported binding negative fixture**

After the selected-execution fixture, add a negative fixture that ensures unsupported binding levels fail:

```python
    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        unsupported_binding_level = "un" + "bound-" + "generic"
        unsupported_binding_md = valid_skill_md.replace(
            "Binding level: parameterized-bound.",
            f"Binding level: {unsupported_binding_level}.",
        )
        (skill_dir / "SKILL.md").write_text(unsupported_binding_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        unsupported_binding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        unsupported_binding_output = (
            unsupported_binding_failure.stdout + unsupported_binding_failure.stderr
        )
        if unsupported_binding_failure.returncode == 0:
            fail("Generated outbound skill checker must reject unsupported binding levels.")
        if "unsupported binding levels are not allowed" not in unsupported_binding_output:
            fail("Generated outbound skill checker unsupported-binding message changed.")
```

- [ ] **Step 2: Run repository validation**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected: validation passes after Task 2 checker logic is complete.

## Task 7: Add Repository Acceptance Requirements For The New Flow

**Files:**
- Modify: `scripts/validate_repository.py`

- [ ] **Step 1: Add creator acceptance strings**

In `validate_outbound_call_skill_creator_acceptance_rules()`, add these strings to the `SKILL.md` `require_text()` list:

```python
            "Creation-Time Source Onboarding",
            "source onboarding",
            "sampled fields",
            "stop before writing the generated skill and ask for the missing contract details",
```

- [ ] **Step 2: Add data source acceptance strings**

Add a new `require_text()` call for `references/data-sources.md`:

```python
    require_text(
        skill_dir / "references" / "data-sources.md",
        [
            "creation-time source onboarding",
            "fetch a small representative sample",
            "default outbound goal contract",
            "Use the existing `google-form-callback` local OAuth and export scripts as the preferred reference pattern when available.",
        ],
    )
```

- [ ] **Step 3: Add generated contract acceptance strings**

Add a new `require_text()` call for `references/generated-skill-contract.md`:

```python
    require_text(
        skill_dir / "references" / "generated-skill-contract.md",
        [
            "Source Onboarding Contract",
            "authentication or access check result",
            "sample fetch result",
            "default goal contract derived from sampled fields",
            "onboarding blocker",
        ],
    )
```

- [ ] **Step 4: Run repository validation**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected: validation passes.

## Task 8: Final Verification And Commit

**Files:**
- Verify all modified files from Tasks 1 through 7.

- [ ] **Step 1: Run full validation**

Run:

```bash
python3 scripts/validate_repository.py
```

Expected:

```text
Repository validation passed.
```

- [ ] **Step 2: Confirm no skill README files exist**

Run:

```bash
find skills -maxdepth 2 -name README.md -print
```

Expected: no output.

- [ ] **Step 3: Inspect git diff**

Run:

```bash
git diff --stat
git diff -- skills/outbound-call-skill-creator scripts/validate_repository.py docs/outbound-call-skill-creator/README.md
```

Expected: diffs only cover source onboarding contract, docs, checker, and validation fixtures.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add skills/outbound-call-skill-creator docs/outbound-call-skill-creator/README.md scripts/validate_repository.py
git commit -m "feat: require source onboarding for outbound skill creation"
```

- [ ] **Step 5: Report status**

Report:

- validation command and result
- commit hash
- summary of changed contracts
- any remaining limitations, especially that no generic source adapter scripts were added
