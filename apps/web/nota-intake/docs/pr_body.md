**Nota Intake — law-firm client intake by phone** (`apps/web/nota-intake`)

A prospective client picks a topic on a three-step form — real estate, will, trust, lawsuit, or something else — and leaves a name and number. Within a minute CALL-E calls them back and runs *that topic's* interview in the language their number supports, returning a record an intake paralegal can act on. A staff console places intake and reminder calls from the desk, follows them live, and syncs outcomes.

**CALL-E at runtime**
- `POST /v1/calls` per intake, with a task and a `recipient_result_schema` planned per matter type (common fields + type fields: e.g. a lawsuit returns `side`, `court_papers_received`, `papers_deadline`, `court_or_county`)
- `webhook_url` → `/api/calle-webhook`, then `GET /v1/calls/{id}` for authoritative state, transcript turns, confidence and evidence
- `Idempotency-Key` per intake and per reminder
- Reminder calls with their own `REMINDER_SCHEMA` (`confirmed`, `reschedule_request`), outcomes synced back to the record

**Verified with real calls (Sept 4–8, 2026)**
- US (+1) numbers: English and Bahasa Indonesia interviews both completed; the demo video's call scene is a real lawsuit intake recorded on the client's phone (CALL-E returns transcript turns, not audio)
- US numbers reject Spanish via REST `locale`, via Spanish task text with `locale: en-US`, and via MCP `plan_call --language Spanish` (planner offers "English or Bahasa for US") — documented in the README as a per-line capability, not a validation gap; the Spanish script is wired and waits on one row in `regions.json`
- Language is locked per call: the bot offered to switch to English mid-call and could not

**Live**: https://nota-intake.pages.dev (form) · `/review` (staff console, token)
**Repo**: https://github.com/banksythequantLab/nota-intake
**Demo video (≤3 min)**: https://youtu.be/Z62RyctIC0c
**CALL-E account email**: dj@soltis.info

Stack: Cloudflare Pages + Functions + KV, no framework, no build step. MIT.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Ar57DXrn9KZuK8ATrr7Y73
