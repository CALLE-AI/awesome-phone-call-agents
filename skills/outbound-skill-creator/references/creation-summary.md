# Creation Summary

Use this reference after the generated business skill has been written and validated.

## Purpose

The creation summary is the user's final review surface. It should show what was fixed at creation time, what remains parameterized for runtime, which checks passed or are blocked, and how the generated skill can be discovered.

## Required Fields

Include:

- skill name
- generated skill directory
- output scope
- discoverability or reload note
- binding level
- allowed and required runtime parameters
- source family, access method, and required fields
- consent or outreach basis
- dedupe key or dedupe state rule
- outbound goal contract summary
- selected execution mode and unavailable modes
- writeback policy, target binding, and field mapping
- creation-time preflight result or blocker
- mandatory runtime gate checks before real calls
- MCP provider route
- validation command and result

## Summary Shape

Use this shape:

```text
Skill: <business-skill-name>
Directory: <generated-skill-directory>
Discovery: <known-active-root | reload-needed | add-location-needed | nonstandard-path>
Binding level: <fully-bound | parameterized-bound | unbound-generic>
Runtime parameters: <allowed parameters or none>
Source: <source family, access method, required fields>
Consent: <field or approved source basis>
Dedupe: <key or state rule>
Goal: <one-sentence call purpose and completion criteria>
Execution mode: <selected mode and any unavailable modes>
Writeback: <policy, target binding, and field mapping>
Preflight: <passed | blocked | not run, with reason>
Runtime gate: <checks that must pass before real calls>
Provider route: https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
Validation: <command and result>
```

## Safety

The summary must distinguish fixed values from runtime parameters. Do not show credentials, tokens, cookies, callback URLs, confirmation tokens, or full phone numbers.

If a value is unknown, label it as a blocker and state whether the generated skill is dry-run-only until resolved.
