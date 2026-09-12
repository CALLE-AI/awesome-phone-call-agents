import { pickNextCall } from "../core/callPicker.js";
import { gateCall, type GateResult } from "../core/evidence.js";
import { clockToMinutes, minutesToClock, planFromAnswer, type StopPlan } from "../core/readiness.js";
import { resequence, type RouteStopInput } from "../core/resequence.js";
import type { TravelTimes } from "../core/travel.js";
import type { DayFixture, ReadinessAnswer, Stop } from "../core/types.js";
import type { CallPort, CallRequest, LiveLine } from "../calle/ports.js";
import { buildReadinessTask } from "../calle/task.js";

export type StopStatus = "planned" | "calling" | "confirmed" | "unverified" | "revisit" | "removed" | "delivered" | "failed";

export interface StopState {
  stop: Stop;
  status: StopStatus;
  plan: StopPlan;
  answer: ReadinessAnswer | null;
  /** Each stop is called at most once a day. */
  called: boolean;
  callId: string | null;
  /** The answer came from a real CALL-E call rather than a scripted customer. */
  live: boolean;
  /** Short text for screens, for example "ready around 10:45". */
  note: string;
}

export type EngineEvent =
  | { type: "plan"; at: number; order: string[] }
  | { type: "leg"; at: number; from: string; to: string; arriveAt: number }
  | { type: "call_started"; at: number; stopId: string; callId: string; live: boolean; reason: string }
  | { type: "call_line"; at: number; stopId: string; line: LiveLine }
  | { type: "call_result"; at: number; stopId: string; verified: boolean; note: string; plan: StopPlan["kind"] | null }
  /** `final` is false for a failed status check while the call is still going. */
  | { type: "call_error"; at: number; stopId: string; message: string; final: boolean }
  | { type: "reordered"; at: number; before: string[]; after: string[]; savedMinutes: number; because: string }
  | { type: "delivered"; at: number; stopId: string; waited: number }
  | { type: "failed_attempt"; at: number; stopId: string; reason: string }
  | { type: "day_done"; at: number };

export interface CallTarget {
  phone: string;
  region: string;
  locale?: string;
}

export interface EngineOptions {
  day: DayFixture;
  travel: TravelTimes;
  runId: string;
  language?: string;
  /** How each stop is called; null leaves a stop uncalled. Omit it to run the baseline day with no calls. */
  routeCall?: (stop: Stop) => { port: CallPort; target: CallTarget } | null;
}

export interface DayMetrics {
  delivered: number;
  failedAttempts: number;
  doorWaitMinutes: number;
  /** Stops taken off the route because the customer said later today or not today. */
  tripsAvoided: number;
  calls: number;
  kilometres: number;
  finishedAt: number | null;
}

/** Minutes a rider waits at the door for a customer who gave no warning. */
export const DOOR_WAIT_MINUTES = 5;
/** Longest wait at the door for a customer who said when they would be ready. */
export const PLANNED_WAIT_LIMIT = 30;
/** Minutes lost on a failed attempt: knocking, phoning from the door, leaving. */
export const FAILED_ATTEMPT_MINUTES = 3;

interface Leg {
  from: string;
  to: string;
  departAt: number;
  arriveAt: number;
}

interface InFlight {
  stopId: string;
  callId: string;
  port: CallPort;
  phone: string;
  promisedEta: number;
}

/**
 * Runs one rider's day: drives the route, knocks on doors, keeps one call in
 * flight, and re-orders the remaining stops around each verified answer.
 * Times are minutes after the shift start.
 */
