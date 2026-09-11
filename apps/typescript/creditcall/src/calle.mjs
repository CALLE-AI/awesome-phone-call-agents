import { spawn } from "node:child_process";
import path from "node:path";

function calleBinary() {
  return process.env.CALLE_BIN || path.join(process.cwd(), "node_modules", ".bin", "calle");
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(calleBinary(), [...args, "--json", "--no-telemetry"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `CALL-E exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`CALL-E returned invalid JSON: ${stdout.slice(0, 500)}`));
      }
    });
  });
}

export function planCall({ phone, region, language, goal }) {
  return runCli([
    "mcp",
    "call",
    "plan_call",
    "--args-json",
    JSON.stringify({
      to_phones: [phone],
      region,
      language,
      goal,
      user_input: goal,
      ttl_seconds: 86400,
    }),
  ]);
}

export function runCall({ planId, confirmToken }) {
  return runCli(["call", "run", "--plan-id", planId, "--confirm-token", confirmToken]);
}

export function getCallRun(runId) {
  return runCli([
    "mcp",
    "call",
    "get_call_run",
    "--args-json",
    JSON.stringify({ run_id: runId }),
  ]);
}

export function recoverCall(recoveryId) {
  return runCli(["call", "recover", "--recovery-id", recoveryId]);
}
