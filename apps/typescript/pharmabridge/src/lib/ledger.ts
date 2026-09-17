// Server-side call recorder. Every call PharmaBridge places, live or simulated, is written to a local
// JSON ledger: the brief, routing, full transcript (phone-menu prompts and keypad presses included),
// CALL-E events, the structured result, and CALL-E provider call ids for looking up the audio in the
// CALL-E dashboard. Phone numbers are masked before anything is written. A submission CALL-E never
// confirmed is recorded as "unknown", never dropped. Best-effort: a read-only filesystem never breaks a call.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactDeep, redactPhones } from "./phone";
import type { PulseItem } from "./pulse-item";
import type { BriefSpec, CallEventView, CallKind, CallView, Facility, NeedKind, Routing } from "./types";

export interface LedgerEntry {
  key: string;
  callId: string;
  missionId: string;
  kind: CallKind;
  needKind: NeedKind;
  needSummary: string;
  /** The party this call dialed. Coordinates are absent on records written before the Shortage Pulse. */
  facility: { id: string; name: string; address: string; phoneMasked: string | null; lat?: number; lon?: number; source?: Facility["source"] };
  /** What the call asked about, for the Shortage Pulse. */
  item?: PulseItem;
  routing: Routing;
  mode: "simulation" | "live";
  dialTarget: string;
  brief: BriefSpec;
  task: string;
  createdAt: string;
  updatedAt: string;
  /** "unknown" marks a submission CALL-E never confirmed: it may have dialed. */
  status: CallView["status"] | "unknown";
  summary: string | null;
  turns: number;
  providerCallIds: string[];
  call: CallView | null;
  events: CallEventView[];
}

export type LedgerSummary = Omit<LedgerEntry, "call" | "events" | "brief" | "task">;

const KEY = /^[a-f0-9]{24}$/;
const holder = globalThis as unknown as { __pharmabridgeLedger?: { queues: Map<string, Promise<void>>; fingerprints: Map<string, string> } };

function state() {
  holder.__pharmabridgeLedger ??= { queues: new Map(), fingerprints: new Map() };
  return holder.__pharmabridgeLedger;
}

export function ledgerDir(): string {
  return process.env.PHARMABRIDGE_LEDGER_DIR?.trim() || path.join(process.cwd(), "data", "ledger");
}

export function ledgerKey(callId: string): string {
  return createHash("sha256").update(callId).digest("hex").slice(0, 24);
}

const fileFor = (key: string) => path.join(ledgerDir(), `${key}.json`);

/** Serializes writes per call so concurrent polls never clobber each other. */
function enqueue(key: string, work: () => Promise<void>): Promise<void> {
  const queues = state().queues;
  const next = (queues.get(key) ?? Promise.resolve()).then(work).catch((error) => {
    console.warn(`[ledger] ${key}: ${error instanceof Error ? redactPhones(error.message) : String(error)}`);
  });
  queues.set(key, next);
  return next;
}

async function readEntry(key: string): Promise<LedgerEntry | null> {
  try {
    return JSON.parse(await readFile(fileFor(key), "utf8")) as LedgerEntry;
  } catch {
    return null;
  }
}

async function writeEntry(entry: LedgerEntry): Promise<void> {
  await mkdir(ledgerDir(), { recursive: true });
  await writeFile(fileFor(entry.key), JSON.stringify(entry, null, 2), "utf8");
}

function providerIds(call: CallView | null): string[] {
  return [...new Set((call?.attempts ?? []).map((a) => a.providerCallId).filter((id): id is string => Boolean(id)))];
}

function fingerprint(call?: CallView, events?: CallEventView[]): string {
  const turns = call?.attempts.reduce((n, a) => n + a.transcriptTurns.length, 0) ?? -1;
  return `${call?.status ?? "-"}|${turns}|${call?.structuredResult ? 1 : 0}|${events?.length ?? -1}`;
}

