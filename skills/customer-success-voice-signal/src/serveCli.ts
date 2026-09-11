#!/usr/bin/env node
/**
 * Stage Manager HTTP cue listener.
 * POST /cue → runSignal (same path as --stdin). Default: dress rehearsal.
 * Curtain-up via HTTP requires CUE_ALLOW_LIVE=1 (webhook cannot arm itself).
 */
import { loadDotEnv, readSkillEnv } from "./config/env.js";
import { assertCueBindAllowed, listenCueServer } from "./http/cueServer.js";

function printHelp(): void {
  console.log(`
Stage Manager — HTTP cue listener

Usage:
  npm run serve-cue -- [--host 127.0.0.1] [--port 8787]

Endpoints:
  GET  /health   Liveness (includes live_armed)
  POST /cue      JSON account cue → same engine as --stdin

Default: dress rehearsal. A webhook can never escalate itself to a phone call.

Live curtain-up (operator-armed only):
  1. Set CUE_ALLOW_LIVE=1 in .env (separate from CLI PLACES)
  2. Then POST /cue?live=1&confirm=PLACES
  Still needs CALLE_API_KEY + CS_OWNER_E164 + PLACES semantics.

Auth / bind:
  Loopback (127.0.0.1) — secret optional for local demos
  Non-loopback (--host 0.0.0.0) — requires CUE_WEBHOOK_SECRET
  Authorization: Bearer <secret>  or  X-Cue-Secret: <secret>

Demo (dress rehearsal, no CALL-E key):
  npm run serve-cue &
  curl -sS -X POST http://127.0.0.1:8787/cue \\
    -H 'content-type: application/json' \\
    -d @events/webhook_stuck_support.json

Exit: Ctrl+C. Same HOLD / failure policy as the CLI.
`);
}

function parseServeArgs(argv: string[]): {
  host: string;
  port: number;
  help: boolean;
} {
  let host = process.env.CUE_HOST?.trim() || "127.0.0.1";
  let port = Number(process.env.CUE_PORT ?? "8787") || 8787;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    if (a === "--host") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --host");
      host = v;
      continue;
    }
    if (a.startsWith("--host=")) {
      host = a.slice("--host=".length);
      continue;
    }
    if (a === "--port") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --port");
      port = Number(v);
      if (!Number.isFinite(port) || port <= 0) throw new Error(`Bad --port: ${v}`);
      continue;
    }
    if (a.startsWith("--port=")) {
      port = Number(a.slice("--port=".length));
      if (!Number.isFinite(port) || port <= 0) throw new Error(`Bad --port: ${a}`);
      continue;
    }
    throw new Error(`Unknown option: ${a}`);
  }

  return { host, port, help };
}

function envFlagTrue(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

async function main(): Promise<void> {
  loadDotEnv();
  let args;
  try {
    args = parseServeArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Failure: ${err instanceof Error ? err.message : String(err)}`);
    printHelp();
    process.exit(3);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const env = readSkillEnv();
  const secret = process.env.CUE_WEBHOOK_SECRET?.trim() || undefined;
  const allowLive = envFlagTrue(process.env.CUE_ALLOW_LIVE);

  try {
    assertCueBindAllowed(args.host, secret);
  } catch (err) {
    console.error(`Failure: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(3);
  }

  const { server } = await listenCueServer({
    env,
    host: args.host,
    port: args.port,
    secret,
    allowLive,
    log: (msg) => console.log(msg),
  });

  const shutdown = () => {
    console.log("\nHouse lights — cue listener closing.");
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(`Failure: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
});
