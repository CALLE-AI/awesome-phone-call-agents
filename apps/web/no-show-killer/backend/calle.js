import dotenv from 'dotenv';
dotenv.config();
import { execFile } from 'child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the CLI by path instead of relying on `calle` being on $PATH.
// `@call-e/cli` is a regular dependency (see package.json), so this works
// the same way locally and on Railway regardless of how the start script
// sets up PATH.
const CALLE_BIN = path.join(
  __dirname,
  "node_modules",
  "@call-e",
  "cli",
  "bin",
  "calle.js"
);

// Defaults, overridable per-call or via env vars.
const DEFAULT_REGION = process.env.CALLE_REGION || null;
const DEFAULT_TIMEOUT_SECONDS = process.env.CALLE_TIMEOUT_SECONDS || null;

// Dry-run mode: ON by default. While it's on, startCall()/callStatus() never
// shell out to the real `calle` CLI - no phone ever actually rings. Instead
// they return a synthetic response in the same shape a real call produces,
// so the rest of the app (status polling, the UI, appointments.json) still
// exercises its real code paths. Set DRY_RUN=false once you're ready to place
// real calls - see README "Go live with real calls".
const DRY_RUN = process.env.DRY_RUN !== "false";

function fakeRunId() {
  return `dryrun_${Math.random().toString(36).slice(2, 10)}`;
}

function fakeStructuredContent(toPhone, goal) {
  return {
    status: "COMPLETED",
    activity: [
      {
        ts: new Date().toISOString(),
        level: "info",
        kind: "dry_run",
        message: `[DRY RUN] Would call ${toPhone} with goal: "${goal}". No real call was placed.`,
        data: {},
      },
    ],
    result: {
      post_summary:
        "[DRY RUN] Simulated confirmation - no real call was placed. Set DRY_RUN=false to place real calls.",
      transcript: null,
    },
  };
}

// Where the CLI reads/writes its OAuth token cache. Must point at a
// persistent path (e.g. a mounted Railway volume) in production - a
// container's default $HOME is wiped on every redeploy, which is what was
// breaking auth. See README/deploy notes for the one-time login step that
// populates this path.
const CACHE_ROOT = process.env.CALLE_CACHE_ROOT || null;

function runCalle(args) {
  const finalArgs = CACHE_ROOT
    ? [...args, "--cache-root", CACHE_ROOT, "--json"]
    : [...args, "--json"];

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath, // node
      [CALLE_BIN, ...finalArgs],
      {
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          reject(new Error(stderr || err.message));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Failed to parse calle output: ${stdout}`));
        }
      }
    );
  });
}

export function authStatus() {
  return runCalle(["auth", "status"]);
}

// Plans and starts a call in one step. Response shape (per calle CLI docs):
// { ok, run_id, status_result: { structuredContent: { status, activity, ... } } }
//
// region / timeoutSeconds default to CALLE_REGION / CALLE_TIMEOUT_SECONDS env
// vars when not passed explicitly, so you can tune them without code changes.
export function startCall({ toPhone, goal, region, timeoutSeconds }) {
  if (DRY_RUN) {
    console.log(`[dry-run] would call ${toPhone} - goal: "${goal}"`);
    return Promise.resolve({
      ok: true,
      run_id: fakeRunId(),
      status_result: { structuredContent: fakeStructuredContent(toPhone, goal) },
    });
  }

  const args = ["call", "start", "--to-phone", toPhone, "--goal", goal];

  const resolvedRegion = region ?? DEFAULT_REGION;
  if (resolvedRegion) {
    args.push("--region", resolvedRegion);
  }

  const resolvedTimeout = timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  if (resolvedTimeout) {
    args.push("--timeout-seconds", String(resolvedTimeout));
  }

  return runCalle(args);
}

// Response shape: { ok, result: { structuredContent: { status, activity, ... } } }
export function callStatus({ runId }) {
  if (DRY_RUN || runId.startsWith("dryrun_")) {
    return Promise.resolve({
      ok: true,
      result: { structuredContent: fakeStructuredContent("(dry run)", "(dry run)") },
    });
  }
  return runCalle(["call", "status", "--run-id", runId]);
}

export { DRY_RUN };