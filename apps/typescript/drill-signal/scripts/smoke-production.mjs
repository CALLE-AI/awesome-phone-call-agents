/**
 * Cross-platform production smoke test for compiled dist/server.js.
 * Requires `npm run build` first. Self-terminates; no background shell syntax.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverJs = join(root, "dist", "server.js");

function fail(message) {
  console.error(`smoke:production failed: ${message}`);
  process.exitCode = 1;
}

function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth(baseUrl, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return response.json();
      }
    } catch {
      // Retry while the child process boots.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`health check did not succeed at ${baseUrl}/api/health`);
}

function terminateChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once("exit", () => resolve(child.exitCode ?? 0));
    child.kill();
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 2000);
  });
}

if (!existsSync(serverJs)) {
  fail("dist/server.js not found — run npm run build first");
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "drill-smoke-prod-"));
let child;
let exitCode = 0;
let stderr = "";

try {
  const port = await getEphemeralPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  child = spawn(process.execPath, [serverJs], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DRILL_SIGNAL_BIND_HOST: "127.0.0.1",
      DRILL_SIGNAL_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const health = await waitForHealth(baseUrl);
  if (!health?.ok || health.defaultMode !== "simulation") {
    throw new Error(`unexpected /api/health payload: ${JSON.stringify(health)}`);
  }

  const indexRes = await fetch(`${baseUrl}/`);
  if (!indexRes.ok) {
    throw new Error(`GET / returned ${indexRes.status}`);
  }
  const indexHtml = await indexRes.text();
  if (!indexHtml.includes("DrillSignal")) {
    throw new Error("GET / did not return DrillSignal UI HTML");
  }

  const assetRes = await fetch(`${baseUrl}/favicon.svg`);
  if (!assetRes.ok) {
    throw new Error(`GET /favicon.svg returned ${assetRes.status}`);
  }

  console.log(
    `smoke:production ok | health=${JSON.stringify(health)} | index=200 | favicon=${assetRes.status}`,
  );
} catch (error) {
  exitCode = 1;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`smoke:production failed: ${message}`);
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
} finally {
  if (child) {
    await terminateChild(child);
  }
  rmSync(dataDir, { recursive: true, force: true });
}

process.exitCode = exitCode;
