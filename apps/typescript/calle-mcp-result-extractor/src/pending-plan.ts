import { homedir } from "node:os";
import { join } from "node:path";
import { ensurePrivateDir, readJson, removeFile, writePrivateJson } from "@call-e/core/cache";

/**
 * `plan_call`'s `confirm_token` authorizes an actual outbound phone call —
 * it must never be a CLI argument (shell history, `ps`, shoulder-surfing) or
 * printed to a terminal (scrollback, screen recordings, copy-pasted logs).
 * `plan` writes it here instead, using @call-e/core's own private-file
 * helpers (the same ones the CLI's own token cache uses), and `call` reads
 * it back — nothing about the token ever needs to be typed or displayed.
 */

export interface PendingPlan {
  planId: string;
  confirmToken: string;
  toPhones: string[];
  region: string;
  goal: string;
  createdAt: string;
}

function pendingPlanPath(): string {
  // Overridable so tests never touch the developer's real ~/.calle-mcp.
  const dir =
    process.env.CALLE_MCP_APP_STATE_DIR ??
    join(homedir(), ".calle-mcp", "apps", "calle-mcp-result-extractor");
  ensurePrivateDir(dir);
  return join(dir, "pending-plan.json");
}

export function savePendingPlan(plan: PendingPlan): void {
  writePrivateJson(pendingPlanPath(), plan);
}

export function loadPendingPlan(): PendingPlan | null {
  return readJson<PendingPlan>(pendingPlanPath());
}

export function clearPendingPlan(): void {
  removeFile(pendingPlanPath());
}

/**
 * Reads a confirm_token piped on stdin (e.g. `some-vault get token | node
 * cli.js call --live`), for callers who would rather not touch disk at all.
 * Returns null immediately if stdin is a TTY (interactive) rather than
 * blocking on input the user never intended to provide.
 */
export async function readConfirmTokenFromStdin(): Promise<string | null> {
  if (process.stdin.isTTY) {
    return null;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text.length > 0 ? text : null;
}
