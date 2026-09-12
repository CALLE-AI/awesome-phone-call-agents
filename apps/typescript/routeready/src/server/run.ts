import { CalleClient } from "@call-e/calle";
import type { LoadedDay } from "../core/day.js";
import { maskPhone } from "../core/phone.js";
import { minutesToClock } from "../core/readiness.js";
import type { GeoPoint, Stop } from "../core/types.js";
import { LivePort, ScriptedPort, type LiveLine } from "../calle/ports.js";
import { describeEvent } from "../engine/describe.js";
import { RouteEngine, runDay, type CallTarget, type DayMetrics, type EngineEvent } from "../engine/engine.js";

export interface LiveConfig {
  apiKey: string;
  language: string;
  /** Real destination per stop; stops without one keep scripted customers. */
  targets: Map<string, CallTarget>;
}

export type Mode = "simulate" | "live";
export type Pace = "slow" | "normal" | "fast";

/**
 * Day minutes per real second: while the rider rides, and while a scripted
 * call plays, slow enough that every line of the conversation can be read.
 */
export const PACES: Record<Pace, { riding: number; calling: number }> = {
  slow: { riding: 0.25, calling: 0.08 },
  normal: { riding: 0.5, calling: 0.12 },
  fast: { riding: 1.2, calling: 0.3 },
};
/** Live calls run in real time, so a call is never shown shorter than it was. */
const REAL_TIME = 1 / 60;
/** Pause after a scripted answer before the next call starts, so its effect can be read. */
const ANSWER_HOLD_MS = 3500;
/** Real time holds this long after a live call ends, so its result stays on screen. */
const LIVE_RESULT_HOLD_MS = 12_000;
const TICK_MS = 250;
const CALL_HISTORY = 12;

export interface CallCard {
  stopId: string;
  customer: string;
  live: boolean;
  maskedPhone: string;
  reason: string;
  startedAt: string;
  lines: { speaker: LiveLine["speaker"]; text: string }[];
  result: string | null;
  verified: boolean | null;
}

export interface Toast {
  id: number;
  tone: "route" | "avoided";
  title: string;
  detail: string;
}

/** Everything the screens need, pushed several times a second. Phone numbers are always masked. */
export interface Snapshot {
  started: boolean;
  mode: Mode;
  pace: Pace;
  paused: boolean;
  liveAvailable: boolean;
  running: boolean;
  done: boolean;
  clock: string;
  /** Plain-language line for what the rider is doing right now. */
  story: { title: string; detail: string };
  /** `from` is where the current leg started, or where the rider stands. */
  rider: {
    lat: number;
    lng: number;
    moving: boolean;
    from: string;
    target: string | null;
    progress: number;
    remainingKm: number | null;
    remainingMinutes: number | null;
    arriveClock: string | null;
  };
  order: string[];
  routeVersion: number;
  stops: {
    id: string;
    customer: string;
    label: string;
    status: string;
    note: string;
    eta: string | null;
    live: boolean;
    landmark: string;
    quote: string;
    handoff: string;
    cash: string;
    codAmount: number | null;
    firstTime: boolean;
    gated: boolean;
  }[];
  /** Newest first; the first card is on the line while its result is null. */
  calls: CallCard[];
  toast: Toast | null;
  log: { clock: string; kind: string; text: string }[];
  metrics: DayMetrics;
  baseline: DayMetrics | null;
}

/** Owns one running day at a time and drives its clock for the screens. */
export class RunController {
  private engine: RouteEngine | null = null;
  private baseline: DayMetrics | null = null;
  private mode: Mode = "simulate";
  private pace: Pace = "normal";
  private paused = false;
  private running = false;
  private loop: Promise<void> | null = null;
  private calls: CallCard[] = [];
  private holdUntil = 0;
  private liveHoldUntil = 0;
  private toast: Toast | null = null;
  private toastCount = 0;
  private log: Snapshot["log"] = [];
  private routeVersion = 0;
  private readonly subscribers = new Set<(snapshot: Snapshot) => void>();

