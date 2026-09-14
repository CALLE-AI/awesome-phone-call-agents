import { pickNextCall } from "../core/callPicker.js";
import { gateCall, type GateResult } from "../core/evidence.js";
import { estimatedTravel, haversineMeters } from "../core/geo.js";
import { maskPhone } from "../core/phone.js";
import { planFromAnswer, type StopPlan } from "../core/readiness.js";
import { resequence, type RouteStopInput } from "../core/resequence.js";
import type { ReadinessAnswer, Stop } from "../core/types.js";
import { creationRefused, MAX_LIVE_CALL_MINUTES, type CallPort, type CallRequest, type LiveLine } from "../calle/ports.js";
import { maskPhonesInText } from "../core/redact.js";
import { buildReadinessTask } from "../calle/task.js";
import type { DestinationGuard, StopStatus } from "../engine/engine.js";

/** A stop the rider entered: a real customer, a real number and a point on the map. */
export interface FieldStop extends Stop {
  region: string;
  /** Cash to collect as the customer should hear it, for example "$25"; empty when prepaid. */
  cash: string;
}

export interface FieldSetup {
  merchant: string;
  language: string;
  /** A customer is called once the rider is this many minutes away. */
  callAheadMinutes: number;
  /** Average riding speed used for arrival estimates. */
  speedKmh: number;
  /** The call tells the person that no real parcel is coming. */
  testCall: boolean;
  /** The rider's clock, in minutes east of UTC, so named times like "13:30" mean the rider's local time. */
  utcOffsetMinutes: number;
  stops: FieldStop[];
  rider: { lat: number; lng: number };
  locationSource: "drag" | "gps";
}

export const RIDER_ID = "rider";
/** No call once the rider is less than this many minutes away: they are practically at the door. */
export const MIN_CALL_LEAD_MINUTES = 0.5;
/** The rider counts as at the door within this distance of the stop. */
export const AT_DOOR_METERS = 60;
/** How long each customer waits for their parcel counts a little, so ready customers are served first. */
export const FIELD_DELIVERY_WEIGHT = 0.1;
const CALL_HISTORY = 12;
const LOG_LIMIT = 80;

export interface FieldStopState {
  stop: FieldStop;
  status: StopStatus;
  plan: StopPlan;
  answer: ReadinessAnswer | null;
  called: boolean;
  note: string;
}

export interface FieldCallCard {
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

interface InFlight {
  stopId: string;
  callId: string;
  phone: string;
  promisedEta: number;
  startedAt: number;
  lastError: string;
}

/**
 * One rider's real route. Time is real time: minutes since the route started.
 * Arrival estimates come from the rider's reported position, a call goes out
 * when a customer is within the call-ahead window, and verified answers
 * re-order the remaining stops with the same gate and search as the demo day.
 */
export class FieldSession {
  readonly startedAt: number;
  readonly states = new Map<string, FieldStopState>();
  order: string[];
  rider: { lat: number; lng: number; accuracy: number | null; updatedAt: number };
  calls: FieldCallCard[] = [];
  log: { at: number; kind: string; text: string }[] = [];
  toast: { id: number; tone: "route" | "avoided"; title: string } | null = null;
  routeVersion = 0;
  endedReason: string | null = null;
  /** Set once no further call may start on this route, with the reason. */
  callsHalted: string | null = null;
  readonly metrics = { delivered: 0, nobodyHome: 0, tripsAvoided: 0, calls: 0 };
  private inFlight: InFlight | null = null;
  private ticking = false;
  private toastCount = 0;

  /**
   * @param runId public id sent to CALL-E in metadata and idempotency keys; never the session secret
   * @param clock milliseconds since the epoch; tests pass a fake clock
   * @param destinations one call per number per day across routes on this server
   */
  constructor(
    readonly runId: string,
    readonly setup: FieldSetup,
    private readonly port: CallPort,
    private readonly clock: () => number = Date.now,
    private readonly destinations?: DestinationGuard,
  ) {
    this.startedAt = clock();
    this.rider = { ...setup.rider, accuracy: null, updatedAt: this.startedAt };
    for (const stop of setup.stops) {
      this.states.set(stop.id, { stop, status: "planned", plan: { kind: "no_change" }, answer: null, called: false, note: "" });
    }
    const plan = resequence({
      from: RIDER_ID,
      now: 0,
      current: setup.stops.map((stop) => this.input(stop.id)),
      travel: this.travel(),
      deliveryWeight: FIELD_DELIVERY_WEIGHT,
    });
    this.order = plan.best.order;
    this.record("plan", `Route planned: ${this.order.map((id) => this.state(id).stop.customer).join(" -> ")}`);
  }

