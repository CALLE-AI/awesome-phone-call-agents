# Client Adapters

`call-reminder` separates scheduler responsibility from call execution.

```text
Client scheduler handles recurrence.
CALL-E handles exactly one call per scheduled run.
```

Choose the adapter that matches the current client and can safely run the scheduled job with access to CALL-E auth.

## Selection Logic

1. Prefer a native persistent scheduler in the current client when it supports the requested cadence, local time, timezone, and cancellation.
2. Prefer a scheduler that can access the same CALL-E auth context that was verified during setup.
3. If the client can load skills but has no native scheduler, use `external-cron`.
4. If only MCP tools are available, use `mcp-only` and provide setup instructions for an external scheduler.
5. If only shell execution is available, use `shell-only` and provide a command-oriented setup. Do not create a cron job unless the user explicitly authorizes local scheduler fallback.
6. If a cloud scheduler cannot access local CALL-E auth, do not create the reminder. Ask the user to configure remote CALL-E credentials, select a local scheduler, or use a CALL-E MCP route available in that cloud environment.
7. If no adapter can safely create the task, output the runtime prompt and mark the result as not created.

## Adapter Matrix

Each adapter uses this shape:

```yaml
id: adapter-id
displayName: Human-readable name
schedulerType: native_automation | native_routine | external_cron | manual | mcp_orchestrated | shell
schedulePersistence: persistent | session | external | unknown
requiresMachineAwake: true | false | depends
callERoute:
  - existing-calle-skill
  - calle-cli
  - calle-mcp
canCreateScheduleFromSkill: true | false | depends
supportsCancel: true | false | depends
lateRunRisk: low | medium | high
notes:
  - Short implementation notes.
```

### P0 Adapters

```yaml
- id: codex-app
  displayName: Codex App Automation
  schedulerType: native_automation
  schedulePersistence: persistent
  requiresMachineAwake: false
  callERoute:
    - existing-calle-skill
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: true
  supportsCancel: true
  lateRunRisk: low
  notes:
    - Automation prompt must be self-contained.
    - Prefer Codex heartbeat or cron automation APIs when available.
    - Confirm the automation runtime can access CALL-E auth before claiming success.

- id: claude-code-desktop
  displayName: Claude Code Desktop
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: true
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: false
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Use the skill to generate the runtime prompt and scheduler payload.
    - Create the actual recurring schedule with an external scheduler unless a host routine is present.

- id: claude-code-routine
  displayName: Claude Code Routine
  schedulerType: native_routine
  schedulePersistence: persistent
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Use native routines when they can preserve local-time scheduling and access CALL-E auth.
    - If routine credentials are isolated from local CALL-E auth, do not create the reminder.

- id: claude-code-loop
  displayName: Claude Code Loop
  schedulerType: external_cron
  schedulePersistence: session
  requiresMachineAwake: true
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: false
  supportsCancel: false
  lateRunRisk: high
  notes:
    - Loop-style execution is not a durable recurring scheduler by itself.
    - Use it only for a visible manual loop or pair it with an external persistent scheduler.

- id: openclaw
  displayName: OpenClaw Scheduled Task
  schedulerType: native_automation
  schedulePersistence: persistent
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: true
  supportsCancel: true
  lateRunRisk: medium
  notes:
    - Wrapper metadata can declare node plus either calle or npx.
    - Scheduled task prompt must include the CLI resolver and late-run policy.

- id: external-cron
  displayName: External Cron Or Scheduler
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: false
  supportsCancel: depends
  lateRunRisk: high
  notes:
    - Use when the current client has no safe native scheduler.
    - Provide the runtime prompt and exact setup instructions.
    - Do not create local cron unless the user explicitly authorizes that fallback.
```

### P1 Adapters

```yaml
- id: codex-cli
  displayName: Codex CLI With External Scheduler
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: true
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: high
  notes:
    - Use an existing executable runner such as codex exec only when it is installed and can load this skill.

- id: codex-ide
  displayName: Codex IDE Integration
  schedulerType: manual
  schedulePersistence: unknown
  requiresMachineAwake: depends
  callERoute:
    - existing-calle-skill
    - calle-cli
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Prefer any IDE-provided automation only when it is persistent and visible to the user.

- id: github-copilot-vscode
  displayName: GitHub Copilot VS Code
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: true
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: false
  supportsCancel: depends
  lateRunRisk: high
  notes:
    - Generate setup instructions for a separate scheduler.

- id: github-copilot-cli
  displayName: GitHub Copilot CLI
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: true
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: false
  supportsCancel: depends
  lateRunRisk: high
  notes:
    - Use only an existing scheduler runner; do not create hidden recurrence.

- id: github-copilot-cloud-agent
  displayName: GitHub Copilot Cloud Agent
  schedulerType: native_automation
  schedulePersistence: persistent
  requiresMachineAwake: false
  callERoute:
    - calle-mcp
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: low
  notes:
    - Cloud runtime may not access local CALL-E auth.
    - Require remote CALL-E MCP or credential setup before creating the reminder.

- id: gemini-cli
  displayName: Gemini CLI
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: true
  callERoute:
    - calle-cli
  canCreateScheduleFromSkill: false
  supportsCancel: depends
  lateRunRisk: high
  notes:
    - Generate a prompt or shell runner for an external scheduler.

- id: cursor
  displayName: Cursor
  schedulerType: manual
  schedulePersistence: unknown
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Use native automation only if the current Cursor environment exposes it.

- id: antigravity
  displayName: Antigravity
  schedulerType: manual
  schedulePersistence: unknown
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Treat scheduler support as environment-specific until detected.
```

