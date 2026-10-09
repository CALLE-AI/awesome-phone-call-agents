---
name: exact-ref
description: After a CALL-E call that captured an exact identifier, classify it as spoken_only, conversational_confirmed, mismatch, or independently_verified before anything writes it. Never write schema-valid plus readback-yes as a fact.
---

# ExactRef

Use this skill when a CALL-E structured result contains an identifier that will be written into a record: confirmation number, ticket, off-hire reference, order id, pickup number.

This skill does not place a call. It compiles a safe outbound task, then gates the returned identifier with a character-level check and a named provenance state. Fixture replay is the default. Live CALL-E create is host-owned and fail-closed.

Hosts: any Agent Skills-compatible environment (Claude Code, Codex, Cursor, OpenClaw, skills.sh installs). Provider: CALL-E Calls API, Python/TypeScript SDK, CLI, or MCP `get_call_run` output. Side effects: none. The script reads a JSON file and prints a decision.

## When to use

- The next write depends on an exact character string from a phone call
- CALL-E returned `structured_result` and someone is about to treat it as true
- You need a readback protocol in the outbound task without leaking the intended value
- Top-level status is `queued` and you must not create a second call

## When not to use

- The value is already on a portal, email, or paper — that is `no_call`
- Medical, legal, emergency, or payment-card capture
- Guessing a phone number, country, language, or `run_id`
- Calling `track_ui_events` or any undocumented MCP tool
- Treating MCP `COMPLETED` or Calls `task_completed` as permission to write

## Run it (no install, no credentials)

`scripts/exactref.mjs` is a single zero-dependency Node 18+ file. Exit `0` only when the decision is writable, `2` when classified but blocked, `1` on bad input.

```bash
# The live 2026-09-05 miss: readback said yes, one letter is wrong → mismatch, exit 2
node scripts/exactref.mjs classify --intended 07198FECTIST --extracted 07198SECTIST --readback

# Gate a saved CALL-E call object (REST, SDK, `calle call status --json`, or MCP result{} envelope)
node scripts/exactref.mjs gate --call references/call-fs01.json --field identifier --intended 07198FECTIST

# Human typed the value from a written channel → independently_verified, exit 0
node scripts/exactref.mjs verify --intended 07198FECTIST --extracted 07198SECTIST --typed 07198FECTIST --second-channel

# Compile an outbound task; exit 2 if the intended value leaks into it
node scripts/exactref.mjs compile --field "off-hire reference" --destination "the supplier desk" --intended 07198FECTIST

# Self-check: re-classify every fixture, exit 1 if any disagrees with its expected provenance
node scripts/exactref.mjs fixtures
```

Fixtures are synthetic (see `references/examples.md`); the FS-01 identifier pair is the real one, nothing else from the call is included.

## Classify

Rules, in order (see `references/examples.md`, fixtures in `references/fixtures.json`):

1. No extracted value → `unknown`. Do not invent one.
2. Intended value present and not equal (ignoring spaces, hyphens, dots, case) → `mismatch`. Readback-plus-yes does not override. The decision names the first differing character (`firstMismatch`).
3. `secondChannelMatch` and extracted equals intended → `independently_verified`. Only this is writable.
4. Readback confirmed, no second channel → `conversational_confirmed`. Not writable.
5. Otherwise → `spoken_only`. Not writable.

To mark verified, a human must type the identifier and claim a second channel (email, portal, paper). Typing the extracted wrong value keeps `mismatch`.

## Gate a CALL-E call

`gate` reads the call object and refuses before it classifies:

- Not terminal (`queued`, `in_progress`) → `unknown`, "do not write anything yet". `queued` plus attempt activity is not idle; do not create again.
- Terminal without `structured_result` → `unknown`. Task completion is not extraction.
- Terminal with `structured_result` → classify `structured_result[field]` against `--intended`.

It accepts snake_case (REST/Python) and camelCase (TypeScript) field names and unwraps the MCP `result{}` envelope.

## Compile the task

The outbound task must:

- Ask for the whole identifier, then wait for an end marker
- Not interrupt during dictation
- Do one full readback; if refused, ask for the whole string again
- Ask for a word that starts with an ambiguous letter instead of guessing
- Leave contradictory times unresolved
- Never include the intended identifier (the compiler exits `2` if it does)

The compiled `resultSchema` asks CALL-E for `identifier`, `readback_confirmed`, one verbatim `identifier_evidence` span, and `unresolved_time`.

## Wait honesty

- Calls `waitForResult` returns on top-level `completed` / `failed` / `canceled`. It does not wait for `structuredResult`.
- `queued` plus attempt activity is not idle. Do not create again.
- A local timeout is not hangup or cancel.
- Goal wait materializes when `result` or `error` is non-null.
- MCP summaries live under `result{}`. Do not read them at the top level.

## Host board (optional)

The ExactRef repository (https://github.com/Arshgill01/ExactRef) ships a local board that shows the character diff and the typed second-channel stamp: `npm install && npm test && npm run dev` → http://127.0.0.1:3450. Open `OH-01`, then `FS-01`. The write stays blocked until a human types `07198FECTIST` and claims a second channel.

Safety notes: `references/safety.md`.
