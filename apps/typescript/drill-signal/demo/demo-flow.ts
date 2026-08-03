/**
 * Local demo flow — simulation-only primary-unavailable-backup-success exercise.
 */

import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DrillRecord } from "../src/types.js";

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(port);
    });
  });
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function postJson(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function runHttpFlow(port: number): Promise<DrillRecord> {
  const base = `http://127.0.0.1:${port}`;

  const createRes = await postJson(base, "/api/drills", {
    primaryLabel: "Primary On-Call",
    primaryPhone: "+15550100002",
    primaryConsented: true,
    backupLabel: "Backup On-Call",
    backupPhone: "+15550100003",
    backupConsented: true,
    simulationPreset: "primary-unavailable-backup-success",
    mode: "simulation",
  });
  if (!createRes.ok) {
    throw new Error(`create drill failed: ${createRes.status} ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as DrillRecord;

  const ackRes = await postJson(base, `/api/drills/${created.id}/preview`, {
    operatorConfirmedDrillPurpose: true,
    maxCallsDisclosed: true,
  });
  if (!ackRes.ok) {
    throw new Error(`preview ack failed: ${ackRes.status} ${await ackRes.text()}`);
  }

  const launchRes = await postJson(base, `/api/drills/${created.id}/launch`, {
    launchConfirmed: true,
  });
  if (!launchRes.ok) {
    throw new Error(`launch failed: ${launchRes.status} ${await launchRes.text()}`);
  }
  return (await launchRes.json()) as DrillRecord;
}

export function formatAfterAction(drill: DrillRecord): string {
  const attempts = drill.attempts.map((attempt) => `${attempt.role}@${attempt.phoneMasked}:${attempt.outcome}`).join(", ");
  const summary = drill.report?.summary ?? "No after-action report.";
  return `After-action | status=${drill.status} | attempts=[${attempts}] | ${summary}`;
}

export async function runLocalDemo(): Promise<DrillRecord> {
  const dataDir = mkdtempSync(join(tmpdir(), "drill-signal-demo-"));
  process.env.DRILL_SIGNAL_DATA_DIR = dataDir;

  let server: Server | undefined;
  try {
    const { createAppServer } = await import("../src/server.js");
    server = createAppServer();
    const port = await listen(server);

    console.log(`DrillSignal demo ready at http://127.0.0.1:${port}`);
    console.log("Default mode is simulation — no network calls are made.");

    const finished = await runHttpFlow(port);
    console.log(formatAfterAction(finished));
    console.log("No live call was placed (simulation mode).");
    return finished;
  } finally {
    await closeServer(server);
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup for ephemeral demo data.
    }
    delete process.env.DRILL_SIGNAL_DATA_DIR;
  }
}
