import type { Call } from "@call-e/calle";
import type { SundialCallRecord } from "../types.ts";
import { fetchLiveCalleCall } from "./live-binding.ts";
import { applyCalleSnapshot } from "./sync-live.ts";

export type WebhookStore = {
  peekCalls(): SundialCallRecord[];
  saveCall(call: SundialCallRecord): void;
};

export type WebhookIngestResult =
  | { ok: true; call: SundialCallRecord }
  | { ok: false; status: 400 | 401 | 404; message: string };

/** Only the CALL-E / Sundials id is read. Transcript, recording, and dossier fields are ignored. */
export function webhookLookupId(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const body = payload as Record<string, unknown>;
  const raw = body.callId ?? body.id;
  return typeof raw === "string" ? raw.trim() : "";
}

export function findCallForCalleWebhook(store: WebhookStore, callId: string): SundialCallRecord | undefined {
  if (!callId) return undefined;
  const calls = store.peekCalls();
  const byCalleId = calls.find((call) => call.calleCallId === callId);
  if (byCalleId) return byCalleId;
  return calls.find((call) => call.id === callId && Boolean(call.calleCallId));
}

export async function ingestCalleWebhook(
  store: WebhookStore,
  payload: unknown,
  fetchRemote: (calleCallId: string) => Promise<Call | null> = fetchLiveCalleCall
): Promise<WebhookIngestResult> {
  const callId = webhookLookupId(payload);
  if (!callId) {
    return { ok: false, status: 400, message: "callId is required" };
  }

  const existing = findCallForCalleWebhook(store, callId);
  if (!existing?.calleCallId) {
    return { ok: false, status: 404, message: "Call not found" };
  }

  const remote = await fetchRemote(existing.calleCallId);
  if (!remote || remote.id !== existing.calleCallId) {
    return { ok: false, status: 401, message: "CALL-E call could not be verified." };
  }

  const next = applyCalleSnapshot(existing, remote);
  store.saveCall(next);
  return { ok: true, call: next };
}
