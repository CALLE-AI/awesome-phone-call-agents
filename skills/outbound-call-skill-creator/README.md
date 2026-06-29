# Outbound Call Skill Creator

Create reusable outbound phone-call Agent Skills that connect approved business
records to safe, one-off AI-agent phone-call workflows.

## What It Does

`outbound-call-skill-creator` helps an agent generate a focused business skill
for outbound callback, lead follow-up, appointment, reminder, or similar
phone-call workflows. It does not place calls during setup. Instead, it captures
the source contract, field mapping, outreach basis, dedupe rule, call goal,
provider route, execution mode, result-output policy, and runtime safety checks
that the generated skill must enforce later.

The generated skill can later read source records, validate eligible candidates,
compile one call goal per record, run calls through an authenticated one-off MCP
call provider route, and write durable results through source writeback,
source-adjacent result artifacts, or a local result CSV.

## Quick Start

1. Install or upload this skill folder as an Agent Skill. The uploaded zip must
   contain `SKILL.md`, this `README.md`, `references/`, and `scripts/` at the
   skill folder root.
2. Ask the agent to create a new outbound phone-call workflow skill:

   ```text
   Use outbound-call-skill-creator to create a skill named quote-request-callback.
   It should process authorized Google Form quote requests, call eligible leads,
   and write results back to the response spreadsheet.
   ```

3. During creation, provide only the required source locator, authorization, and
   workflow details requested by the agent.
4. Review the generated skill summary, validation result, provider onboarding
   status, runtime parameters, and safety gates before using the generated skill
   for real calls.

To validate a generated business skill locally, run:

```bash
node skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

## Target Platforms

This skill is designed for Agent Skills-compatible agent hosts, including
ChatGPT or Codex, Claude, Gemini, and similar MCP-capable agent environments.

The creator is host-aware. It records the selected host runtime and uses the
host's supported MCP or connector setup flow when onboarding a source system or
phone-call provider. Some host-specific setup steps may differ between
platforms.

## Prerequisites And Dependencies

- An Agent Skills-compatible host that can load this skill.
- Access to a supported source family when creating a generated business skill:
  Google Forms, TikTok Ads, local CSV, or a custom approved source.
- A verified outreach basis or consent rule for every callable record.
- E.164 formatted phone numbers for real calls.
- A stable dedupe key or dedupe state rule.
- A durable result-output policy, such as source writeback, a source-adjacent
  result artifact, or a local result CSV.
- For real calls, an authenticated one-off MCP phone-call provider route.

For TikTok Ads workflows, the creator may use the TikTok for Business MCP server
or another approved TikTok Ads access route if it is available in the host. The
skill itself does not require TikTok Ads access unless the generated workflow is
for TikTok Ads records.

For real outbound calls, generated skills use the default CALL-E MCP provider
route unless the generated skill explicitly documents another approved one-off
provider route:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

## Configuration

The creator captures these workflow choices during skill generation:

| Option | Default | Notes |
| --- | --- | --- |
| Source family | User-selected | Built-in choices are `google-form`, `tiktok-ads`, `local-csv`, and `other`. |
| Binding level | `parameterized-bound` | Use `fully-bound` only when one fixed source and result target should be locked at creation time. |
| Execution mode | `dry-run-then-batch-approval` | `approved-direct-execution` is available only after required gates pass. |
| Provider route | CALL-E MCP route | Real-call skills must verify route setup, authentication, and compatible tools before calls. |
| Result output | Durable target required | Prefer source writeback when verified; otherwise use source-adjacent artifacts or local result CSV. |
| Session-table output | Last-resort fallback | Not suitable for unattended automation unless explicitly accepted by the user. |

## Common Errors And Handling

| Issue | What To Check |
| --- | --- |
| Source access fails | Verify the selected source route, OAuth or connector state, and the minimum source locator. |
| No callable candidates appear | Check phone field mapping, outreach basis, consent field, date filters, and dedupe state. |
| Provider is not ready | Verify the MCP provider route is configured, authenticated, and exposes compatible one-off call tools. |
| Result output is blocked | Confirm the writeback target, source-adjacent artifact, or local CSV path is writable and durable. |
| Runtime request is too vague | Provide the approved runtime parameters, such as form ID, CSV path, campaign ID, date window, or output path. |

## Limitations And Safety Notes

- This creator does not process campaign data or place calls by itself.
- Do not place real calls during creation-time onboarding or preflight.
- Do not expose credentials, tokens, cookies, callback URLs, confirmation
  tokens, or full private phone numbers in prompts, summaries, logs, or outputs.
- Real calls require explicit user intent, verified outreach basis or consent,
  E.164 phone numbers, dedupe checks, provider authentication, and a passing
  runtime gate.
- Medical, legal, financial, emergency, and other high-stakes content must stay
  within the generated skill's documented safety boundaries.
- Provider-side recurrence is not required. For recurring workflows, the host
  scheduler should handle recurrence and the call provider should handle exactly
  one call per scheduled run.

## Maintenance And Feedback

This skill is maintained as part of the CALLE-AI
`awesome-phone-call-agents` reference repository. Report issues, limitations,
or improvement requests through the repository issue tracker:

```text
https://github.com/CALLE-AI/awesome-phone-call-agents/issues
```