export class RouteEngine {
  readonly states = new Map<string, StopState>();
  readonly events: EngineEvent[] = [];
  readonly metrics: DayMetrics = {
    delivered: 0,
    failedAttempts: 0,
    doorWaitMinutes: 0,
    tripsAvoided: 0,
    calls: 0,
    kilometres: 0,
    finishedAt: null,
  };
  /** Stops still to visit after the current leg, in order. */
  order: string[];
  now = 0;
  /** Point the rider last reached (hub or stop id). */
  at: string;
  leg: Leg | null = null;
  /** What the rider is doing at a door, while there. */
  door: { stopId: string; readyAt: number; until: number; failed: boolean } | null = null;
  /** While true no new call starts; screens set it briefly so each answer can be read. */
  holdCalls = false;
  private busyUntil = 0;
  private serving: { stopId: string; waited: number } | null = null;
  private inFlight: InFlight | null = null;
  private readonly listeners: ((event: EngineEvent) => void)[] = [];

  constructor(private readonly options: EngineOptions) {
    for (const stop of options.day.stops) {
      this.states.set(stop.id, {
        stop,
        status: "planned",
        plan: { kind: "no_change" },
        answer: null,
        called: false,
        callId: null,
        live: false,
        note: "",
      });
    }
    this.at = options.day.hub.id;
    const morning = resequence({
      from: this.at,
      now: 0,
      current: options.day.stops.map((stop) => this.input(stop.id)),
      travel: options.travel,
    });
    this.order = morning.best.order;
    this.emit({ type: "plan", at: 0, order: [...this.order] });
  }

  get done(): boolean {
    return this.metrics.finishedAt !== null;
  }

  onEvent(listener: (event: EngineEvent) => void): void {
    this.listeners.push(listener);
  }

  /** Moves the day forward to minute `now`. Not re-entrant: await each call. */
  async advance(now: number): Promise<void> {
    if (this.done) return;
    this.now = now;
    await this.pollCall();
    this.moveRider();
    await this.startCallIfDue();
    this.finishIfDone();
  }

  /** Expected arrival at the leg target and every remaining stop in the current order. */
  etas(): Map<string, number> {
    const etas = new Map<string, number>();
    if (this.leg) etas.set(this.leg.to, this.leg.arriveAt);
    let { from, time } = this.planningStart();
    for (const id of this.order) {
      const { stop, plan } = this.state(id);
      time += this.options.travel.minutes(from, id);
      etas.set(id, time);
      if (plan.kind === "earliest") time = Math.max(time, plan.at);
      time += stop.serviceMinutes;
      from = id;
    }
    return etas;
  }

  private moveRider(): void {
    for (;;) {
      if (this.leg) {
        if (this.now < this.leg.arriveAt) return;
        const leg = this.leg;
        this.leg = null;
        this.at = leg.to;
        this.knock(leg.to, leg.arriveAt);
        continue;
      }
      if (this.now < this.busyUntil) return;
      this.door = null;
      if (this.serving) {
        const { stopId, waited } = this.serving;
        this.serving = null;
        this.state(stopId).status = "delivered";
        this.metrics.delivered++;
        this.metrics.doorWaitMinutes += waited;
        this.emit({ type: "delivered", at: this.busyUntil, stopId, waited });
      }
      const next = this.order.shift();
      if (!next) return;
      this.departTo(next, this.busyUntil);
    }
  }

  private departTo(stopId: string, departAt: number): void {
    const { travel } = this.options;
    this.metrics.kilometres += travel.meters(this.at, stopId) / 1000;
    this.leg = { from: this.at, to: stopId, departAt, arriveAt: departAt + travel.minutes(this.at, stopId) };
    this.emit({ type: "leg", at: departAt, from: this.at, to: stopId, arriveAt: this.leg.arriveAt });
  }