  constructor(
    private readonly loaded: LoadedDay,
    private readonly live: LiveConfig | null,
  ) {}

  get liveCallInFlight(): boolean {
    const current = this.calls[0];
    return current !== undefined && current.live && current.result === null;
  }

  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.subscribers.add(listener);
    listener(this.snapshot());
    return () => this.subscribers.delete(listener);
  }

  async start(mode: Mode, pace: Pace): Promise<void> {
    if (this.liveCallInFlight) throw new Error("A live call is still in progress. Wait for it to finish before starting again.");
    if (mode === "live" && !this.live) throw new Error("Live mode is not configured on this server.");
    this.running = false;
    await this.loop;

    const { day, travel } = this.loaded;
    this.baseline = (await runDay({ day, travel, runId: "baseline" })).metrics;
    const scripted = new ScriptedPort(new Map(day.stops.map((stop) => [stop.id, stop])), day.truth, day.merchant);
    const live = mode === "live" && this.live ? this.live : null;
    const livePort = live ? new LivePort(new CalleClient({ apiKey: live.apiKey })) : null;
    this.engine = new RouteEngine({
      day,
      travel,
      runId: `${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      language: live?.language,
      routeCall: (stop) => {
        const target = live?.targets.get(stop.id);
        if (livePort && target) return { port: livePort, target };
        return { port: scripted, target: { phone: stop.phone, region: "BD" } };
      },
    });
    this.mode = mode;
    this.pace = pace;
    this.paused = false;
    this.calls = [];
    this.holdUntil = 0;
    this.liveHoldUntil = 0;
    this.toast = null;
    this.log = [];
    this.routeVersion = 0;
    for (const event of this.engine.events) this.record(event);
    this.engine.onEvent((event) => this.record(event));
    this.running = true;
    this.loop = this.run(this.engine);
  }

  stop(): void {
    this.running = false;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.broadcast();
  }

  setPace(pace: Pace): void {
    this.pace = pace;
    this.broadcast();
  }

  snapshot(): Snapshot {
    const { day } = this.loaded;
    const engine = this.engine;
    const etas = engine?.etas() ?? new Map<string, number>();
    const clock = (minutes: number) => minutesToClock(minutes, day.shiftStart);
    return {
      started: engine !== null,
      mode: this.mode,
      pace: this.pace,
      paused: this.paused,
      liveAvailable: this.live !== null,
      running: this.running,
      done: engine?.done ?? false,
      clock: clock(engine?.now ?? 0),
      story: this.story(engine),
      rider: this.rider(engine),
      order: engine ? [...(engine.leg ? [engine.leg.to] : []), ...engine.order] : day.stops.map((stop) => stop.id),
      routeVersion: this.routeVersion,
      stops: day.stops.map((stop) => {
        const state = engine?.states.get(stop.id);
        const eta = etas.get(stop.id);
        return {
          id: stop.id,
          customer: stop.customer,
          label: stop.label,
          status: state?.status ?? "planned",
          note: state?.note ?? "",
          eta: eta === undefined ? null : clock(eta),
          live: state?.live ?? false,
          landmark: state?.answer?.landmark ?? "",
          quote: state?.answer?.quote_in_english || state?.answer?.customer_quote || "",
          handoff: state?.answer?.handoff ?? "unknown",
          cash: state?.answer?.cod_cash_ready ?? "unknown",
          codAmount: stop.codAmount,
          firstTime: stop.firstTime,
          gated: stop.gated,
        };
      }),
      calls: this.calls,
      toast: this.toast,
      log: this.log.slice(-80),
      metrics: engine?.metrics ?? emptyMetrics(),
      baseline: this.baseline,
    };
  }

  private rate(): number {
    if (this.paused) return 0;
    const now = Date.now();
    if (this.liveCallInFlight || now < this.liveHoldUntil) return REAL_TIME;
    const calling = this.calls[0] !== undefined && this.calls[0].result === null;
    return calling || now < this.holdUntil ? PACES[this.pace].calling : PACES[this.pace].riding;
  }

  private async run(engine: RouteEngine): Promise<void> {
    let last = Date.now();
    while (this.running && !engine.done) {
      await sleep(TICK_MS);
      const now = Date.now();
      const minute = engine.now + ((now - last) / 1000) * this.rate();
      last = now;
      engine.holdCalls = now < this.holdUntil || now < this.liveHoldUntil;
      try {
        await engine.advance(minute);
      } catch (error) {
        this.log.push({ clock: minutesToClock(engine.now, this.loaded.day.shiftStart), kind: "error", text: (error as Error).message });
        this.running = false;
      }
      this.broadcast();
    }
    this.running = false;
    this.broadcast();
  }

  private record(event: EngineEvent): void {
    const { day } = this.loaded;
    const customer = (id: string) => day.stops.find((stop) => stop.id === id)?.customer ?? id;
    const openCard = (stopId: string) => this.calls.find((card) => card.stopId === stopId && card.result === null);

    if (event.type === "call_started") {
      const target = this.live?.targets.get(event.stopId);
      const phone = event.live && target ? target.phone : (day.stops.find((stop) => stop.id === event.stopId)?.phone ?? "");
      this.calls.unshift({
        stopId: event.stopId,
        customer: customer(event.stopId),
        live: event.live,
        maskedPhone: maskPhone(phone),
        reason: event.reason,
        startedAt: minutesToClock(event.at, day.shiftStart),
        lines: [],
        result: null,
        verified: null,
      });
      this.calls.length = Math.min(this.calls.length, CALL_HISTORY);
    }
    if (event.type === "call_line") {
      const card = openCard(event.stopId);
      if (card) addLine(card.lines, event.line);
      return;
    }
    if (event.type === "call_result" || (event.type === "call_error" && event.final)) {
      const card = openCard(event.stopId);
      if (card) {
        card.result = event.type === "call_result" ? event.note : event.message;
        card.verified = event.type === "call_result" ? event.verified : false;
        if (card.live) this.liveHoldUntil = Date.now() + LIVE_RESULT_HOLD_MS;
        else this.holdUntil = Date.now() + ANSWER_HOLD_MS;
      }
      if (event.type === "call_result" && (event.plan === "remove" || event.plan === "revisit")) {
        this.showToast("avoided", "Wasted trip avoided", `${customer(event.stopId)}: ${event.note}`);
      }
    }
    if (event.type === "reordered") {
      this.routeVersion++;
      this.showToast("route", `Route updated · saves ${Math.max(1, Math.round(event.savedMinutes))} min`, event.because);
    }
    const text = describeEvent(event, day);
    if (text) this.log.push({ clock: minutesToClock(event.at, day.shiftStart), kind: event.type, text });
  }

  private showToast(tone: Toast["tone"], title: string, detail: string): void {
    this.toast = { id: ++this.toastCount, tone, title, detail };
  }

  private story(engine: RouteEngine | null): Snapshot["story"] {
    const { day } = this.loaded;
    const clock = (minutes: number) => minutesToClock(minutes, day.shiftStart);
    if (!engine) return { title: "Ready when you are", detail: `${day.stops.length} stops in ${day.city} · starts ${day.shiftStart}` };
    if (engine.done) return { title: "Route complete", detail: `Finished at ${clock(engine.metrics.finishedAt ?? engine.now)}` };
    if (engine.door) {
      const stop = this.stopById(engine.door.stopId);
      if (engine.door.failed) return { title: `Nobody ready at ${stop.customer}'s door`, detail: "Failed attempt, moving on" };
      if (engine.now < engine.door.readyAt) {
        return { title: `Waiting for ${stop.customer}`, detail: `Ready in about ${Math.ceil(engine.door.readyAt - engine.now)} min` };
      }
      return { title: `Delivering to ${stop.customer}`, detail: stop.codAmount === null ? "Prepaid order" : `Collecting Tk ${stop.codAmount}` };
    }
    if (engine.leg) {
      const rider = this.rider(engine);
      return {
        title: `Riding to ${this.stopById(engine.leg.to).customer}`,
        detail: `${(rider.remainingKm ?? 0).toFixed(1)} km · ${Math.ceil(rider.remainingMinutes ?? 0)} min · arrives ${rider.arriveClock}`,
      };
    }
    return { title: "Planning the route", detail: "" };
  }

  private rider(engine: RouteEngine | null): Snapshot["rider"] {
    const { day, raw, travel } = this.loaded;
    const point = (id: string): GeoPoint => (id === day.hub.id ? day.hub : (day.stops.find((stop) => stop.id === id) ?? day.hub));
    const still = (id: string, target: string | null) => {
      const here = point(id);
      return { lat: here.lat, lng: here.lng, moving: false, from: id, target, progress: 0, remainingKm: null, remainingMinutes: null, arriveClock: null };
    };
    if (!engine) return still(day.hub.id, null);
    if (!engine.leg) return still(engine.at, engine.order[0] ?? null);
    const { from, to, departAt, arriveAt } = engine.leg;
    const shape = raw.shapes[`${from}>${to}`] ?? [
      [point(from).lat, point(from).lng],
      [point(to).lat, point(to).lng],
    ];
    const progress = Math.min(1, Math.max(0, (engine.now - departAt) / Math.max(arriveAt - departAt, 1e-6)));
    const [lat, lng] = alongShape(shape, progress);
    return {
      lat,
      lng,
      moving: true,
      from,
      target: to,
      progress,
      remainingKm: (travel.meters(from, to) / 1000) * (1 - progress),
      remainingMinutes: Math.max(0, arriveAt - engine.now),
      arriveClock: minutesToClock(arriveAt, day.shiftStart),
    };
  }

  private stopById(id: string): Stop {
    const stop = this.loaded.day.stops.find((candidate) => candidate.id === id);
    if (!stop) throw new Error(`Unknown stop: ${id}`);
    return stop;
  }

  private broadcast(): void {
    const snapshot = this.snapshot();
    for (const listener of this.subscribers) listener(snapshot);
  }
}