  get ended(): boolean {
    return this.endedReason !== null;
  }

  get finished(): boolean {
    return this.order.length === 0 && this.inFlight === null;
  }

  get lineBusy(): boolean {
    return this.inFlight !== null;
  }

  /** Minutes since the route started. */
  now(): number {
    return (this.clock() - this.startedAt) / 60_000;
  }

  /** Polls the call on the line, then starts the next call if one is due. Safe to call often. */
  async tick(): Promise<void> {
    if (this.ended || this.ticking) return;
    this.ticking = true;
    try {
      await this.pollCall();
      await this.startCallIfDue();
    } finally {
      this.ticking = false;
    }
  }

  moveRider(lat: number, lng: number, accuracy: number | null = null): void {
    this.rider = { lat, lng, accuracy, updatedAt: this.clock() };
  }

  /** The rider handed over the parcel, or found nobody at the door. */
  finishStop(stopId: string, outcome: "delivered" | "nobody_home"): void {
    if (!this.order.includes(stopId)) throw new Error("That stop is not on the route any more.");
    const state = this.state(stopId);
    this.order = this.order.filter((id) => id !== stopId);
    if (outcome === "delivered") {
      state.status = "delivered";
      this.metrics.delivered++;
      this.record("delivered", `Delivered to ${state.stop.customer}`);
    } else {
      state.status = "failed";
      this.metrics.nobodyHome++;
      this.record("failed_attempt", `Nobody home at ${state.stop.customer}`);
    }
    if (this.order.length > 0) this.replan(null);
    else this.record("day_done", "Route finished");
  }

  end(reason: string): void {
    if (!this.ended) this.endedReason = reason;
  }

  /** Expected arrival (minutes since start) at every remaining stop in the current order. */
  etas(): Map<string, number> {
    const travel = this.travel();
    const etas = new Map<string, number>();
    let from = RIDER_ID;
    let time = this.now();
    for (const id of this.order) {
      const { stop, plan } = this.state(id);
      time += travel.minutes(from, id);
      etas.set(id, time);
      if (plan.kind === "earliest") time = Math.max(time, plan.at);
      time += stop.serviceMinutes;
      from = id;
    }
    return etas;
  }

  /** The stop the rider is standing at, if they are within AT_DOOR_METERS of the next stop. */
  doorStopId(): string | null {
    const next = this.order[0];
    if (!next) return null;
    return haversineMeters(this.rider, this.state(next).stop) <= AT_DOOR_METERS ? next : null;
  }

  /** Local clock "HH:MM" for a time in epoch milliseconds, on the rider's clock. */
  localClock(ms: number): string {
    return new Date(ms + this.setup.utcOffsetMinutes * 60_000).toISOString().slice(11, 16);
  }