  /** The rider reaches a door: deliver if the customer is ready soon enough, otherwise the attempt fails. */
  private knock(stopId: string, arrivedAt: number): void {
    const state = this.state(stopId);
    const readyAt = this.readyAt(state);
    const limit = state.plan.kind === "earliest" ? PLANNED_WAIT_LIMIT : DOOR_WAIT_MINUTES;
    if (readyAt !== null && readyAt - arrivedAt <= limit) {
      const waited = Math.max(0, readyAt - arrivedAt);
      this.busyUntil = arrivedAt + waited + state.stop.serviceMinutes;
      this.serving = { stopId, waited };
      this.door = { stopId, readyAt: arrivedAt + waited, until: this.busyUntil, failed: false };
      return;
    }
    this.busyUntil = arrivedAt + FAILED_ATTEMPT_MINUTES;
    this.door = { stopId, readyAt: arrivedAt, until: this.busyUntil, failed: true };
    state.status = "failed";
    this.metrics.failedAttempts++;
    const reason =
      readyAt === null ? "customer cannot receive today" : `customer not ready for another ${Math.round(readyAt - arrivedAt)} min`;
    this.emit({ type: "failed_attempt", at: arrivedAt, stopId, reason });
  }

  /** When the customer can really receive: their verified word on a live call, otherwise the simulated truth. */
  private readyAt(state: StopState): number | null {
    if (state.live && state.status === "confirmed" && state.plan.kind === "earliest") return state.plan.at;
    const truth = this.options.day.truth[state.stop.id];
    return truth ? truth.readyAt : 0;
  }

  private async startCallIfDue(): Promise<void> {
    const { routeCall, day, runId, language } = this.options;
    if (!routeCall || this.inFlight || this.holdCalls) return;
    const etas = this.etas();
    if (this.leg) etas.delete(this.leg.to); // the rider is already on the way
    const candidates = [...etas].map(([id, eta]) => ({ stop: this.state(id).stop, eta, called: this.state(id).called }));
    const pick = pickNextCall(this.now, candidates, false);
    if (!pick) return;

    const state = this.state(pick.stopId);
    state.called = true;
    const route = routeCall(state.stop);
    if (!route) return;

    const etaMinutes = pick.eta - this.now;
    const request: CallRequest = {
      stopId: pick.stopId,
      phone: route.target.phone,
      region: route.target.region,
      locale: route.target.locale,
      task: buildReadinessTask({
        merchant: day.merchant,
        orderRef: `RR-${pick.stopId.toUpperCase()}`,
        etaMinutes: Math.max(1, Math.round(etaMinutes)),
        codAmount: state.stop.codAmount === null ? null : `${state.stop.codAmount} taka`,
        language: language ?? "English",
      }),
      etaMinutes,
      idempotencyKey: `routeready:${runId}:${pick.stopId}`,
      metadata: { run_id: runId, stop_id: pick.stopId },
    };
    state.status = "calling";
    try {
      const { callId } = await route.port.start(request, this.now);
      state.callId = callId;
      state.live = route.port.mode === "live";
      this.inFlight = { stopId: pick.stopId, callId, port: route.port, phone: route.target.phone, promisedEta: pick.eta };
      this.metrics.calls++;
      this.emit({ type: "call_started", at: this.now, stopId: pick.stopId, callId, live: state.live, reason: pick.reason });
    } catch (error) {
      // The call may or may not have been placed; it is never redialled.
      state.status = "unverified";
      state.note = "call not confirmed; never redialled";
      this.emit({ type: "call_error", at: this.now, stopId: pick.stopId, message: (error as Error).message, final: true });
    }
  }

  private async pollCall(): Promise<void> {
    const flight = this.inFlight;
    if (!flight) return;
    let update: Awaited<ReturnType<CallPort["poll"]>>;
    try {
      update = await flight.port.poll(flight.callId, this.now);
    } catch (error) {
      this.emit({
        type: "call_error",
        at: this.now,
        stopId: flight.stopId,
        message: `status check failed, retrying: ${(error as Error).message}`,
        final: false,
      });
      return;
    }
    for (const line of update.lines) this.emit({ type: "call_line", at: line.at, stopId: flight.stopId, line });
    if (!update.final) return;
    this.inFlight = null;
    this.applyResult(flight, gateCall(update.final, flight.phone));
  }

