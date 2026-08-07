# calle-mcp-result-extractor

Schema-validated structured results from CALL-E calls placed over MCP — which has no
`result_schema` parameter of its own.

## The problem

CALL-E's Developer API supports asking for a structured result by passing a JSON schema alongside
your call request, and getting back data that matches it. That's a REST-API-only feature.

CALL-E's MCP tool surface (`plan_call`, `run_call`, `get_call_run` — what you get when CALL-E is
wired up as an MCP server for an agent host) has no equivalent parameter. Every completed run's
`result.extracted` field is CALL-E's own generic call metadata (duration, disposition, and
similar) — never output shaped to whatever your agent actually needed to know from the call. You
do get `result.transcript`, though, every time.

If your agent host only talks to CALL-E over MCP — Claude Code, Cowork-style agents, OpenClaw,
Hermes, skills.sh-installed agents, or anything else set up as an MCP client rather than calling
the REST API directly — and you need a typed answer instead of a transcript to read, you have to
extract it yourself. This is that extraction step: give it a transcript and a Zod schema, get back
a value that satisfies the schema or a clear error explaining why it doesn't.

## Try it without an account

```bash
npm install
npm run demo
```

This runs the full pipeline — a canned completed call-run standing in for a real one, extracted
through a deterministic fake reasoning provider — with no CALL-E account, no AWS credentials, and
no network calls at all. It prints the structured result extracted from
[`fake/sample-call-run.json`](fake/sample-call-run.json)'s transcript.

## Setup

```bash
npm install
npm run check   # tsc --noEmit
npm test        # runs against the fake provider and a stubbed Bedrock client — no credentials needed
```

For live extraction you need AWS credentials that can invoke Bedrock (any of the usual chain:
profile, environment variables, execution role). For live calls you additionally need a CALL-E
session:

```bash
npx @call-e/cli auth login
```

This tool reuses that login's token cache (`~/.calle-mcp/cli` by default) through
[`@call-e/core`](https://www.npmjs.com/package/@call-e/core) — there's no separate login flow to
maintain here. Override the cache location or MCP server with `CALLE_MCP_CACHE_ROOT` /
`CALLE_MCP_SERVER_URL` if you need to.

## Preview, which is the default

Planning a call is always safe — `plan_call` has no side effects, so `npm run cli -- plan` never
needs a flag to make it safe to run:

```bash
npm run cli -- plan --to +12125550123 --region US --goal "Confirm the rescheduled appointment and capture the new date."
```

Placing the call is the one command with a real side effect, and it refuses to dial unless you say
so explicitly:

```bash
npm run cli -- call --plan-id <id-from-plan> --confirm-token <token-from-plan>
# → "Preview only (default). Would call run_call with plan_id=... Pass --live to actually place the call."

npm run cli -- call --plan-id <id-from-plan> --confirm-token <token-from-plan> --live
# → places the real call
```

## One live run

Once you have a transcript — from `npm run cli -- status --run-id <id>` after a real call settles,
or from your own recording pipeline — extract a real structured result through Bedrock instead of
the fake provider:

```bash
npm run cli -- extract --transcript-file my-call.txt --schema appointment-confirmation --provider bedrock --region us-east-1
```

The bundled `appointment-confirmation` schema is there to make the demo and CLI runnable
end-to-end; for your own use case, import `extractStructuredResult()` and pass your own Zod
schema and system prompt directly — see [`src/extract-from-transcript.ts`](src/extract-from-transcript.ts).
This is a reference implementation, not a general-purpose CLI product.

## From an agent

```ts
import { z } from "zod";
import { extractStructuredResult, DEFAULT_EXTRACTION_SYSTEM_PROMPT } from "calle-mcp-result-extractor/src/extract-from-transcript.js";
import { BedrockReasoningProvider } from "calle-mcp-result-extractor/src/reasoning/bedrock.js";
import { getCallRun, resolveCalleMcpConfig } from "calle-mcp-result-extractor/src/calle-mcp.js";

const config = resolveCalleMcpConfig();
const run = await getCallRun(config, runId); // however you got runId from your MCP host

const schema = z.object({ confirmed: z.boolean(), newDate: z.string().nullable() });
const result = await extractStructuredResult(new BedrockReasoningProvider(), {
  task: "confirm-appointment",
  systemPrompt: DEFAULT_EXTRACTION_SYSTEM_PROMPT,
  transcript: run.result!.transcript!,
  questionsToResolve: ["Did they confirm? What's the new date?"],
  schema,
});
```

Swap `BedrockReasoningProvider` for your own `ReasoningProvider` implementation
(`src/reasoning/types.ts`) if you're not on Bedrock — the extraction logic doesn't care which
model answered, only that the answer validates against your schema.

## Exit codes

The CLI exits `1` on any error (invalid arguments, an MCP auth failure, a schema that never
validates after retries) and `0` on success. Errors are printed to stderr; results to stdout, so
`npm run cli -- extract ... > result.json` works as expected.

## What blocks a live call

- **No CALL-E session.** `plan` and `call` fail with a message pointing you at
  `npx @call-e/cli auth login` rather than a raw MCP error.
- **Plan not ready to run.** `plan_call` can come back with `ready_to_run: false` and clarifying
  questions instead of a `confirm_token` — there is no path to `call` without a valid token from a
  plan that was actually ready.
- **Missing `--live`.** `call` without `--live` never reaches `run_call`.
- **Extraction never validates.** `BedrockReasoningProvider` retries once with the validation
  error fed back to the model, then throws a `ReasoningValidationError` naming the task and the
  exact Zod issues — it never silently returns malformed data.

## Side effects, cancellation, credentials

- **Side effects.** `plan_call` and `get_call_run` (via `status`) have none. `run_call` places a
  real outbound phone call — the one operation in this tool with a real-world effect, and it's
  gated behind `--live` as described above.
- **Cancellation.** CALL-E's MCP surface exposes no cancel-in-flight operation for a call that's
  already dialing. There is nothing recurring here to disable — every call is a single planned,
  confirmed, one-shot run.
- **Credentials.** CALL-E auth comes entirely from `@call-e/cli`'s token cache; this tool never
  reads, stores, or logs a token itself. AWS credentials for Bedrock come from the default SDK
  credential chain — never a hardcoded key. No secrets appear in any file in this directory.
- **Phone numbers.** The bundled example uses a NANP-reserved fictional number
  (`+1 212 555 0123`, the `555-01xx` block set aside for fiction). Mask real phone numbers in any
  transcript or log you share.

## Reading further

- [`docs/bedrock-tool-result-retry.md`](docs/bedrock-tool-result-retry.md) — the specific Converse
  API constraint that makes naive retry-with-feedback fail, and the fix.
- [`src/calle-mcp.ts`](src/calle-mcp.ts) — the typed `plan_call` / `run_call` / `get_call_run`
  wrapper over `@call-e/core`.
- [`src/extract-from-transcript.ts`](src/extract-from-transcript.ts) — the extraction function
  itself, provider-agnostic.