export interface CreatedCall {
  call: CallView;
  missionId: string;
  kind: CallKind;
  needKind: NeedKind;
  needSummary: string;
  facility: LedgerEntry["facility"];
  item?: PulseItem;
  routing: Routing;
  mode: "simulation" | "live";
  dialTarget: string;
  brief: BriefSpec;
  task: string;
}

function baseEntry(key: string, callId: string, input: Omit<CreatedCall, "call">, now: string) {
  return {
    key,
    callId,
    missionId: input.missionId,
    kind: input.kind,
    needKind: input.needKind,
    needSummary: redactPhones(input.needSummary),
    facility: input.facility,
    item: input.item,
    routing: input.routing,
    mode: input.mode,
    dialTarget: input.dialTarget,
    brief: redactDeep(input.brief),
    task: redactPhones(input.task),
    createdAt: now,
    updatedAt: now,
  };
}

export async function recordCreated(input: CreatedCall): Promise<string> {
  const key = ledgerKey(input.call.id);
  const now = new Date().toISOString();
  const call = redactDeep(input.call);
  await enqueue(key, () =>
    writeEntry({
      ...baseEntry(key, input.call.id, input, now),
      status: call.status,
      summary: call.summary,
      turns: 0,
      providerCallIds: providerIds(call),
      call,
      events: [],
    }),
  );
  return key;
}

/** Records a create request whose outcome CALL-E never confirmed, so it can be reconciled later. */
export async function recordUnknownSubmission(input: Omit<CreatedCall, "call"> & { idempotencyKey: string; error: string }): Promise<string> {
  const callId = `unconfirmed:${input.idempotencyKey}`;
  const key = ledgerKey(callId);
  const now = new Date().toISOString();
  await enqueue(key, () =>
    writeEntry({
      ...baseEntry(key, callId, input, now),
      status: "unknown",
      summary: redactPhones(`CALL-E did not confirm this submission (${input.error}). It may have dialed. Idempotency key: ${input.idempotencyKey}.`),
      turns: 0,
      providerCallIds: [],
      call: null,
      events: [],
    }),
  );
  return key;
}

/** Records a newer snapshot of a call and/or its events. Unchanged snapshots are skipped. */
export function recordSnapshot(callId: string, update: { call?: CallView; events?: CallEventView[] }): Promise<void> {
  const key = ledgerKey(callId);
  const print = fingerprint(update.call, update.events);
  const memo = `${key}:${update.call ? "c" : ""}${update.events ? "e" : ""}`;
  if (state().fingerprints.get(memo) === print) return Promise.resolve();
  state().fingerprints.set(memo, print);

  return enqueue(key, async () => {
    const entry = await readEntry(key);
    if (!entry) return;
    if (update.call) {
      const call = redactDeep(update.call);
      entry.call = call;
      entry.status = call.status;
      entry.summary = call.summary;
      entry.turns = call.attempts.reduce((n, a) => n + a.transcriptTurns.length, 0);
      entry.providerCallIds = providerIds(call);
    }
    if (update.events && update.events.length >= entry.events.length) entry.events = redactDeep(update.events);
    entry.updatedAt = new Date().toISOString();
    await writeEntry(entry);
  });
}

/** Full entries, newest first. */
export async function readAllLedger(limit = 2000): Promise<LedgerEntry[]> {
  let files: string[];
  try {
    files = (await readdir(ledgerDir())).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const entries = await Promise.all(files.map((f) => readEntry(f.replace(/\.json$/, ""))));
  return entries
    .filter((e): e is LedgerEntry => Boolean(e?.createdAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function listLedger(limit = 200): Promise<LedgerSummary[]> {
  return (await readAllLedger(limit)).map(({ call: _call, events: _events, brief: _brief, task: _task, ...summary }) => summary);
}

export async function readLedger(key: string): Promise<LedgerEntry | null> {
  return KEY.test(key) ? readEntry(key) : null;
}