  private applyResult(flight: InFlight, gate: GateResult): void {
    const state = this.state(flight.stopId);
    state.answer = gate.answer;
    const stillAhead = this.order.includes(flight.stopId);
    if (!gate.verified || !stillAhead) {
      state.status = stillAhead ? "unverified" : state.status;
      state.note = gate.verified ? "answer arrived after the rider got there" : gate.reason;
      this.emit({ type: "call_result", at: this.now, stopId: flight.stopId, verified: false, note: state.note, plan: null });
      return;
    }

    const { answer } = gate;
    const stated = clockToMinutes(answer.ready_clock_time, this.options.day.shiftStart);
    state.plan = planFromAnswer(answer.readiness, flight.promisedEta, this.now, stated);
    state.note = this.describe(state.plan);
    if (state.plan.kind === "remove" || state.plan.kind === "revisit") {
      state.status = state.plan.kind === "remove" ? "removed" : "revisit";
      this.order = this.order.filter((id) => id !== flight.stopId);
      this.metrics.tripsAvoided++;
    } else {
      state.status = "confirmed";
    }
    this.emit({ type: "call_result", at: this.now, stopId: flight.stopId, verified: true, note: state.note, plan: state.plan.kind });
    this.replan(`${state.stop.customer}: "${answer.quote_in_english || answer.customer_quote}"`);
  }

  private replan(because: string): void {
    const { from, time } = this.planningStart();
    const result = resequence({
      from,
      now: time,
      current: this.order.map((id) => this.input(id)),
      travel: this.options.travel,
    });
    if (result.changed) {
      this.emit({
        type: "reordered",
        at: this.now,
        before: result.current.order,
        after: result.best.order,
        savedMinutes: result.savedMinutes,
        because,
      });
      this.order = result.best.order;
    }
    this.emit({ type: "plan", at: this.now, order: [...this.order] });
  }

  /** Where and when the rider is next free to follow the remaining order. */
  private planningStart(): { from: string; time: number } {
    if (this.leg) return { from: this.leg.to, time: this.leg.arriveAt + this.state(this.leg.to).stop.serviceMinutes };
    return { from: this.at, time: Math.max(this.now, this.busyUntil) };
  }

  private finishIfDone(): void {
    if (this.order.length > 0 || this.leg || this.serving || this.inFlight || this.now < this.busyUntil) return;
    this.metrics.finishedAt = this.busyUntil;
    this.emit({ type: "day_done", at: this.busyUntil });
  }

  private input(id: string): RouteStopInput {
    const { stop, plan } = this.state(id);
    return {
      id,
      serviceMinutes: stop.serviceMinutes,
      earliest: plan.kind === "earliest" ? plan.at : null,
      windowEnd: stop.windowEnd,
    };
  }

  private describe(plan: StopPlan): string {
    const clock = (minutes: number) => minutesToClock(minutes, this.options.day.shiftStart);
    switch (plan.kind) {
      case "earliest":
        return plan.at <= this.now ? "ready now" : `ready around ${clock(plan.at)}`;
      case "revisit":
        return plan.at === null ? "revisit later today" : `revisit after ${clock(plan.at)}`;
      case "remove":
        return "not today: reschedule after dispatcher approval";
      case "no_change":
        return "no change";
    }
  }

  private state(id: string): StopState {
    const state = this.states.get(id);
    if (!state) throw new Error(`Unknown stop: ${id}`);
    return state;
  }

  private emit(event: EngineEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
  }
}

/** Runs a whole day as fast as possible. Only for scripted or call-free days, never live calls. */
export async function runDay(options: EngineOptions, step = 0.25, limitMinutes = 12 * 60): Promise<RouteEngine> {
  const engine = new RouteEngine(options);
  for (let now = 0; !engine.done && now <= limitMinutes; now += step) await engine.advance(now);
  return engine;
}
