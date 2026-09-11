# Client Adapters — SIMRS Appointment Reminder

## Supported Clients

### Hermes Agent

Hermes has a built-in cron job scheduler (`cronjob` tool) that can run recurring tasks.

**Adapter:** Use `cronjob action='create'` with a self-contained prompt that reads appointments and places calls.

**Scheduling:** The `schedule` field accepts cron expressions. For daily next-day reminders at 15:00:
```
0 15 * * *
```

**Credential access:** CALL-E auth tokens cached at `~/.calle-mcp/cli/` are accessible from cron jobs running in the same environment.

### Claude Code

Claude Code supports MCP integration through the CALL-E plugin.

**Adapter:** Use the Claude Code plugin at `packages/claude-plugin/`.

**Scheduling:** Claude Code has no built-in scheduler. Use an external scheduler (system cron, GitHub Actions) that invokes Claude Code with a skill-loaded prompt.

### Codex CLI

**Adapter:** Use the Codex plugin at `packages/codex-plugin/`.

**Scheduling:** Same as Claude Code — requires external scheduler.

### Standalone Script

For environments without a native scheduler, provide a standalone Python or Node.js script that:

1. Reads appointments from a JSON/CSV file or SIMRS API
2. Calls `calle` CLI for each appointment
3. Collects results
4. Optionally writes back to SIMRS

See `examples/batch-reminder.py` in the examples.md reference.

## Selection Rules

1. Prefer the current client's native scheduler if it is persistent and can access CALL-E auth.
2. Use an external scheduler adapter when the client can load skills but has no safe native scheduler.
3. Use MCP-only or shell-only instructions when the client cannot create a schedule directly.
4. If no adapter can safely create the scheduled task, output the runtime prompt and mark the result as not created.

## SIMRS Integration Adapters

### REST API Adapter

For SIMRS systems with REST APIs:

```
GET /api/appointments?date=tomorrow&status=SCHEDULED
POST /api/appointments/{id}/status  {"status": "CONFIRMED"}
```

### FHIR Adapter

For SatuSehat-compatible systems:

```
GET /fhir-r4/Appointment?date=2026-07-29&status=booked
PUT /fhir-r4/Appointment/{id}
```

### CSV Export Adapter

For systems without APIs — process a CSV export:

```csv
appointment_id,patient_name,phone,doctor,department,date,time
APT-001,Budi Santoso,+6285929931919,Dr. Ahmad,Poli Jantung,2026-07-29,09:00
```
