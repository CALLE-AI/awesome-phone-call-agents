# CALL-E V4 Progress

## Page 001 — System baseline and V4 guardrails ✅

**Files:** `server/_core/env.ts`, `server/calle/v4-flags.ts`, `docs/calle-v4/*`

**Verification:** `pnpm check`, `tests/calle-v4.test.ts` (flags)

**Limitation:** Feature flags are env-based; no remote config service.

## Page 002 — Call command center ✅

**Files:** `server/calle/command-center.ts`, `server/calle/service.ts`, `server/routers.ts`, `app/chw/calls.tsx`

**Verification:** `tests/calle-v4.test.ts` (filter + auth)

**Limitation:** In-memory workflow store only; filters are server-side over session data.

## Page 003 — Provider capability registry ✅

**Files:** `server/calle/provider-capabilities.ts`, `server/calle/capabilities.ts`

**Verification:** `tests/calle-v4.test.ts` (demo vs live capability matrix)

**Limitation:** Transfer and cancel remain unsupported in current SDK; registry documents truthfully.

## Page 004 — Call intent compiler ✅

**Files:** `server/calle/intent-compiler.ts`

**Verification:** `tests/calle-v4.test.ts` (happy path, missing consent, urgent block, colloquial normalize)

## Page 005 — AI call brief generator ✅ (rule-based)

**Files:** `server/ai/call-brief.ts`

**Verification:** `tests/calle-v4.test.ts` (schema + redaction)

**Limitation:** Model path not wired; deterministic template fallback only.

## Page 006 — Conversation state machine ✅

**Files:** `server/calle/conversation-state.ts`

**Verification:** `tests/calle-v4.test.ts` (legal transitions + escalation exit)

## Deferred (pages 007+)

- Turn-level orchestration, interruption handling, silence policy
- Voicemail/busy/no-answer escalation UI polish
- Human takeover console (page 014)
- DB persistence for workflows

**Last run:** `pnpm exec vitest run tests/calle-v4.test.ts` + full CALL-E suite + `pnpm check`