  private async startCallIfDue(): Promise<void> {
    if (this.inFlight || this.callsHalted || this.order.length === 0) return;
    const now = this.now();
    const etas = this.etas();
    const candidates = this.order.map((id) => ({ stop: this.state(id).stop, eta: etas.get(id) ?? Infinity, called: this.state(id).called }));
    const pick = pickNextCall(now, candidates, false, { min: MIN_CALL_LEAD_MINUTES, max: this.setup.callAheadMinutes });
    if (!pick) return;

    const state = this.state(pick.stopId);
    const { stop } = state;
    const minutesAway = Math.max(1, Math.round(pick.eta - now));
    state.called = true;
    if (this.destinations && !this.destinations.allowed(stop.phone)) {
      state.status = "unverified";
      state.note = "number already called today; not called again";
      this.record("call_error", `${stop.customer}: ${state.note}`);
      return;
    }
    // Recorded before the request, so an ambiguous creation still counts as today's call.
    this.destinations?.record(stop.phone);
    state.status = "calling";
    const request: CallRequest = {
      stopId: stop.id,
      phone: stop.phone,
      region: stop.region,
      task: buildReadinessTask({
        merchant: this.setup.merchant,
        orderRef: stop.order,
        etaMinutes: minutesAway,
        codAmount: stop.cash || null,
        language: this.setup.language,
        testCall: this.setup.testCall,
      }),
      etaMinutes: pick.eta - now,
      idempotencyKey: `routeready:${this.runId}:${stop.id}`,
      metadata: { run_id: this.runId, stop_id: stop.id },
    };
    const card: FieldCallCard = {
      stopId: stop.id,
      customer: stop.customer,
      live: this.port.mode === "live",
      maskedPhone: maskPhone(stop.phone),
      reason: `rider about ${minutesAway} min away`,
      startedAt: this.localClock(this.clock()),
      lines: [],
      result: null,
      verified: null,
    };
    this.calls.unshift(card);
    this.calls.length = Math.min(this.calls.length, CALL_HISTORY);
    this.record("call_started", `Calling ${stop.customer} (${card.reason})`);
    try {
      const { callId } = await this.port.start(request, now);
      this.inFlight = { stopId: stop.id, callId, phone: stop.phone, promisedEta: pick.eta, startedAt: now, lastError: "" };
      this.metrics.calls++;
    } catch (error) {
      const message = maskPhonesInText((error as Error).message);
      state.status = "unverified";
      card.verified = false;
      if (creationRefused(error)) {
        state.note = "CALL-E refused the call; never redialled";
        card.result = `CALL-E refused the call: ${message}`;
        this.record("call_error", `${stop.customer}: CALL-E refused the call (${message})`);
        return;
      }
      // The call may or may not exist, so nobody else is called while it might be ringing.
      state.note = "call not confirmed; calls stopped";
      card.result = `CALL-E did not confirm the call: ${message}`;
      this.record("call_error", `${stop.customer}: CALL-E did not confirm the call (${message})`);
      this.halt(`CALL-E did not confirm whether the call to ${stop.customer} was placed`);
    }
  }

  private async pollCall(): Promise<void> {
    const flight = this.inFlight;
    if (!flight) return;
    const card = this.calls.find((candidate) => candidate.stopId === flight.stopId && candidate.result === null);
    let update: Awaited<ReturnType<CallPort["poll"]>>;
    try {
      update = await this.port.poll(flight.callId, this.now());
    } catch (error) {
      const message = maskPhonesInText((error as Error).message);
      if (message !== flight.lastError) this.record("call_error", `Status check failed, retrying: ${message}`);
      flight.lastError = message;
      this.haltIfOverdue(flight);
      return;
    }
    if (card) for (const line of update.lines) addLine(card.lines, line);
    if (!update.final) {
      this.haltIfOverdue(flight);
      return;
    }
    this.inFlight = null;
    this.applyResult(flight, gateCall(update.final, flight.phone), card);
  }

  /** A live call still not finished keeps the line busy and stops the queue; it is never treated as over. */
  private haltIfOverdue(flight: InFlight): void {
    if (this.port.mode !== "live" || this.now() - flight.startedAt < MAX_LIVE_CALL_MINUTES) return;
    this.halt(`the call to ${this.state(flight.stopId).stop.customer} has not finished after ${MAX_LIVE_CALL_MINUTES} minutes`);
  }

  private halt(reason: string): void {
    if (this.callsHalted) return;
    this.callsHalted = reason;
    this.record("calls_halted", `Calls stopped on this route: ${reason}. Check the call in the CALL-E dashboard before calling anyone else.`);
    this.showToast("avoided", "Calls stopped on this route");
  }

