import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FollowUpDraft } from "@/lib/follow-up";

const QUEUE_KEY = "call-aunty/sync-queue";
const SYNC_META_KEY = "call-aunty/sync-meta";

async function readQueueRaw(): Promise<string | null> {
  return Platform.OS === "web" ? AsyncStorage.getItem(QUEUE_KEY) : SecureStore.getItemAsync(QUEUE_KEY);
}

export function isValidSyncQueueItem(item: unknown): item is SyncQueueItem {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<SyncQueueItem>;
  return typeof candidate.id === "string" && candidate.kind === "follow_up" && candidate.payload?.status === "completed" && ["queued", "retrying", "synced"].includes(candidate.status ?? "");
}

export function parseSyncQueueRaw(raw: string | null): SyncQueueItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isValidSyncQueueItem) : [];
  } catch {
    return [];
  }
}

async function readQueueItemsStrict(): Promise<SyncQueueItem[]> {
  try {
    return parseSyncQueueRaw(await readQueueRaw());
  } catch {
    return [];
  }
}

async function writeQueueRaw(value: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      await AsyncStorage.setItem(QUEUE_KEY, value);
      return;
    }
    await SecureStore.setItemAsync(QUEUE_KEY, value, { requireAuthentication: false });
  } catch (error) {
    throw error instanceof Error ? error : new Error("Failed to save sync queue");
  }
}

export type SyncQueueItem = {
  id: string;
  kind: "follow_up";
  payload: FollowUpDraft;
  status: "queued" | "retrying" | "synced";
  attempts: number;
  createdAt: string;
  updatedAt: string;
};

function stableId(followUp: FollowUpDraft) {
  return `follow-up:${followUp.womanId}`;
}

export async function enqueueFollowUp(followUp: FollowUpDraft): Promise<SyncQueueItem[]> {
  const current = await readQueueItemsStrict();
  const now = new Date().toISOString();
  const item: SyncQueueItem = { id: stableId(followUp), kind: "follow_up", payload: followUp, status: "queued", attempts: 0, createdAt: now, updatedAt: now };
  const next = [item, ...current.filter((entry) => entry.id !== item.id)];
  await writeQueueRaw(JSON.stringify(next));
  return next;
}

export async function markQueueRetry(id: string): Promise<SyncQueueItem[]> {
  const current = await readQueueItemsStrict();
  const next = current.map((item) => item.id === id ? { ...item, status: "retrying" as const, attempts: item.attempts + 1, updatedAt: new Date().toISOString() } : item);
  await writeQueueRaw(JSON.stringify(next));
  return next;
}

export async function markQueueSynced(id: string): Promise<SyncQueueItem[]> {
  const current = await readQueueItemsStrict();
  const next = current.map((item) => item.id === id ? { ...item, status: "synced" as const, updatedAt: new Date().toISOString() } : item);
  await writeQueueRaw(JSON.stringify(next));
  return next;
}

export async function loadSyncQueueStrict(): Promise<SyncQueueItem[]> {
  return readQueueItemsStrict();
}

export async function loadSyncQueue(): Promise<SyncQueueItem[]> {
  try {
    return await loadSyncQueueStrict();
  } catch {
    return [];
  }
}

export async function saveSyncQueue(items: SyncQueueItem[]): Promise<void> {
  await writeQueueRaw(JSON.stringify(items));
}

export function getPendingSyncCount(items: SyncQueueItem[]) {
  let pending = 0;
  for (const item of items) {
    if (item.status !== "synced") pending += 1;
  }
  return pending;
}

export async function saveLastSyncAt(timestamp = new Date().toISOString()): Promise<boolean> {
  try {
    await AsyncStorage.setItem(SYNC_META_KEY, timestamp);
    return true;
  } catch {
    return false;
  }
}

export async function loadLastSyncAt(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SYNC_META_KEY);
  } catch {
    return null;
  }
}

export function formatLastSync(timestamp: string | null) {
  if (!timestamp) return "Not synced yet";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Sync time unavailable";
  return `Last sync ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function getQueueSummary(items: SyncQueueItem[]) {
  let queued = 0;
  let retrying = 0;
  let synced = 0;
  for (const item of items) {
    if (item.status === "queued") queued += 1;
    else if (item.status === "retrying") retrying += 1;
    else if (item.status === "synced") synced += 1;
  }
  return { queued, retrying, synced };
}

export function getQueueStatusLabel(status: SyncQueueItem["status"]) {
  if (status === "synced") return "Synced";
  if (status === "retrying") return "Retrying";
  return "Queued for sync";
}
