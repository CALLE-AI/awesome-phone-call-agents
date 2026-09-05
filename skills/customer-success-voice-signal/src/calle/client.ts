import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CalleClient, type Call } from "@call-e/calle";
import type { CallIntent } from "../schemas.js";

export interface CurtainUpConfig {
  apiKey: string;
  baseUrl?: string;
  region?: string;
  locale?: string;
  /** Persist open call ids here so a crash after dial still has call.id */
  dataDir?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  intervalMs?: number;
  /**
   * Optional CALL-E completion webhook (CreateCallInput.webhookUrl).
   * Terminal results are also POSTed here. We still default to create →
   * persist id → waitForResult (crash-safe) unless wait=false.
   */
  webhookUrl?: string;
  /**
   * When false and webhookUrl is set, return after create (async path).
   * Default true — keep blocking wait for CLI curtain-up.
   */
  wait?: boolean;
  /** Optional progress hook (e.g. listEvents narration for demos). */
  onStatus?: (msg: string) => void;
}

export interface CurtainUpResult {
  call: Call;
  structured: Record<string, unknown> | null;
  /** False when returned after create without waitForResult (async webhook path). */
  awaited: boolean;
}

async function persistOpenCall(
  dataDir: string | undefined,
  callId: string,
  intent: CallIntent,
): Promise<void> {
  if (!dataDir) return;
  const dir = path.join(dataDir, "open-calls");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${callId}.json`);
  await writeFile(
    file,
    JSON.stringify(
      {
        call_id: callId,
        at: new Date().toISOString(),
        trigger_id: intent.trigger_id,
        account_id: intent.account_id,
        cs_owner_id: intent.cs_owner_id,
        event_id: intent.metadata?.event_id ?? null,
        stage_code: intent.metadata?.stage_code ?? null,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function defaultIdempotencyKey(intent: CallIntent): string {
  const eventId =
    typeof intent.metadata?.event_id === "string" ? intent.metadata.event_id : "noevt";
  return `csvs:${intent.trigger_id}:${intent.account_id}:${eventId}`;
}

function structuredFromCall(call: Call): Record<string, unknown> | null {
  return (
    (call.structuredResult as Record<string, unknown> | null) ??
    (call.recipients[0]?.structuredResult as Record<string, unknown> | null) ??
    null
  );
}

/**
 * Curtain-up: create → persist call.id → waitForResult.
 * Deliberately not createAndWait — crash after dial still has call.id on disk.
 * Dress rehearsal must never invoke this.
 */
export async function curtainUp(
  intent: CallIntent,
  config: CurtainUpConfig,
): Promise<CurtainUpResult> {
  if (!config.apiKey) {
    throw new Error("CALLE_API_KEY is required for curtain-up.");
  }

  const client = new CalleClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  const idempotencyKey = config.idempotencyKey ?? defaultIdempotencyKey(intent);
  const webhookUrl = config.webhookUrl?.trim() || undefined;
  const shouldWait = config.wait !== false;

  const payload: {
    task: string;
    recipients: Array<{ phones: string[]; region: string; locale: string }>;
    resultSchema: Record<string, unknown>;
    metadata: Record<string, unknown>;
    webhookUrl?: string;
  } = {
    task: intent.task,
    recipients: [
      {
        phones: [intent.callee_e164],
        region: config.region ?? "US",
        locale: config.locale ?? "en-US",
      },
    ],
    resultSchema: intent.result_schema,
    metadata: {
      skill: "customer-success-voice-signal",
      persona: "Stage Manager",
      trigger_id: intent.trigger_id,
      account_id: intent.account_id,
      cs_owner_id: intent.cs_owner_id,
      never_call_customer: true,
      stage_code: intent.metadata?.stage_code ?? null,
      ...intent.metadata,
    },
  };
  if (webhookUrl) {
    payload.webhookUrl = webhookUrl;
  }

  config.onStatus?.(`Creating CALL-E run (idempotency ${idempotencyKey.slice(0, 24)}…).`);
  if (webhookUrl) {
    config.onStatus?.(
      shouldWait
        ? `webhookUrl set — still waiting (create→persist→wait; crash-safe).`
        : `webhookUrl set — async path (no waitForResult); completion via webhook.`,
    );
  }

  const created = await client.calls.create(payload, { idempotencyKey });
  await persistOpenCall(config.dataDir, created.id, intent);
  config.onStatus?.(
    shouldWait
      ? `Call id persisted: ${created.id} — waiting for result.`
      : `Call id persisted: ${created.id} — not waiting (async webhook).`,
  );

  if (!shouldWait) {
    return {
      call: created,
      structured: structuredFromCall(created),
      awaited: false,
    };
  }

  let call: Call;
  try {
    // Best-effort status narration; never block the wait path on listEvents failure.
    if (config.onStatus) {
      try {
        const events = await client.calls.listEvents(created.id, { limit: 5 });
        const kinds = events.data
          .map((e) => ("type" in e ? String((e as { type?: string }).type) : "event"))
          .slice(0, 3);
        if (kinds.length) config.onStatus(`Recent events: ${kinds.join(", ")}`);
      } catch {
        /* ignore */
      }
    }
    call = await client.calls.waitForResult(created.id, {
      timeoutMs: config.timeoutMs ?? 600_000,
      intervalMs: config.intervalMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Curtain-up wait failed for ${created.id} (id persisted under data/open-calls/). ${msg}`,
    );
  }

  return { call, structured: structuredFromCall(call), awaited: true };
}

/**
 * Fetch an existing CALL-E run (crash recovery / remap). Does not place a call.
 */
export async function fetchCallResult(
  callId: string,
  config: Pick<CurtainUpConfig, "apiKey" | "baseUrl">,
): Promise<CurtainUpResult> {
  if (!config.apiKey) {
    throw new Error("CALLE_API_KEY is required to fetch a call.");
  }
  const id = callId.trim();
  if (!id) {
    throw new Error("call id is required.");
  }
  const client = new CalleClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
  const call = await client.calls.get(id);
  return { call, structured: structuredFromCall(call), awaited: true };
}
