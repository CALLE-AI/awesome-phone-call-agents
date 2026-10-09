import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function waitForHealth(base: string, child: ChildProcess) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Ops server exited before health check (${child.exitCode})`);
    }
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return response.json() as Promise<Record<string, unknown>>;
    } catch {
      // The listener may not be bound yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Ops server health check timed out");
}

async function requestJson(
  base: string,
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: Record<string, any> }> {
  const response = await fetch(`${base}${path}`, init);
  const body = (await response.json()) as Record<string, any>;
  return { response, body };
}

const root = resolve(import.meta.dirname, "../..");
const temp = mkdtempSync(join(tmpdir(), "continuum-call-http-"));
const database = join(temp, "contract.sqlite");
const token = "http-contract-token";
const session = "http-contract-session";
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  CONTINUUM_DB: database,
  OPS_TOKEN: token,
  SPIKE_LIVE: "0",
};
delete environment.SPIKE_STOP;

let childOutput = "";
let port = await freePort();
let base = `http://127.0.0.1:${port}`;

function launchServer(): ChildProcess {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/server/http.ts"],
    {
      cwd: root,
      env: { ...environment, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (chunk) => {
    childOutput = (childOutput + String(chunk)).slice(-4_000);
  });
  child.stderr?.on("data", (chunk) => {
    childOutput = (childOutput + String(chunk)).slice(-4_000);
  });
  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await Promise.race([
    exited,
    new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
  ]);
}

let child = launchServer();

const authHeaders = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "x-session-key": session,
};

try {
  const health = await waitForHealth(base, child);
  assert(health.ok === true, "health must report ok");
  assert(health.mode === "mock", "HTTP proof server must stay mock-only");
  assert(health.live_calls === 0, "HTTP proof server must report zero live calls");

  const unauthorized = await requestJson(base, "/api/proof", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "cross_party" }),
  });
  assert(unauthorized.response.status === 401, "mutating route must require auth");

  const handoff = await requestJson(base, "/api/proof", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ kind: "cross_party" }),
  });
  assert(handoff.response.ok, "cross-party HTTP proof must succeed");
  assert(handoff.body.mode === "mock", "cross-party proof must remain mock-only");
  assert(handoff.body.live_calls === 0, "cross-party proof must place zero live calls");
  assert(handoff.body.verify?.ok === true, "cross-party Evidence Pack must verify");
  assert(handoff.body.handoff?.source_run_id, "handoff must expose source provenance");
  assert(handoff.body.handoff?.used_by_run_id, "handoff must expose consuming run");

  const crash = await requestJson(base, "/api/crash-runtime", {
    method: "POST",
    headers: authHeaders,
    body: "{}",
  });
  assert(crash.response.ok, "crash-runtime HTTP proof must succeed");
  assert(crash.body.stuck_intents === 1, "fault must leave one durable stuck intent");
  assert(
    crash.body.ledger?.some(
      (row: Record<string, unknown>) =>
        row.state === "dispatching" && row.provider_run_id === null,
    ),
    "crash proof must expose accepted-before-persist window",
  );

  // Destroy the entire Node process, then prove a fresh process can rebuild
  // the stuck mission from SQLite before reconciliation.
  await stopServer(child);
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = launchServer();
  const restartedHealth = await waitForHealth(base, child);
  assert(restartedHealth.ok === true, "restarted server must become healthy");
  const emptyMemory = await requestJson(base, "/api/mission");
  assert(
    emptyMemory.body.empty === true,
    "fresh process must begin without an in-memory demo session",
  );
  const reloaded = await requestJson(base, "/api/reload", {
    method: "POST",
    headers: authHeaders,
    body: "{}",
  });
  assert(reloaded.response.ok, "fresh process must reload the SQLite mission");
  assert(reloaded.body.mission_id === crash.body.mission_id, "reload must keep mission id");
  assert(reloaded.body.stuck_intents === 1, "reload must preserve the stuck intent");

  const reconcile = await requestJson(base, "/api/reconcile", {
    method: "POST",
    headers: authHeaders,
    body: "{}",
  });
  assert(reconcile.response.ok, "reconcile HTTP route must succeed");
  assert(reconcile.body.stuck_intents === 0, "reconcile must clear the stuck intent");
  assert(reconcile.body.verify?.ok === true, "reconciled Evidence Pack must verify");
  assert(
    reconcile.body.ledger?.every(
      (row: Record<string, unknown>) => Number(row.provider_runs) <= 1,
    ),
    "HTTP ledger must keep at most one provider run per intent",
  );

  const evidence = await fetch(`${base}/api/evidence`);
  assert(evidence.ok, "evidence export must be downloadable");
  assert(
    evidence.headers.get("content-disposition")?.includes("attachment"),
    "evidence export must be an attachment",
  );
  const pack = (await evidence.json()) as Record<string, unknown>;
  assert(Array.isArray(pack.events), "evidence export must contain events");

  const tamper = await requestJson(base, "/api/evidence/tamper", {
    method: "POST",
    headers: authHeaders,
    body: "{}",
  });
  assert(tamper.response.ok, "tamper demonstration route must respond");
  assert(tamper.body.verification?.ok === false, "tampered evidence must fail closed");

  const page = await fetch(base);
  assert(page.ok, "Ops Console shell must be served");
  assert((await page.text()).includes("Continuum Call"), "Ops shell must identify app");

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "mock",
        live_calls: 0,
        http_checks: 11,
        proofs: [
          "auth_required",
          "cross_party_provenance",
          "durable_crash_window",
          "process_restart_from_sqlite",
          "same_intent_reconcile",
          "evidence_download",
          "tamper_fail_closed",
          "static_shell",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (childOutput) console.error(childOutput);
  throw error;
} finally {
  await stopServer(child);
  rmSync(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}
