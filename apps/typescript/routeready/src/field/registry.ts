import { randomBytes } from "node:crypto";
import type { CallPort } from "../calle/ports.js";
import { haversineMeters } from "../core/geo.js";
import type { CallLedger } from "../core/ledger.js";
import { maskPhone } from "../core/phone.js";
import { maskPhonesDeep } from "../core/redact.js";
import { FieldSession, type FieldSetup } from "./session.js";

/** Everything the rider's screen needs. Phone numbers are masked and the API key never appears. */
export function fieldSnapshot(session: FieldSession) {
  const etas = session.etas();
  const now = Date.now();
  const clockIn = (minutes: number) => session.localClock(session.startedAt + minutes * 60_000);
  const door = session.doorStopId();
  const nowMinutes = session.now();
  return maskPhonesDeep({
    ended: session.endedReason,
    finished: session.finished,
    live: true,
    merchant: session.setup.merchant,
    callAheadMinutes: session.setup.callAheadMinutes,
    speedKmh: session.setup.speedKmh,
    testCall: session.setup.testCall,
    locationSource: session.setup.locationSource,
    clock: session.localClock(now),
    rider: { lat: session.rider.lat, lng: session.rider.lng, accuracy: session.rider.accuracy, secondsAgo: Math.round((now - session.rider.updatedAt) / 1000) },
    order: session.order,
    routeVersion: session.routeVersion,
    door,
    lineBusy: session.lineBusy,
    callsHalted: session.callsHalted,
    stops: session.setup.stops.map((stop) => {
      const state = session.states.get(stop.id);
      const eta = etas.get(stop.id);
      return {
        id: stop.id,
        order: stop.order,
        customer: stop.customer,
        label: stop.label,
        lat: stop.lat,
        lng: stop.lng,
        maskedPhone: maskPhone(stop.phone),
        region: stop.region,
        cash: stop.cash,
        status: state?.status ?? "planned",
        note: state?.note ?? "",
        called: state?.called ?? false,
        eta: eta === undefined ? null : clockIn(eta),
        minutesAway: eta === undefined ? null : Math.max(0, eta - nowMinutes),
        metersAway: Math.round(haversineMeters(session.rider, stop)),
        landmark: state?.answer?.landmark ?? "",
        quote: state?.answer?.quote_in_english || state?.answer?.customer_quote || "",
        handoff: state?.answer?.handoff ?? "unknown",
        cashReady: state?.answer?.cod_cash_ready ?? "unknown",
      };
    }),
    calls: session.calls,
    toast: session.toast,
    log: session.log.map((entry) => ({ clock: session.localClock(entry.at), kind: entry.kind, text: entry.text })),
    metrics: session.metrics,
  });
}

export type FieldSnapshot = ReturnType<typeof fieldSnapshot>;

export interface RegistryLimits {
  maxSessions: number;
  /** A route nobody is watching ends after this long, and its key is dropped. */
  idleMs: number;
  /** Every route ends after this long, whatever happens. */
  maxAgeMs: number;
}

export const DEFAULT_LIMITS: RegistryLimits = { maxSessions: 30, idleMs: 20 * 60_000, maxAgeMs: 3 * 60 * 60_000 };

interface Entry {
  session: FieldSession;
  listeners: Set<(snapshot: FieldSnapshot | { gone: string }) => void>;
  lastSeen: number;
}

/**
 * Holds the routes visitors started. The session id is a random secret held
 * by the visitor's browser; the API key lives only inside that session's
 * CALL-E client and is gone when the session is removed.
 */
export class FieldRegistry {
  private readonly entries = new Map<string, Entry>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly makePort: (apiKey: string) => CallPort,
    private readonly ledger: CallLedger,
    private readonly limits: RegistryLimits = DEFAULT_LIMITS,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** @param approvedRepeats numbers already called today that the visitor explicitly approved calling again */
  create(apiKey: string, setup: FieldSetup, approvedRepeats: ReadonlySet<string> = new Set()): { sessionId: string; session: FieldSession } {
    this.sweep();
    if (this.entries.size >= this.limits.maxSessions) throw new Error("Too many routes are running on this server right now. Try again in a few minutes.");
    const sessionId = randomBytes(24).toString("base64url");
    const runId = `field-${randomBytes(6).toString("hex")}`;
    const approved = new Set(approvedRepeats);
    const offset = setup.utcOffsetMinutes;
    const session = new FieldSession(runId, setup, this.makePort(apiKey), Date.now, {
      allowed: (phone) => approved.has(phone) || !this.ledger.calledToday(phone, offset),
      record: (phone) => {
        approved.delete(phone);
        this.ledger.record(phone, offset);
      },
    });
    this.entries.set(sessionId, { session, listeners: new Set(), lastSeen: Date.now() });
    return { sessionId, session };
  }

  get(sessionId: string): FieldSession | null {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    entry.lastSeen = Date.now();
    return entry.session;
  }

  subscribe(sessionId: string, listener: (snapshot: FieldSnapshot | { gone: string }) => void): (() => void) | null {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    entry.listeners.add(listener);
    entry.lastSeen = Date.now();
    listener(fieldSnapshot(entry.session));
    return () => {
      entry.listeners.delete(listener);
      entry.lastSeen = Date.now();
    };
  }

  broadcast(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    const snapshot = fieldSnapshot(entry.session);
    for (const listener of entry.listeners) listener(snapshot);
  }

  end(sessionId: string, reason: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.session.end(reason);
    for (const listener of entry.listeners) listener({ gone: reason });
    this.entries.delete(sessionId);
  }

  /** Advances every route once a second and removes routes that are idle or too old. */
  startLoop(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tickAll(), intervalMs);
    this.timer.unref();
  }

  async tickAll(): Promise<void> {
    this.sweep();
    await Promise.all(
      [...this.entries.keys()].map(async (sessionId) => {
        const entry = this.entries.get(sessionId);
        if (!entry) return;
        try {
          await entry.session.tick();
        } catch {
          // A tick never throws on call errors; anything else waits for the next tick.
        }
        this.broadcast(sessionId);
      }),
    );
  }

  private sweep(): void {
    const now = Date.now();
    for (const [sessionId, entry] of this.entries) {
      const idle = entry.listeners.size === 0 && !entry.session.lineBusy && now - entry.lastSeen > this.limits.idleMs;
      if (idle) this.end(sessionId, "The route ended because nobody had it open.");
      else if (now - entry.session.startedAt > this.limits.maxAgeMs) this.end(sessionId, "The route reached its time limit.");
    }
  }
}
