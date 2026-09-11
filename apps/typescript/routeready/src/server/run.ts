import { CalleClient } from "@call-e/calle";
import type { LoadedDay } from "../core/day.js";
import { maskPhone } from "../core/phone.js";
import { minutesToClock } from "../core/readiness.js";
import type { GeoPoint } from "../core/types.js";
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

interface CallCard {
  stopId: string;
  live: boolean;
  maskedPhone: string;
  reason: string;
  lines: { speaker: LiveLine["speaker"]; text: string }[];
  result: string | null;
  verified: boolean | null;
}

/** Everything the screens need, pushed several times a second. Phone numbers are always masked. */
export interface Snapshot {
  mode: Mode;
  liveAvailable: boolean;
  running: boolean;
  done: boolean;
  clock: string;
  /** `from` is where the current leg started, or where the rider stands. */
  rider: { lat: number; lng: number; moving: boolean; from: string; target: string | null };
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
  }[];
  call: CallCard | null;
  /** The call before the current one, kept on screen so its result is not lost when the next call starts. */
  previousCall: CallCard | null;
  log: { clock: string; kind: string; text: string }[];
  metrics: DayMetrics;
  baseline: DayMetrics | null;
}

const TICK_MS = 250;
/** Day minutes per real second while a live call is in flight: real time, so a call is never shortened. */
const REAL_TIME = 1 / 60;
/** Real time also holds this long after a live call ends, so its result stays on screen. */
const LIVE_RESULT_HOLD_MS = 12_000;

/** Owns one running day at a time and drives its clock for the screens. */
export class RunController {
  private engine: RouteEngine | null = null;
  private baseline: DayMetrics | null = null;
  private mode: Mode = "simulate";
  private speed = 0.75;
  private running = false;
  private loop: Promise<void> | null = null;
  private call: CallCard | null = null;
  private previousCall: CallCard | null = null;
  /** Real clock time when the last live call ended. */
  private liveResultAt = 0;
  private log: Snapshot["log"] = [];
  private routeVersion = 0;
  private readonly subscribers = new Set<(snapshot: Snapshot) => void>();

  constructor(
    private readonly loaded: LoadedDay,
    private readonly live: LiveConfig | null,
  ) {}

  get liveCallInFlight(): boolean {
    return this.call !== null && this.call.live && this.call.result === null;
  }

  private get realTime(): boolean {
    return this.liveCallInFlight || Date.now() - this.liveResultAt < LIVE_RESULT_HOLD_MS;
  }

  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.subscribers.add(listener);
    listener(this.snapshot());
    return () => this.subscribers.delete(listener);
  }

  /** Starts a new day. `speed` is day minutes per real second between calls. */
  async start(mode: Mode, speed: number): Promise<void> {
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
    this.speed = speed;
    this.call = null;
    this.previousCall = null;
    this.liveResultAt = 0;
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

  snapshot(): Snapshot {
    const { day } = this.loaded;
    const engine = this.engine;
    const etas = engine?.etas() ?? new Map<string, number>();
    const clock = (minutes: number) => minutesToClock(minutes, day.shiftStart);
    return {
      mode: this.mode,
      liveAvailable: this.live !== null,
      running: this.running,
      done: engine?.done ?? false,
      clock: clock(engine?.now ?? 0),
      rider: engine
        ? this.riderPosition(engine)
        : { lat: day.hub.lat, lng: day.hub.lng, moving: false, from: day.hub.id, target: null },
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
        };
      }),
      call: this.call,
      previousCall: this.previousCall,
      log: this.log.slice(-80),
      metrics: engine?.metrics ?? emptyMetrics(),
      baseline: this.baseline,
    };
  }

  private async run(engine: RouteEngine): Promise<void> {
    let last = Date.now();
    while (this.running && !engine.done) {
      await sleep(TICK_MS);
      const now = Date.now();
      const rate = this.realTime ? REAL_TIME : this.speed;
      const minute = engine.now + ((now - last) / 1000) * rate;
      last = now;
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
    if (event.type === "call_started") {
      const target = this.live?.targets.get(event.stopId);
      const phone = event.live && target ? target.phone : (day.stops.find((stop) => stop.id === event.stopId)?.phone ?? "");
      if (this.call) this.previousCall = this.call;
      this.call = { stopId: event.stopId, live: event.live, maskedPhone: maskPhone(phone), reason: event.reason, lines: [], result: null, verified: null };
    }
    if (event.type === "call_line" && this.call?.stopId === event.stopId) addLine(this.call.lines, event.line);
    if ((event.type === "call_result" || event.type === "call_error") && this.call?.stopId === event.stopId) {
      this.call.result = event.type === "call_result" ? event.note : event.message;
      this.call.verified = event.type === "call_result" ? event.verified : false;
      if (this.call.live) this.liveResultAt = Date.now();
    }
    if (event.type === "reordered") this.routeVersion++;
    if (event.type === "call_line") return;
    const text = describeEvent(event, day);
    if (text) this.log.push({ clock: minutesToClock(event.at, day.shiftStart), kind: event.type, text });
  }

  private riderPosition(engine: RouteEngine): Snapshot["rider"] {
    const { day, raw } = this.loaded;
    const point = (id: string): GeoPoint => (id === day.hub.id ? day.hub : (day.stops.find((stop) => stop.id === id) ?? day.hub));
    if (!engine.leg) {
      const here = point(engine.at);
      return { lat: here.lat, lng: here.lng, moving: false, from: engine.at, target: engine.order[0] ?? null };
    }
    const { from, to, departAt, arriveAt } = engine.leg;
    const shape = raw.shapes[`${from}>${to}`] ?? [
      [point(from).lat, point(from).lng],
      [point(to).lat, point(to).lng],
    ];
    const progress = Math.min(1, Math.max(0, (engine.now - departAt) / Math.max(arriveAt - departAt, 1e-6)));
    const [lat, lng] = alongShape(shape, progress);
    return { lat, lng, moving: true, from, target: to };
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