/** Joins a streamed transcript line onto the card the way CALL-E sends it. */
function addLine(lines: CallCard["lines"], line: LiveLine): void {
  const last = lines.at(-1);
  if (last && last.speaker === line.speaker && line.merge === "replace") last.text = line.text;
  else if (last && last.speaker === line.speaker && line.merge === "append") last.text = `${last.text} ${line.text}`;
  else lines.push({ speaker: line.speaker, text: line.text });
}

/** Point at `progress` (0..1) of the way along a [lat, lng] polyline. */
function alongShape(shape: [number, number][], progress: number): [number, number] {
  if (shape.length === 1) return shape[0];
  const lengths = shape.slice(1).map((point, i) => Math.hypot(point[0] - shape[i][0], point[1] - shape[i][1]));
  let remaining = progress * lengths.reduce((sum, length) => sum + length, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] === 0 ? 0 : Math.min(1, remaining / lengths[i]);
      return [shape[i][0] + (shape[i + 1][0] - shape[i][0]) * t, shape[i][1] + (shape[i + 1][1] - shape[i][1]) * t];
    }
    remaining -= lengths[i];
  }
  return shape[shape.length - 1];
}

function emptyMetrics(): DayMetrics {
  return { delivered: 0, failedAttempts: 0, doorWaitMinutes: 0, tripsAvoided: 0, calls: 0, kilometres: 0, finishedAt: null };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
