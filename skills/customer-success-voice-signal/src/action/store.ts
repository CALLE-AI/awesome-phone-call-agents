import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ActionIntentSchema,
  ActionReceiptSchema,
  type ActionIntent,
  type ActionReceipt,
} from "./types.js";

export function actionPaths(dataDir: string) {
  return {
    pendingDir: path.join(dataDir, "actions", "pending"),
    executedDir: path.join(dataDir, "actions", "executed"),
  };
}

async function ensureDirs(dataDir: string): Promise<void> {
  const p = actionPaths(dataDir);
  await mkdir(p.pendingDir, { recursive: true });
  await mkdir(p.executedDir, { recursive: true });
}

export function pendingIntentPath(dataDir: string, intentId: string): string {
  return path.join(actionPaths(dataDir).pendingDir, `${intentId}.json`);
}

/** Persist a pending action intent (decision → system handoff). */
export async function writeActionIntent(
  dataDir: string,
  intent: ActionIntent,
): Promise<string> {
  await ensureDirs(dataDir);
  const file = pendingIntentPath(dataDir, intent.intent_id);
  await writeFile(file, `${JSON.stringify(intent, null, 2)}\n`, "utf8");
  return file;
}

export async function listPendingIntents(dataDir: string): Promise<ActionIntent[]> {
  const { pendingDir } = actionPaths(dataDir);
  await mkdir(pendingDir, { recursive: true });
  const files = (await readdir(pendingDir))
    .filter((f) => f.endsWith(".json"))
    .sort();
  const out: ActionIntent[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(await readFile(path.join(pendingDir, f), "utf8"));
      out.push(ActionIntentSchema.parse(raw));
    } catch {
      // skip bad files
    }
  }
  return out;
}

/** Most recent pending intent by `at` timestamp. */
export async function loadLastPendingIntent(
  dataDir: string,
): Promise<{ intent: ActionIntent; file: string } | null> {
  const intents = await listPendingIntents(dataDir);
  if (!intents.length) return null;
  intents.sort((a, b) => (a.at < b.at ? 1 : -1));
  const intent = intents[0];
  return { intent, file: pendingIntentPath(dataDir, intent.intent_id) };
}

export async function loadPendingIntentById(
  dataDir: string,
  intentId: string,
): Promise<{ intent: ActionIntent; file: string } | null> {
  const file = pendingIntentPath(dataDir, intentId);
  try {
    const raw = JSON.parse(await readFile(file, "utf8"));
    return { intent: ActionIntentSchema.parse(raw), file };
  } catch {
    return null;
  }
}

/**
 * Apply (or dry-run) a pending action intent.
 * Default: local receipt only. `sent` is unused by the CLI (live Slack/GitHub
 * send is out of MVP); kept so unit tests can record a hypothetical post.
 */
export async function applyActionIntent(args: {
  dataDir: string;
  intent: ActionIntent;
  file: string;
  dryRun: boolean;
  sent?: {
    effect: "slack_webhook_posted" | "github_comment_posted";
    detail: string;
  };
}): Promise<{ receipt: ActionReceipt; receiptPath: string; intentPath: string }> {
  await ensureDirs(args.dataDir);
  const now = new Date().toISOString();
  const receipt_id = `rcpt_${args.intent.intent_id}_${Date.now()}`;

  if (args.dryRun) {
    const updated: ActionIntent = {
      ...args.intent,
      status: "dry_run_printed",
    };
    await writeFile(args.file, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    const receipt = ActionReceiptSchema.parse({
      receipt_id,
      at: now,
      intent_id: args.intent.intent_id,
      dry_run: true,
      effect: "local_receipt",
      summary: `DRY-RUN: would ${args.intent.action} via ${args.intent.adapter} for ${args.intent.account_name} (${args.intent.account_id}). No external system called.`,
      intent: updated,
    });
    const receiptPath = path.join(
      actionPaths(args.dataDir).executedDir,
      `${receipt_id}.dry-run.json`,
    );
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    return { receipt, receiptPath, intentPath: args.file };
  }

  const executed: ActionIntent = {
    ...args.intent,
    status: "executed_local",
  };
  const intentPath = path.join(
    actionPaths(args.dataDir).executedDir,
    `${args.intent.intent_id}.json`,
  );
  await writeFile(intentPath, `${JSON.stringify(executed, null, 2)}\n`, "utf8");
  await unlink(args.file).catch(() => undefined);

  const receipt = ActionReceiptSchema.parse({
    receipt_id,
    at: now,
    intent_id: args.intent.intent_id,
    dry_run: false,
    effect: args.sent?.effect ?? "local_receipt",
    summary: args.sent
      ? `SENT via ${args.sent.effect}: ${args.intent.action} for ${args.intent.account_name} (${args.sent.detail}).`
      : `LOCAL EXECUTE: recorded ${args.intent.action} for ${args.intent.account_name}. Adapter ${args.intent.adapter} not called — POC receipt only.`,
    intent: executed,
  });
  const receiptPath = path.join(
    actionPaths(args.dataDir).executedDir,
    `${receipt_id}.json`,
  );
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return { receipt, receiptPath, intentPath };
}
