"use client";

import type { Disposition, Spoken } from "asheard/disposition";

/**
 * The review queue, kept in this browser and nowhere else.
 *
 * The landing page promises that nothing is stored, and that promise is worth
 * more than a convenient server table. Everything read through the paste door
 * lands here, in localStorage, on the machine that read it. No account, no
 * database, nothing leaving the browser.
 *
 * That does put a ceiling on it. It is one browser, one profile, and it goes
 * away when somebody clears their site data. A queue several people work
 * together needs a real store behind it, and that arrives with the webhook
 * door, because a webhook has nowhere else to land. Until then this is the
 * honest version rather than a stub pretending to be durable.
 */

export interface QueueEntry {
  /** Ours, not CALL-E's. Two payloads can carry the same call id. */
  key: string;
  /** The call id from the payload when it had one. */
  callId: string | null;
  at: string;
  payload: unknown;
  disposition: Disposition;
  spoken: Spoken;
}

const STORAGE_KEY = "asheard.queue.v1";
const LIMIT = 200;

function readStore(): QueueEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueueEntry[]) : [];
  } catch {
    // A corrupt or unreadable store is not worth crashing a page over, and a
    // half-parsed queue would be worse than an empty one.
    return [];
  }
}

function writeStore(entries: QueueEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, LIMIT)));
  } catch {
    // Out of quota, or storage blocked. The reading on screen is still correct,
    // it just will not be here next time.
  }
}

function callIdOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

export function remember(entry: Omit<QueueEntry, "key" | "at" | "callId">): QueueEntry {
  const full: QueueEntry = {
    ...entry,
    key: crypto.randomUUID(),
    callId: callIdOf(entry.payload),
    at: new Date().toISOString(),
  };
  writeStore([full, ...readStore()]);
  return full;
}

/** Newest first. The order a queue is worked in. */
export function list(): QueueEntry[] {
  return readStore();
}

export function find(key: string): QueueEntry | null {
  return readStore().find((entry) => entry.key === key) ?? null;
}

export function forget(key: string): void {
  writeStore(readStore().filter((entry) => entry.key !== key));
}

export function forgetAll(): void {
  writeStore([]);
}

/**
 * The one line to put on a queue row.
 *
 * The reason is the useful column, not the status, so a person can triage the
 * whole list without opening anything. Where there are several, the first is
 * the one `reviewFlags` considered most serious.
 */
export function rowReason(entry: QueueEntry): string {
  return entry.disposition.reasons[0] ?? entry.spoken.subline ?? "Nothing needs a person.";
}