  private applyResult(flight: InFlight, gate: GateResult, card: FieldCallCard | undefined): void {
    const state = this.state(flight.stopId);
    const { customer } = state.stop;
    state.answer = gate.answer;
    const stillAhead = this.order.includes(flight.stopId);
    if (!gate.verified || !stillAhead) {
      if (stillAhead) state.status = "unverified";
      state.note = gate.verified ? "answer arrived after the stop was finished" : gate.reason;
      if (card) {
        card.result = maskPhonesInText(state.note);
        card.verified = false;
      }
      this.record("call_result", `${customer}: unverified, route unchanged (${state.note})`);
      return;
    }

    const { answer } = gate;
    const now = this.now();
    state.plan = planFromAnswer(answer.readiness, flight.promisedEta, now, this.statedTime(answer.ready_clock_time));
    state.note = this.describe(state.plan);
    if (card) {
      card.result = state.note;
      card.verified = true;
    }
    this.record("call_result", `${customer}: ${state.note} ("${answer.quote_in_english || answer.customer_quote}")`);
    if (state.plan.kind === "remove" || state.plan.kind === "revisit") {
      state.status = state.plan.kind === "remove" ? "removed" : "revisit";
      this.order = this.order.filter((id) => id !== flight.stopId);
      this.metrics.tripsAvoided++;
      this.showToast("avoided", `${customer}: ${state.note}, trip avoided`);
    } else {
      state.status = "confirmed";
    }
    this.replan(`${customer}: ${state.note}`);
  }

  private replan(because: string | null): void {
    if (this.order.length === 0) return;
    const result = resequence({
      from: RIDER_ID,
      now: this.now(),
      current: this.order.map((id) => this.input(id)),
      travel: this.travel(),
      deliveryWeight: FIELD_DELIVERY_WEIGHT,
    });
    if (!result.changed) return;
    this.order = result.best.order;
    this.routeVersion++;
    const saved = Math.max(1, Math.round(result.savedMinutes));
    this.record("reordered", `Re-ordered, saves ${saved} min: ${this.order.map((id) => this.state(id).stop.customer).join(" -> ")}`);
    this.showToast("route", `${because ?? "Route updated"} · saves ${saved} min`);
  }

  /** A clock time the customer named, as minutes since start on the rider's clock; null when empty or already past. */
  private statedTime(clock: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    const named = Number(match[1]) * 60 + Number(match[2]);
    const nowLocal = ((this.clock() / 60_000 + this.setup.utcOffsetMinutes) % 1440 + 1440) % 1440;
    const ahead = named - nowLocal;
    return ahead < -5 ? null : this.now() + Math.max(0, ahead);
  }

  private describe(plan: StopPlan): string {
    const clockAt = (minutes: number) => this.localClock(this.startedAt + minutes * 60_000);
    switch (plan.kind) {
      case "earliest":
        return plan.at <= this.now() + 0.5 ? "ready now" : `ready around ${clockAt(plan.at)}`;
      case "revisit":
        return plan.at === null ? "revisit later today" : `revisit after ${clockAt(plan.at)}`;
      case "remove":
        return "not today";
      case "no_change":
        return "no change";
    }
  }

  private travel() {
    return estimatedTravel([{ id: RIDER_ID, lat: this.rider.lat, lng: this.rider.lng }, ...this.setup.stops], this.setup.speedKmh);
  }

  private input(id: string): RouteStopInput {
    const { stop, plan } = this.state(id);
    return { id, serviceMinutes: stop.serviceMinutes, earliest: plan.kind === "earliest" ? plan.at : null, windowEnd: stop.windowEnd };
  }

  private state(id: string): FieldStopState {
    const state = this.states.get(id);
    if (!state) throw new Error(`Unknown stop: ${id}`);
    return state;
  }

  private showToast(tone: "route" | "avoided", title: string): void {
    this.toast = { id: ++this.toastCount, tone, title };
  }

  private record(kind: string, text: string): void {
    this.log.push({ at: this.clock(), kind, text: maskPhonesInText(text) });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }
}

/** Joins a streamed transcript line onto the card the way CALL-E sends it. */
function addLine(lines: FieldCallCard["lines"], line: LiveLine): void {
  const last = lines.at(-1);
  if (last && last.speaker === line.speaker && line.merge === "replace") last.text = line.text;
  else if (last && last.speaker === line.speaker && line.merge === "append") last.text = `${last.text} ${line.text}`;
  else lines.push({ speaker: line.speaker, text: line.text });
}
