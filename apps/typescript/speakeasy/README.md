# Speakeasy

Speakeasy makes the English phone calls you would rather not — for people with
limited English, phone anxiety, a disability, or no time during business hours.
You speak or type a task in your own language; Speakeasy translates it to English,
reads it back for you to confirm, and only then has CALL-E place the English call,
navigate the menu, and talk to the receptionist. You watch the conversation happen
live, then hear and read the outcome — and any confirmation number — back in your
own language, saved to your history.

**Contribution area: User-facing Apps.** This directory is a catalog and setup
guide for the runnable [Speakeasy application](https://github.com/yasaausman/Speakeasy).
The application source, tests, and CI are maintained there under the MIT license.
The instructions below target revision
[`c0ed346`](https://github.com/yasaausman/Speakeasy/tree/c0ed346ebe149a095538c1775e83b339da4eaa74).

- [Full setup and architecture](https://github.com/yasaausman/Speakeasy/blob/c0ed346ebe149a095538c1775e83b339da4eaa74/README.md)
- [Synthetic sample result (reserved fictional data)](https://github.com/yasaausman/Speakeasy/blob/c0ed346ebe149a095538c1775e83b339da4eaa74/docs/sample-run.json)
- [Upstream integration feedback we reported](https://github.com/yasaausman/Speakeasy/blob/c0ed346ebe149a095538c1775e83b339da4eaa74/docs/CALLE-INTEGRATION-FEEDBACK.md)

## What it does

- **Language-first.** Twelve user languages (English, Spanish, Chinese, Hindi,
  Arabic, Vietnamese, French, Portuguese, Korean, Tagalog, Russian, Haitian
  Creole), with right-to-left layout for Arabic. The phone call itself is always
  in English; the user's side is translated.
- **Voice and text, both ways.** Speak or type in; spoken narration and saved
  text out, using native on-device iOS speech (no third-party voice keys).
- **Finishes the task.** Books, confirms, and captures the reference number —
  not just a price lookup.
- **Multi-call comparison.** Call several places, rank the outcomes for the
  user's goal, and book the best one.
- **Speculative two-call booking.** Because CALL-E is one-shot async (there is no
  live "hold"), Speakeasy can call once to ask what times are available, let the
  user pick, then call back to book that exact slot.

## Supported host and CALL-E integration

A small TypeScript / Node (Fastify) backend owns all CALL-E logic; a native
SwiftUI iOS app is the user's side and talks to the backend over HTTP. CALL-E is
reached over its MCP endpoint (`/mcp/openagent_oauth`, Streamable HTTP) using the
three tools in order:

1. `plan_call` prepares the call from a composed English brief (goal, disclosure,
   the user's saved facts, and front-loaded booking preferences). No call is
   placed. This is gated behind an explicit user confirmation in the app.
2. `run_call` places the call once the user confirms.
3. `get_call_run` is polled for status, the live activity feed (streamed into the
   app as a transcript), and the terminal structured result.

The result is normalized, translated to the user's language, narrated, and saved.
Auth uses the `calle` CLI token cache (`calle auth login`). Translation and
multi-call ranking use Gemini when a key is present and fall back to offline
behavior otherwise.

## Setup and usage

Full instructions are in the upstream README. The core loop needs only Node —
no Mac, no keys, and no real calls:

```bash
git clone https://github.com/yasaausman/Speakeasy.git
cd Speakeasy
npm install
npm test            # deterministic end-to-end flow tests (fake transport, offline)
npm run smoke:fake  # full plan -> run -> poll -> normalized result
```

Real translation is opt-in with `GEMINI_API_KEY` in `.env`. The iOS app is built
with XcodeGen + Xcode (see the upstream `ios/README.md`) and talks to the backend
started with `npm run dev`.

## Side effects, dry-run, and safety

- **No-call by default.** The backend uses a fake CALL-E transport unless it is
  started with `CALLE_MODE=real`, so `npm test`, `npm run smoke:fake`, and the app
  against a fake-mode backend place **no** real calls.
- **Real calls** are placed only in real mode, only after the in-app **confirm
  gate** (an explicit user "yes"), and only to the number the user provided.
- **AI disclosure is non-optional** — every brief instructs the agent to identify
  itself as an AI assistant calling on the user's behalf.
- **Side-effect limitation (important).** The confirm gate is the only control
  point. Once `run_call` places a call it **cannot be cancelled or stopped from the
  app** — CALL-E's MCP flow has no cancel operation, `get_call_run` is read-only,
  and starting a new request only resets the app's view; it does **not** stop an
  in-progress call or change whether that call counts against your call quota.
  Speakeasy does not create recurring jobs or schedules, so there is nothing to
  cancel later; each request is one confirmed call (or, for the two-call flow, one
  confirmed discovery call and one confirmed booking call).
- **Credentials** stay local: the CALL-E token is managed by the `calle` CLI, and
  any provider key lives in a git-ignored `.env`. Documentation and samples use
  only fictional reserved numbers (`+1-555-01xx`); no real numbers, call
  recordings, transcripts, or identifiers are committed.