### P2 Adapters

```yaml
- id: windsurf
  displayName: Windsurf
  schedulerType: manual
  schedulePersistence: unknown
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Use external scheduler instructions when no native automation is exposed.

- id: zed
  displayName: Zed
  schedulerType: manual
  schedulePersistence: unknown
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
  canCreateScheduleFromSkill: false
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Generate runtime prompt and external scheduler setup.

- id: cline
  displayName: Cline
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: true
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: false
  supportsCancel: depends
  lateRunRisk: high
  notes:
    - Use external scheduler unless the host exposes a visible recurring task system.

- id: roo
  displayName: Roo
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: true
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: false
  supportsCancel: depends
  lateRunRisk: high
  notes:
    - Use external scheduler instructions.

- id: continue
  displayName: Continue
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: true
  callERoute:
    - calle-cli
  canCreateScheduleFromSkill: false
  supportsCancel: depends
  lateRunRisk: high
  notes:
    - Use a separate scheduler and CALL-E CLI route.

- id: opencode
  displayName: OpenCode
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: true
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: high
  notes:
    - Use existing automation only when visible and cancellable.

- id: goose
  displayName: Goose
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: true
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: high
  notes:
    - Prefer external scheduler unless a native scheduled task feature is available.

- id: warp
  displayName: Warp
  schedulerType: shell
  schedulePersistence: session
  requiresMachineAwake: true
  callERoute:
    - calle-cli
  canCreateScheduleFromSkill: false
  supportsCancel: false
  lateRunRisk: high
  notes:
    - Shell sessions are not durable schedulers.
    - Use external cron or another persistent scheduler for actual recurrence.

- id: mcp-only
  displayName: MCP-Only Host
  schedulerType: mcp_orchestrated
  schedulePersistence: unknown
  requiresMachineAwake: depends
  callERoute:
    - calle-mcp
  canCreateScheduleFromSkill: false
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Provide instructions for an external scheduler to invoke CALL-E MCP tools.
    - Do not invent MCP tools or schemas.

- id: shell-only
  displayName: Shell-Only Host
  schedulerType: shell
  schedulePersistence: external
  requiresMachineAwake: true
  callERoute:
    - calle-cli
  canCreateScheduleFromSkill: false
  supportsCancel: depends
  lateRunRisk: high
  notes:
    - Provide command-oriented setup.
    - Do not create cron, launchd, or system scheduler jobs without explicit user approval.
```

### P3 Future Adapters

```yaml
- id: amp
  displayName: Amp
  schedulerType: manual
  schedulePersistence: unknown
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Future adapter. Use the generic scheduler selection rules.

- id: junie
  displayName: Junie
  schedulerType: manual
  schedulePersistence: unknown
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Future adapter.

- id: kilo
  displayName: Kilo
  schedulerType: manual
  schedulePersistence: unknown
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Future adapter.

- id: kiro
  displayName: Kiro
  schedulerType: manual
  schedulePersistence: unknown
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Future adapter.

- id: qwen-code
  displayName: Qwen Code
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: true
  callERoute:
    - calle-cli
  canCreateScheduleFromSkill: false
  supportsCancel: depends
  lateRunRisk: high
  notes:
    - Future adapter. Use external scheduler instructions.

- id: trae
  displayName: Trae
  schedulerType: manual
  schedulePersistence: unknown
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Future adapter.

- id: replit
  displayName: Replit
  schedulerType: native_automation
  schedulePersistence: persistent
  requiresMachineAwake: false
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: low
  notes:
    - Confirm secrets and CALL-E auth are configured in the scheduled runtime before creating the reminder.

- id: openhands
  displayName: OpenHands
  schedulerType: external_cron
  schedulePersistence: external
  requiresMachineAwake: depends
  callERoute:
    - calle-cli
    - calle-mcp
  canCreateScheduleFromSkill: depends
  supportsCancel: depends
  lateRunRisk: medium
  notes:
    - Future adapter. Use the generic scheduler selection rules.
```
