import { randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CallGateway, PlanCheck, Planner } from "./calle.ts";
import { findBooking, findFlight, type Catalog } from "./data.ts";
import {
  airlineRefundAmount,
  buildAirlineRefundResultSchema,
  buildAirlineRefundTask,
  buildAirlineResultSchema,
  buildAirlineTask,
  decideAirline,
  decideAirlineRefund,
} from "./airline.ts";
import { buildCallbackResultSchema, buildCallbackTask, decideCallback } from "./callback.ts";
import { decide } from "./decide.ts";
import { checkEligibility } from "./eligibility.ts";
import { buildIntakeResultSchema, buildIntakeTask, decideIntake } from "./intake.ts";
import { NOT_FOUND_REPLY, passengerMatches, replyFor, type ChannelMessage, type ChannelNotifier } from "./channel.ts";
import type { OpsEvent } from "./events.ts";
import { addMinutes, idr, localTime } from "./format.ts";
import { maskPhone, routeFor } from "./phone.ts";
import { redactOutcome, redactText } from "./redact.ts";
import { airlineOf, quoteFor, voluntaryQuoteFor } from "./rules.ts";
import { buildResultSchema, buildTask } from "./task.ts";
import type { Action, AirlineCall, BookingState, CallOutcome, ChannelMessageRecord, ChannelUpdate, Decision, Disruption, DisruptionCause, DisruptionKind, DisruptionSource, LedgerEntry, OpsEventRecord, OpsEventVia, Quote, RequestChannel, RequestEntry, RequestKind } from "./types.ts";

interface DeskState {
  disruptions: Disruption[];
  ledger: Record<string, LedgerEntry>;
  requests: Record<string, RequestEntry>;
  /** Airline ops webhook deliveries by event id. */
  opsEvents: Record<string, OpsEventRecord>;
  /** Where the airline feed poller resumes. Kept across restarts so no event is missed or re-read. */
  feedCursor: string | null;
  /** Chat, web form, and phone line messages by message id. */
  channelMessages: Record<string, ChannelMessageRecord>;
  bookings: Record<string, BookingState>;
  seats: Record<string, number>;
  liveCallsUsed: number;
  /**
   * New on every reset. Part of every idempotency key, so a call placed after "Reset demo"
   * is a new call to CALL-E rather than a replay of the one before the reset.
   */
  runId: string;
}

export interface DeskOptions {
  /** Where state is persisted so call ids survive a restart. null = memory only. */
  statePath: string | null;
  /** Live modes redirect every call to this one number. */
  liveDemoPhone?: string;
  liveCallBudget: number;
  now?: () => number;
  /** Asks CALL-E to plan a call without running it (the "Check with CALL-E" button). */
  planner?: Planner;
  /** The number plan checks name. Planning never dials it. */
  planPhone?: string;
  /** Clock for passenger request cutoffs only. Defaults to `now`. */
  demoNow?: () => number;
  /** Pushes later request updates to the passenger's channel. Without it, updates are only recorded. */
  channelNotifier?: ChannelNotifier;
}

export interface DisruptionInput {
  flightId: string;
  kind: DisruptionKind;
  cause: DisruptionCause;
  /** Ignored for a cancellation. */
  delayMinutes: number;
  reason: string;
  source?: DisruptionSource;
}

export class DeskError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const PNR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newPnr(): string {
  return Array.from({ length: 6 }, () => PNR_ALPHABET[randomInt(PNR_ALPHABET.length)]).join("");
}

function newRunId(): string {
  return randomBytes(4).toString("hex");
}

function newTicket(): string {
  return `000-24${String(randomInt(10_000_000, 99_999_999))}`;
}

export class Desk {
  private state: DeskState;
  private readonly now: () => number;
  /** Calls whose status check is running. Overlapping polls (two tabs, slow CALL-E) wait their turn. */
  private readonly polling = new Set<string>();

  /** Runs one status check per call at a time; a concurrent caller gets the current state instead. */
  private async pollOnce<T>(lock: string, current: T, poll: () => Promise<T>): Promise<T> {
    if (this.polling.has(lock)) return current;
    this.polling.add(lock);
    try {
      return await poll();
    } finally {
      this.polling.delete(lock);
    }
  }

  constructor(
    private readonly catalog: Catalog,
    private readonly gateway: CallGateway,
    private readonly options: DeskOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.state = this.load() ?? this.initialState();
    if (gateway.live) {
      if (!options.liveDemoPhone) throw new Error("Live mode needs LIVE_DEMO_PHONE: the one number live calls may reach.");
      const route = routeFor(options.liveDemoPhone);
      if (!route.ok) throw new Error(`LIVE_DEMO_PHONE rejected: ${route.reason}`);
    }
  }

  // ------------------------------------------------------------ state

  private initialState(): DeskState {
    const bookings: Record<string, BookingState> = {};
    for (const b of this.catalog.bookings) {
      bookings[b.pnr] = {
        pnr: b.pnr,
        status: "ticketed",
        flightId: b.flightId,
        currentPnr: b.pnr,
        ticket: b.ticket,
        charges: [],
        refundAmount: null,
        notes: [],
      };
    }
    const seats: Record<string, number> = {};
    for (const f of this.catalog.flights) seats[f.id] = f.seatsAvailable;
    return { disruptions: [], ledger: {}, requests: {}, opsEvents: {}, feedCursor: null, channelMessages: {}, bookings, seats, liveCallsUsed: 0, runId: newRunId() };
  }

  private load(): DeskState | null {
    const path = this.options.statePath;
    if (!path || !existsSync(path)) return null;
    const state = JSON.parse(readFileSync(path, "utf8")) as DeskState;
    state.requests ??= {};
    state.opsEvents ??= {};
    state.feedCursor ??= null;
    state.channelMessages ??= {};
    for (const r of Object.values(state.opsEvents)) r.via ??= "webhook";
    state.runId ??= newRunId();
    // Provider text saved by an older version may be unmasked.
    for (const e of Object.values(state.ledger)) {
      if (e.outcome) e.outcome = redactOutcome(e.outcome);
      e.error = redactText(e.error);
    }
    for (const r of Object.values(state.requests)) {
      for (const call of [r.airlineCall, r.callback]) {
        if (!call) continue;
        if (call.outcome) call.outcome = redactOutcome(call.outcome);
        call.error = redactText(call.error);
      }
    }
    // State saved before cancellations existed only held operator-reported delays.
    for (const d of state.disruptions) {
      d.kind ??= "delay";
      d.cause ??= "operational";
      d.source ??= { kind: "manual" };
    }
    return state;
  }

  private save(): void {
    const path = this.options.statePath;
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
  }

  reset(): void {
    const inFlight =
      Object.values(this.state.ledger).some((e) => e.status === "in_progress" || e.status === "submitted") ||
      Object.values(this.state.requests).some(
        (r) => r.status === "passenger_call_in_progress" || r.status === "airline_call_in_progress" || r.callback?.status === "in_progress",
      );
    if (inFlight && this.gateway.live) {
      throw new DeskError("A live call is still in progress. Wait for it to finish before resetting.", 409);
    }
    const used = this.state.liveCallsUsed;
    this.state = this.initialState();
    this.state.liveCallsUsed = used;
    this.save();
  }

  /** Current catalog with live seat counts. */
  private view(): Catalog {
    return {
      ...this.catalog,
      flights: this.catalog.flights.map((f) => ({ ...f, seatsAvailable: this.state.seats[f.id] ?? 0 })),
    };
  }

  private disruption(id: string): Disruption {
    const d = this.state.disruptions.find((x) => x.id === id);
    if (!d) throw new DeskError(`Unknown disruption ${id}`, 404);
    return d;
  }

  private entry(key: string): LedgerEntry {
    const e = this.state.ledger[key];
    if (!e) throw new DeskError(`Unknown call ${key}`, 404);
    return e;
  }

  // ------------------------------------------------------------ disruptions

  /** The flight's current disruption. Superseded ones stay in history but no longer drive calls. */
  private activeDisruption(flightId: string): Disruption | undefined {
    return this.state.disruptions.find((d) => d.flightId === flightId && !d.supersededBy);
  }

  /**
   * A disruption can only get worse automatically: a delay can become a longer delay or a
   * cancellation. Anything else (a shorter delay, a cancelled flight reinstated) needs a person.
   */
  private escalates(existing: Disruption, kind: DisruptionKind, delayMinutes: number): boolean {
    if (existing.kind !== "delay") return false;
    return kind === "cancellation" || delayMinutes > existing.delayMinutes;
  }

  reportDelay(flightId: string, delayMinutes: number, reason: string, cause: DisruptionCause = "operational"): Disruption {
    return this.reportDisruption({ flightId, kind: "delay", cause, delayMinutes, reason });
  }

  reportCancellation(flightId: string, reason: string, cause: DisruptionCause = "operational"): Disruption {
    return this.reportDisruption({ flightId, kind: "cancellation", cause, delayMinutes: 0, reason });
  }

  /**
   * Records a flight's disruption, whether an operator typed it or the airline pushed it.
   * If the flight already has a delay and this is worse, it replaces that delay: see supersede.
   */
  reportDisruption(input: DisruptionInput): Disruption {
    const { flightId, kind, cause } = input;
    const flight = this.catalog.flights.find((f) => f.id === flightId);
    if (!flight) throw new DeskError(`Unknown flight ${flightId}`, 404);
    if (kind !== "delay" && kind !== "cancellation") throw new DeskError('kind must be "delay" or "cancellation".');
    if (cause !== "operational" && cause !== "force_majeure") throw new DeskError('cause must be "operational" or "force_majeure".');
    const delayMinutes = kind === "delay" ? input.delayMinutes : 0;
    if (kind === "delay" && (!Number.isInteger(delayMinutes) || delayMinutes < 15 || delayMinutes > 24 * 60)) {
      throw new DeskError("Delay must be a whole number of minutes between 15 and 1440.");
    }
    const existing = this.activeDisruption(flightId);
    if (existing && !this.escalates(existing, kind, delayMinutes)) {
      const what = existing.kind === "delay" ? `delay of ${existing.delayMinutes} minutes` : existing.kind;
      throw new DeskError(
        `${flight.code} already has a reported ${what}. Only a longer delay or a cancellation can replace it automatically.`,
        409,
      );
    }
    if (!this.catalog.bookings.some((b) => b.flightId === flightId)) {
      throw new DeskError(`${flight.code} has no bookings in this demo.`);
    }
    const suffix = kind === "cancellation" ? "cancelled" : String(delayMinutes);
    const baseId = `evt_${flightId}_${cause === "force_majeure" ? "fm_" : ""}${suffix}`;
    let id = baseId;
    for (let n = 2; this.state.disruptions.some((d) => d.id === id); n += 1) id = `${baseId}_${n}`;
    const disruption: Disruption = {
      id,
      flightId,
      kind,
      cause,
      delayMinutes,
      reason: input.reason.trim() || (cause === "force_majeure" ? "conditions outside the airline's control" : "an operational issue"),
      newDeparture: kind === "delay" ? addMinutes(flight.departure, delayMinutes) : null,
      source: input.source ?? { kind: "manual" },
      createdAt: new Date(this.now()).toISOString(),
      ...(existing ? { supersedes: existing.id } : {}),
    };
    this.state.disruptions.push(disruption);
    if (existing) this.supersede(existing, disruption);
    this.save();
    return disruption;
  }

  /**
   * The earlier delay's calls quoted options that no longer exist (a later departure to
   * keep, or voluntary prices). Nothing already rebooked or refunded is touched. Passengers
   * who agreed to keep the delayed flight are put back in the queue to be called again,
   * and calls still in flight or waiting for review can no longer apply their old choice.
   */
  private supersede(old: Disruption, next: Disruption): void {
    old.supersededBy = next.id;
    const why =
      next.kind === "cancellation"
        ? `The flight was cancelled after this call (${next.id}).`
        : `The delay grew to ${next.delayMinutes} minutes after this call (${next.id}).`;
    for (const entry of Object.values(this.state.ledger)) {
      if (entry.disruptionId !== old.id) continue;
      const booking = this.state.bookings[entry.pnr];
      if (entry.status === "applied" || entry.status === "resolved_by_human") {
        if (booking?.status === "kept_on_delayed_flight" && booking.flightId === old.flightId) {
          booking.status = "ticketed";
          booking.notes.push(`${why} The passenger had kept the delayed flight, so they must be called again with new options.`);
          entry.applied = `${entry.applied ?? ""} Superseded: ${why} Call again under the new disruption.`.trim();
        }
        continue;
      }
      if (entry.status === "needs_review") {
        entry.decision = { kind: "review", reasons: [why, "Close this item and call the passenger again under the new disruption."] };
      }
      // in_progress, submitted, and uncertain calls finish into review; see refresh.
    }
  }

  /**
   * Records a disruption pushed by the airline ops system. Each event id is processed
   * once: a retried delivery returns the first result and changes nothing. Events never
   * start calls; an operator still reviews the priced options and calls passengers.
   */
  receiveOpsEvent(event: OpsEvent, via: OpsEventVia = "webhook"): { record: OpsEventRecord; duplicate: boolean } {
    const seen = this.state.opsEvents[event.eventId];
    if (seen) return { record: seen, duplicate: true };

    const record: OpsEventRecord = {
      eventId: event.eventId,
      via,
      type: event.type,
      flightId: event.flightId,
      receivedAt: new Date(this.now()).toISOString(),
      occurredAt: event.occurredAt,
      status: "created",
      disruptionId: null,
      message: "",
    };
    const existing = this.activeDisruption(event.flightId);
    const same =
      existing && existing.kind === event.kind && existing.cause === event.cause && existing.delayMinutes === event.delayMinutes;
    if (existing && (same || !this.escalates(existing, event.kind, event.delayMinutes))) {
      record.status = "conflict";
      record.disruptionId = existing.id;
      record.message = same
        ? `Same ${existing.kind} as ${existing.id}, already recorded. Nothing changed.`
        : `Flight already has ${existing.id} (${existing.kind}). This ${event.kind} does not make it worse, so it was not applied automatically: calls may already quote the current options. Check with the airline, then handle affected passengers by hand.`;
    } else {
      try {
        const disruption = this.reportDisruption({
          flightId: event.flightId,
          kind: event.kind,
          cause: event.cause,
          delayMinutes: event.delayMinutes,
          reason: event.reason,
          source: { kind: via === "feed" ? "airline_feed" : "airline_webhook", eventId: event.eventId, receivedAt: record.receivedAt },
        });
        record.disruptionId = disruption.id;
        if (disruption.supersedes) {
          record.status = "escalated";
          record.message = `Recorded ${disruption.id}, replacing ${disruption.supersedes}. Passengers who kept the delayed flight must be called again.`;
        } else {
          record.message = `Recorded ${disruption.id}.`;
        }
      } catch (error) {
        record.status = "rejected";
        record.message = error instanceof Error ? error.message : String(error);
      }
    }
    this.state.opsEvents[event.eventId] = record;
    this.save();
    return { record, duplicate: false };
  }

  get feedCursor(): string | null {
    return this.state.feedCursor;
  }

  /** Called by the feed poller after a page is fully processed. */
  saveFeedCursor(cursor: string | null): void {
    this.state.feedCursor = cursor;
    this.save();
  }

  quote(disruptionId: string, pnr: string): Quote {
    const disruption = this.disruption(disruptionId);
    const booking = findBooking(this.catalog, pnr);
    if (booking.flightId !== disruption.flightId) throw new DeskError(`${pnr} is not on the disrupted flight.`);
    return quoteFor(this.view(), booking, disruption);
  }

  // ------------------------------------------------------------ calls

  private destinationFor(pnr: string): { phone: string; redirected: boolean } {
    return this.route(findBooking(this.catalog, pnr).phone);
  }

  /** Live modes send every call, passenger or airline desk, to the one demo number. */
  private route(fixturePhone: string): { phone: string; redirected: boolean } {
    if (this.gateway.live) return { phone: this.options.liveDemoPhone as string, redirected: true };
    return { phone: fixturePhone, redirected: false };
  }

  /** Typed confirmation and budget checks shared by every live call. */
  private guardLiveCall(phone: string, confirmLast4?: string): void {
    if (!this.gateway.live) return;
    if (confirmLast4 !== phone.slice(-4)) {
      throw new DeskError("Type the last 4 digits of the destination number to confirm this real call.");
    }
    if (this.state.liveCallsUsed >= this.options.liveCallBudget) {
      throw new DeskError(`Live call budget of ${this.options.liveCallBudget} is used up for this server run.`, 429);
    }
  }

  preview(disruptionId: string, pnr: string) {
    const disruption = this.disruption(disruptionId);
    const booking = findBooking(this.catalog, pnr);
    const quote = this.quote(disruptionId, pnr);
    const { phone, redirected } = this.destinationFor(pnr);
    const route = routeFor(phone);
    return {
      key: `${disruptionId}:${pnr}`,
      mode: this.gateway.mode,
      live: this.gateway.live,
      destinationMasked: maskPhone(phone),
      redirected,
      blockedReason: route.ok ? null : route.reason,
      region: route.ok ? route.region : null,
      task: buildTask(this.catalog, booking, disruption, quote),
      resultSchema: buildResultSchema(quote),
      quote,
      existing: this.state.ledger[`${disruptionId}:${pnr}`] ?? null,
      liveBudgetLeft: this.options.liveCallBudget - this.state.liveCallsUsed,
    };
  }

  async startCall(disruptionId: string, pnr: string, confirmLast4?: string): Promise<LedgerEntry> {
    const key = `${disruptionId}:${pnr}`;
    const previous = this.state.ledger[key];
    if (previous && previous.status !== "failed_to_submit") {
      throw new DeskError(`${pnr} was already called for this delay (${previous.status}). One call per booking per event.`, 409);
    }
    const disruption = this.disruption(disruptionId);
    if (disruption.supersededBy) {
      throw new DeskError(`${disruptionId} was replaced by ${disruption.supersededBy}. Call from the new disruption.`, 409);
    }
    const booking = findBooking(this.catalog, pnr);
    if (this.state.bookings[pnr]?.status !== "ticketed") {
      throw new DeskError(`${pnr} has already been handled.`, 409);
    }
    const { phone, redirected } = this.destinationFor(pnr);
    const route = routeFor(phone);
    if (!route.ok) throw new DeskError(route.reason);
    this.guardLiveCall(phone, confirmLast4);

    const quote = quoteFor(this.view(), booking, disruption);
    const task = buildTask(this.catalog, booking, disruption, quote);
    const idempotencyKey = `fda-${this.state.runId}-${disruptionId}-${pnr}`.replace(/[^A-Za-z0-9_-]/g, "_");
    const entry: LedgerEntry = {
      key,
      disruptionId,
      pnr,
      mode: this.gateway.mode,
      destinationMasked: maskPhone(phone),
      redirected,
      idempotencyKey,
      quote,
      task,
      callId: null,
      status: "submitted",
      submittedAt: new Date(this.now()).toISOString(),
      nextPollAt: new Date(this.now()).toISOString(),
      outcome: null,
      decision: null,
      applied: null,
      error: null,
    };
    // Record intent before dialing so a crash never loses track of a call.
    this.state.ledger[key] = entry;
    this.save();

    const result = await this.gateway.start({
      task,
      phone,
      region: route.region,
      locale: route.locale,
      resultSchema: buildResultSchema(quote),
      metadata: { disruption_id: disruptionId, pnr, dedupe_key: key },
      idempotencyKey,
      simulation: { kind: "passenger", booking, quote },
    });

    if (result.kind === "started") {
      entry.callId = result.callId;
      entry.status = "in_progress";
      entry.nextPollAt = new Date(this.now() + this.gateway.firstPollSeconds * 1000).toISOString();
    } else if (result.kind === "uncertain") {
      entry.status = "uncertain";
      entry.error = redactText(result.message);
    } else {
      entry.status = "failed_to_submit";
      entry.error = redactText(result.message);
    }
    if (this.gateway.live && result.kind !== "rejected") this.state.liveCallsUsed += 1;
    this.save();
    return entry;
  }

  /** Polls one call if it is due. Safe to call as often as you like. */
  async refresh(key: string): Promise<LedgerEntry> {
    const entry = this.entry(key);
    return this.pollOnce(`passenger:${key}`, entry, () => this.refreshUnlocked(entry));
  }

  private async refreshUnlocked(entry: LedgerEntry): Promise<LedgerEntry> {
    if (entry.status !== "in_progress" || !entry.callId) return entry;
    if (this.now() < new Date(entry.nextPollAt).getTime()) return entry;

    const outcome = redactOutcome(await this.gateway.get(entry.callId));
    entry.outcome = outcome;
    if (outcome.state === "in_progress") {
      entry.nextPollAt = new Date(this.now() + this.gateway.pollSeconds * 1000).toISOString();
      this.save();
      return entry;
    }

    const replacedBy = this.disruption(entry.disruptionId).supersededBy;
    const decision: Decision = replacedBy
      ? { kind: "review", reasons: [`This call quoted options from ${entry.disruptionId}, which was replaced by ${replacedBy}. Close it and call the passenger again.`] }
      : decide(outcome, entry.quote);
    entry.decision = decision;
    if (decision.kind === "apply") {
      try {
        entry.applied = this.apply(entry, decision.action);
        entry.status = "applied";
      } catch (error) {
        entry.decision = { kind: "review", reasons: [error instanceof Error ? error.message : String(error)] };
        entry.status = "needs_review";
      }
    } else {
      entry.status = "needs_review";
    }
    this.save();
    return entry;
  }

  async refreshAll(): Promise<void> {
    for (const entry of Object.values(this.state.ledger)) {
      if (entry.status === "in_progress") await this.refresh(entry.key);
    }
    for (const entry of Object.values(this.state.requests)) {
      if (entry.status === "passenger_call_in_progress") await this.refreshPassengerCall(entry.request.id);
      if (entry.status === "airline_call_in_progress") await this.refreshRequest(entry.request.id);
      if (entry.callback?.status === "in_progress") await this.refreshCallback(entry.request.id);
    }
  }

  /** A person closes a review item, with or without changing the booking. */
  resolve(key: string, action: Action | null, note: string): LedgerEntry {
    const entry = this.entry(key);
    if (entry.status !== "needs_review" && entry.status !== "uncertain") {
      throw new DeskError(`This call is ${entry.status}; only review items can be resolved.`, 409);
    }
    const replacedBy = this.disruption(entry.disruptionId).supersededBy;
    if (action && replacedBy) {
      throw new DeskError(`The options on this call are out of date: ${entry.disruptionId} was replaced by ${replacedBy}. Close it without a change and call again.`, 409);
    }
    const text = note.trim();
    try {
      entry.applied = action ? this.apply(entry, action) : "Closed without changing the booking.";
    } catch (error) {
      throw new DeskError(error instanceof Error ? error.message : String(error), 409);
    }
    if (text) this.state.bookings[entry.pnr]?.notes.push(`Agent note: ${text}`);
    entry.status = "resolved_by_human";
    this.save();
    return entry;
  }

  // ------------------------------------------------------------ passenger requests (Workflow B)

  private requestEntry(id: string): RequestEntry {
    const r = this.state.requests[id];
    if (!r) throw new DeskError(`Unknown request ${id}`, 404);
    return r;
  }

  /**
   * Step 1: a passenger asks to change a booking through chat, the web form, or the phone line.
   * The desk checks eligibility and prices every option; CALL-E then calls the passenger.
   */
  submitRequest(
    pnr: string,
    kind: RequestKind,
    targetFlightId: string | null,
    channel: RequestChannel,
    conversation?: { channel: RequestChannel; id: string },
  ): RequestEntry {
    if (kind !== "reschedule" && kind !== "refund" && kind !== "change") {
      throw new DeskError('kind must be "reschedule", "refund", or "change".');
    }
    if (!["chat", "web_form", "phone"].includes(channel)) throw new DeskError('channel must be "chat", "web_form", or "phone".');
    const booking = this.catalog.bookings.find((b) => b.pnr === pnr);
    if (!booking) throw new DeskError(`Unknown booking ${pnr}`, 404);
    const open = Object.values(this.state.requests).find(
      (r) => r.request.pnr === pnr && !["ineligible", "declined", "completed", "resolved_by_human"].includes(r.status),
    );
    if (open) throw new DeskError(`${pnr} already has an open request (${open.status}).`, 409);

    const id = `req_${pnr}_${Object.values(this.state.requests).filter((r) => r.request.pnr === pnr).length + 1}`;
    const request = {
      id,
      pnr,
      kind,
      targetFlightId: targetFlightId || null,
      channel,
      createdAt: new Date(this.now()).toISOString(),
      ...(conversation ? { conversation } : {}),
    };
    const quote = voluntaryQuoteFor(this.view(), booking);
    const eligibility = checkEligibility({
      catalog: this.view(),
      booking,
      state: this.state.bookings[pnr],
      request,
      quote,
      disrupted: Boolean(this.activeDisruption(booking.flightId)),
      now: (this.options.demoNow ?? this.now)(),
    });
    const entry: RequestEntry = {
      request,
      eligibility,
      quote,
      action: null,
      amount: null,
      status: eligibility.eligible ? "awaiting_call" : "ineligible",
      confirmedAt: null,
      passengerCall: null,
      airlineCall: null,
      reviewReasons: [],
      applied: null,
      callback: null,
      callbackVerdict: null,
    };
    this.state.requests[id] = entry;
    this.save();
    return entry;
  }

  private passengerCallContext(id: string) {
    const entry = this.requestEntry(id);
    const booking = findBooking(this.catalog, entry.request.pnr);
    const destination = this.route(booking.phone);
    const task = buildIntakeTask(this.catalog, booking, entry.request, entry.quote);
    return { entry, booking, destination, task, resultSchema: buildIntakeResultSchema(entry.quote) };
  }

  previewPassengerCall(id: string) {
    const { entry, destination, task, resultSchema } = this.passengerCallContext(id);
    const route = routeFor(destination.phone);
    return {
      id,
      mode: this.gateway.mode,
      live: this.gateway.live,
      destinationMasked: maskPhone(destination.phone),
      redirected: destination.redirected,
      blockedReason: route.ok ? null : route.reason,
      task,
      resultSchema,
      existing: entry.passengerCall,
      liveBudgetLeft: this.options.liveCallBudget - this.state.liveCallsUsed,
    };
  }

  /**
   * Step 2: CALL-E calls the passenger, offers every priced option, and records their choice
   * and consent. Nothing is sent to the airline until this call ends. One call per request.
   */
  async callPassengerForRequest(id: string, confirmLast4?: string): Promise<RequestEntry> {
    const { entry, booking, destination, task, resultSchema } = this.passengerCallContext(id);
    if (entry.status !== "awaiting_call") {
      throw new DeskError(`This request is ${entry.status}; CALL-E calls the passenger at most once per request.`, 409);
    }
    if (entry.passengerCall && entry.passengerCall.status !== "failed_to_submit") {
      throw new DeskError(`The passenger was already called for this request (${entry.passengerCall.status}).`, 409);
    }
    const route = routeFor(destination.phone);
    if (!route.ok) throw new DeskError(route.reason);
    this.guardLiveCall(destination.phone, confirmLast4);

    const idempotencyKey = `fda-${this.state.runId}-${id}-passenger`.replace(/[^A-Za-z0-9_-]/g, "_");
    const call: AirlineCall = {
      destinationMasked: maskPhone(destination.phone),
      redirected: destination.redirected,
      idempotencyKey,
      task,
      callId: null,
      status: "submitted",
      submittedAt: new Date(this.now()).toISOString(),
      nextPollAt: new Date(this.now()).toISOString(),
      outcome: null,
      error: null,
    };
    // Record intent before dialing, as with every other call.
    entry.passengerCall = call;
    entry.status = "passenger_call_in_progress";
    this.save();

    const result = await this.gateway.start({
      task,
      phone: destination.phone,
      region: route.region,
      locale: route.locale,
      resultSchema,
      metadata: { request_id: id, pnr: booking.pnr, purpose: "request_intake" },
      idempotencyKey,
      simulation: { kind: "request_intake", booking, quote: entry.quote, request: entry.request },
    });
    if (result.kind === "started") {
      call.callId = result.callId;
      call.status = "in_progress";
      call.nextPollAt = new Date(this.now() + this.gateway.firstPollSeconds * 1000).toISOString();
    } else if (result.kind === "uncertain") {
      call.status = "uncertain";
      call.error = redactText(result.message);
      entry.status = "needs_review";
      entry.reviewReasons = [`CALL-E may or may not have called the passenger: ${call.error} It will not be redialed.`];
      this.notifyChannel(entry);
    } else {
      call.status = "failed_to_submit";
      call.error = redactText(result.message);
      entry.status = "awaiting_call";
    }
    if (this.gateway.live && result.kind !== "rejected") this.state.liveCallsUsed += 1;
    this.save();
    return entry;
  }

  /** Polls the passenger call if it is due, then records the agreed change or asks a person. */
  async refreshPassengerCall(id: string): Promise<RequestEntry> {
    const entry = this.requestEntry(id);
    return this.pollOnce(`intake:${id}`, entry, () => this.refreshPassengerCallUnlocked(entry));
  }

  private async refreshPassengerCallUnlocked(entry: RequestEntry): Promise<RequestEntry> {
    const call = entry.passengerCall;
    if (entry.status !== "passenger_call_in_progress" || !call?.callId || call.status !== "in_progress") return entry;
    if (this.now() < new Date(call.nextPollAt).getTime()) return entry;

    const outcome = redactOutcome(await this.gateway.get(call.callId));
    call.outcome = outcome;
    if (outcome.state === "in_progress") {
      call.nextPollAt = new Date(this.now() + this.gateway.pollSeconds * 1000).toISOString();
      this.save();
      return entry;
    }
    call.status = "finished";
    const decision = decideIntake(outcome, entry.quote);
    if (decision.kind === "confirmed") {
      entry.action = decision.action;
      entry.amount = decision.amount;
      entry.confirmedAt = new Date(this.now()).toISOString();
      entry.confirmedBy = { kind: "call", callId: call.callId, reason: decision.reason };
      entry.status = "confirmed_on_call";
    } else if (decision.kind === "no_change") {
      entry.status = "declined";
    } else {
      entry.status = "needs_review";
      entry.reviewReasons = decision.reasons;
    }
    this.notifyChannel(entry);
    this.save();
    return entry;
  }

  /**
   * A message from the chat, web form, or phone line integration. Returns what the channel
   * should tell the passenger. Each message id is processed once. CALL-E then calls the passenger
   * to agree the change; later updates go back to the same conversation.
   */
  receiveChannelMessage(message: ChannelMessage): { record: ChannelMessageRecord; duplicate: boolean } {
    const seen = this.state.channelMessages[message.id];
    if (seen) return { record: seen, duplicate: true };
    const record: ChannelMessageRecord = {
      messageId: message.id,
      type: message.type,
      channel: message.channel,
      conversationId: message.conversationId,
      receivedAt: new Date(this.now()).toISOString(),
      requestId: null,
      reply: "",
      outcome: "accepted",
    };
    const refuse = (reply: string) => {
      record.outcome = "refused";
      record.reply = reply;
    };

    const booking = this.catalog.bookings.find((b) => b.pnr === message.pnr);
    if (!booking || !passengerMatches(booking, message.lastName)) {
      refuse(NOT_FOUND_REPLY);
    } else {
      try {
        const entry = this.submitRequest(message.pnr, message.kind, message.targetFlightId, message.channel, {
          channel: message.channel,
          id: message.conversationId,
        });
        record.requestId = entry.request.id;
        record.reply = replyFor(this.catalog, entry);
      } catch (error) {
        refuse(
          error instanceof DeskError && error.status === 409
            ? `Booking ${message.pnr} already has a change in progress. We will update you in that conversation.`
            : `We could not start this request: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.state.channelMessages[message.id] = record;
    this.save();
    return { record, duplicate: false };
  }

  /**
   * Tells the passenger's channel when a request that came in through it changes after the
   * first reply: the airline desk answered, a person resolved it, or the operator acted.
   * One update per status; delivery is recorded but never blocks the desk.
   */
  private notifyChannel(entry: RequestEntry, alreadyReplied?: RequestEntry["status"]): void {
    const conversation = entry.request.conversation;
    if (!conversation || entry.status === alreadyReplied) return;
    entry.channelUpdates ??= [];
    const last = entry.channelUpdates[entry.channelUpdates.length - 1];
    if (last?.status === entry.status) return;
    const update: ChannelUpdate = {
      at: new Date(this.now()).toISOString(),
      status: entry.status,
      reply: replyFor(this.catalog, entry),
      delivery: this.options.channelNotifier ? "sending" : "not_configured",
      error: null,
    };
    entry.channelUpdates.push(update);
    const notifier = this.options.channelNotifier;
    if (!notifier) return;
    notifier({
      type: "request.updated",
      request_id: entry.request.id,
      channel: conversation.channel,
      conversation_id: conversation.id,
      status: entry.status,
      reply: update.reply,
    }).then(
      () => {
        update.delivery = "sent";
        this.save();
      },
      (error: unknown) => {
        update.delivery = "failed";
        update.error = redactText(error instanceof Error ? error.message : String(error));
        this.save();
      },
    );
  }

  private airlineDesk(id: string) {
    const entry = this.requestEntry(id);
    const booking = findBooking(this.catalog, entry.request.pnr);
    if (!entry.action) {
      throw new DeskError("The airline desk is called only after the passenger agreed a change on the CALL-E call.", 409);
    }
    const airline = airlineOf(this.catalog, booking).rules;
    const destination = this.route(airline.supportPhone);

    if (entry.action.kind === "refund") {
      const airlineRefund = airlineRefundAmount(this.catalog, booking, entry.quote);
      return {
        entry,
        booking,
        airline,
        destination,
        purpose: "airline_forced_refund" as const,
        task: buildAirlineRefundTask(this.catalog, { booking, quote: entry.quote }),
        resultSchema: buildAirlineRefundResultSchema(),
        simulation: { kind: "airline_refund_desk" as const, booking, airlineRefund },
        decide: (outcome: CallOutcome) => {
          const d = decideAirlineRefund(outcome, airlineRefund);
          return d.kind === "review" ? d : { kind: "apply" as const, reissue: undefined, note: `Refund approved by the airline desk, reference ${d.reference}.` };
        },
      };
    }
    const optionId = entry.action.kind === "move" ? entry.action.optionId : null;
    const option = entry.quote.moves.find((m) => m.id === optionId);
    if (!option) throw new DeskError("The agreed flight is not in this request's quote.", 409);
    return {
      entry,
      booking,
      airline,
      destination,
      purpose: "airline_forced_reissue" as const,
      task: buildAirlineTask(this.catalog, { booking, option }),
      resultSchema: buildAirlineResultSchema(),
      simulation: { kind: "airline_desk" as const, booking, option },
      decide: (outcome: CallOutcome) => {
        const d = decideAirline(outcome);
        return d.kind === "review"
          ? d
          : { kind: "apply" as const, reissue: { pnr: d.newPnr, ticket: d.ticket }, note: `Reissued by the airline desk${d.reference ? `, reference ${d.reference}` : ""}.` };
      },
    };
  }

  previewAirlineCall(id: string) {
    const { entry, airline, destination, task, resultSchema, purpose } = this.airlineDesk(id);
    const route = routeFor(destination.phone);
    return {
      id,
      mode: this.gateway.mode,
      live: this.gateway.live,
      airline: airline.name,
      purpose,
      destinationMasked: maskPhone(destination.phone),
      redirected: destination.redirected,
      blockedReason: route.ok ? null : route.reason,
      task,
      resultSchema,
      existing: entry.airlineCall,
      liveBudgetLeft: this.options.liveCallBudget - this.state.liveCallsUsed,
    };
  }

  /** Step 3: CALL-E asks the airline desk to make the change the passenger agreed on the call. One call per request. */
  async callAirlineDesk(id: string, confirmLast4?: string): Promise<RequestEntry> {
    const { entry, booking, destination, task, resultSchema, simulation, purpose } = this.airlineDesk(id);
    if (entry.status !== "confirmed_on_call") {
      throw new DeskError(
        entry.status === "awaiting_call" || entry.status === "passenger_call_in_progress"
          ? "CALL-E has to agree the change with the passenger before calling the airline desk."
          : `This request is ${entry.status}; the airline desk is called at most once per request.`,
        409,
      );
    }
    if (entry.airlineCall && entry.airlineCall.status !== "failed_to_submit") {
      throw new DeskError(`The airline desk was already called for this request (${entry.airlineCall.status}).`, 409);
    }
    const route = routeFor(destination.phone);
    if (!route.ok) throw new DeskError(route.reason);
    this.guardLiveCall(destination.phone, confirmLast4);

    const idempotencyKey = `fda-${this.state.runId}-${id}-airline`.replace(/[^A-Za-z0-9_-]/g, "_");
    const call: AirlineCall = {
      destinationMasked: maskPhone(destination.phone),
      redirected: destination.redirected,
      idempotencyKey,
      task,
      callId: null,
      status: "submitted",
      submittedAt: new Date(this.now()).toISOString(),
      nextPollAt: new Date(this.now()).toISOString(),
      outcome: null,
      error: null,
    };
    // Record intent before dialing, as with passenger calls.
    entry.airlineCall = call;
    entry.status = "airline_call_in_progress";
    this.save();

    const result = await this.gateway.start({
      task,
      phone: destination.phone,
      region: route.region,
      locale: route.locale,
      resultSchema,
      metadata: { request_id: id, pnr: booking.pnr, purpose },
      idempotencyKey,
      simulation,
    });
    if (result.kind === "started") {
      call.callId = result.callId;
      call.status = "in_progress";
      call.nextPollAt = new Date(this.now() + this.gateway.firstPollSeconds * 1000).toISOString();
    } else if (result.kind === "uncertain") {
      call.status = "uncertain";
      call.error = redactText(result.message);
      entry.status = "needs_review";
      entry.reviewReasons = [`CALL-E may or may not have called the airline desk: ${call.error} It will not be redialed.`];
      this.notifyChannel(entry);
    } else {
      call.status = "failed_to_submit";
      call.error = redactText(result.message);
      entry.status = "confirmed_on_call";
    }
    if (this.gateway.live && result.kind !== "rejected") this.state.liveCallsUsed += 1;
    this.save();
    return entry;
  }

  /** Polls the airline desk call if it is due, then applies a confirmed reissue or asks a person. */
  async refreshRequest(id: string): Promise<RequestEntry> {
    const entry = this.requestEntry(id);
    return this.pollOnce(`airline:${id}`, entry, () => this.refreshRequestUnlocked(entry));
  }

  private async refreshRequestUnlocked(entry: RequestEntry): Promise<RequestEntry> {
    const call = entry.airlineCall;
    if (entry.status !== "airline_call_in_progress" || !call?.callId || call.status !== "in_progress") return entry;
    if (this.now() < new Date(call.nextPollAt).getTime()) return entry;

    const outcome = redactOutcome(await this.gateway.get(call.callId));
    call.outcome = outcome;
    if (outcome.state === "in_progress") {
      call.nextPollAt = new Date(this.now() + this.gateway.pollSeconds * 1000).toISOString();
      this.save();
      return entry;
    }
    call.status = "finished";
    const decision = this.airlineDesk(entry.request.id).decide(outcome);
    if (decision.kind === "apply" && entry.action) {
      try {
        entry.applied = `${this.applyChange(entry.request.pnr, entry.quote, entry.action, decision.reissue)} ${decision.note}`;
        entry.status = "completed";
      } catch (error) {
        entry.status = "needs_review";
        entry.reviewReasons = [error instanceof Error ? error.message : String(error)];
      }
    } else {
      entry.status = "needs_review";
      entry.reviewReasons = decision.kind === "review" ? decision.reasons : ["The request has no action to apply."];
    }
    this.notifyChannel(entry);
    this.save();
    return entry;
  }

  /** A person closes a request in review: apply the confirmed change by hand, or close it unchanged. */
  resolveRequest(id: string, applyChange: boolean, note: string, reissue?: { pnr: string; ticket: string }): RequestEntry {
    const entry = this.requestEntry(id);
    if (entry.status !== "needs_review") throw new DeskError(`This request is ${entry.status}; only review items can be resolved.`, 409);
    if (applyChange) {
      if (!entry.action) throw new DeskError("This request has no confirmed change to apply.");
      if (reissue && (!/^[A-Z0-9]{6}$/.test(reissue.pnr) || !/^\d{3}-\d{10}$/.test(reissue.ticket))) {
        throw new DeskError("Booking code must be 6 letters or digits and the ticket must look like 000-0000000000.");
      }
      try {
        entry.applied = this.applyChange(entry.request.pnr, entry.quote, entry.action, reissue);
      } catch (error) {
        throw new DeskError(error instanceof Error ? error.message : String(error), 409);
      }
    } else {
      entry.applied = "Closed without changing the booking.";
    }
    const text = note.trim();
    if (text) this.state.bookings[entry.request.pnr]?.notes.push(`Agent note: ${text}`);
    entry.status = "resolved_by_human";
    this.notifyChannel(entry);
    this.save();
    return entry;
  }

  private callbackContext(id: string) {
    const entry = this.requestEntry(id);
    if (!["completed", "resolved_by_human"].includes(entry.status)) {
      throw new DeskError("Call the passenger back only after the request is finished.", 409);
    }
    const booking = findBooking(this.catalog, entry.request.pnr);
    const state = this.state.bookings[booking.pnr];
    if (!state) throw new DeskError(`No booking state for ${booking.pnr}`);
    const destination = this.route(booking.phone);
    const task = buildCallbackTask(this.catalog, booking, state, entry);
    return { entry, booking, destination, task };
  }

  previewCallback(id: string) {
    const { entry, destination, task } = this.callbackContext(id);
    const route = routeFor(destination.phone);
    return {
      id,
      mode: this.gateway.mode,
      live: this.gateway.live,
      destinationMasked: maskPhone(destination.phone),
      redirected: destination.redirected,
      blockedReason: route.ok ? null : route.reason,
      task,
      resultSchema: buildCallbackResultSchema(),
      existing: entry.callback,
      liveBudgetLeft: this.options.liveCallBudget - this.state.liveCallsUsed,
    };
  }

  /** Optional: one call telling the passenger how their request ended. Changes nothing. */
  async callPassengerWithResult(id: string, confirmLast4?: string): Promise<RequestEntry> {
    const { entry, booking, destination, task } = this.callbackContext(id);
    if (entry.callback && entry.callback.status !== "failed_to_submit") {
      throw new DeskError(`The passenger was already called back for this request (${entry.callback.status}).`, 409);
    }
    const route = routeFor(destination.phone);
    if (!route.ok) throw new DeskError(route.reason);
    this.guardLiveCall(destination.phone, confirmLast4);

    const idempotencyKey = `fda-${this.state.runId}-${id}-callback`.replace(/[^A-Za-z0-9_-]/g, "_");
    const call: AirlineCall = {
      destinationMasked: maskPhone(destination.phone),
      redirected: destination.redirected,
      idempotencyKey,
      task,
      callId: null,
      status: "submitted",
      submittedAt: new Date(this.now()).toISOString(),
      nextPollAt: new Date(this.now()).toISOString(),
      outcome: null,
      error: null,
    };
    entry.callback = call;
    entry.callbackVerdict = null;
    this.save();

    const result = await this.gateway.start({
      task,
      phone: destination.phone,
      region: route.region,
      locale: route.locale,
      resultSchema: buildCallbackResultSchema(),
      metadata: { request_id: id, pnr: booking.pnr, purpose: "request_result_callback" },
      idempotencyKey,
      simulation: { kind: "result_callback", booking },
    });
    if (result.kind === "started") {
      call.callId = result.callId;
      call.status = "in_progress";
      call.nextPollAt = new Date(this.now() + this.gateway.firstPollSeconds * 1000).toISOString();
    } else {
      call.status = result.kind === "uncertain" ? "uncertain" : "failed_to_submit";
      call.error = redactText(result.message);
      if (result.kind === "uncertain") {
        // Surface it: the passenger may or may not have heard the result, and it is never redialed.
        entry.callbackVerdict = {
          kind: "follow_up",
          reasons: [`CALL-E may or may not have called the passenger back: ${call.error} It will not be redialed. Send the result in writing.`],
        };
      }
    }
    if (this.gateway.live && result.kind !== "rejected") this.state.liveCallsUsed += 1;
    this.save();
    return entry;
  }

  async refreshCallback(id: string): Promise<RequestEntry> {
    const entry = this.requestEntry(id);
    return this.pollOnce(`callback:${id}`, entry, () => this.refreshCallbackUnlocked(entry));
  }

  private async refreshCallbackUnlocked(entry: RequestEntry): Promise<RequestEntry> {
    const call = entry.callback;
    if (!call?.callId || call.status !== "in_progress") return entry;
    if (this.now() < new Date(call.nextPollAt).getTime()) return entry;
    const outcome = redactOutcome(await this.gateway.get(call.callId));
    call.outcome = outcome;
    if (outcome.state === "in_progress") {
      call.nextPollAt = new Date(this.now() + this.gateway.pollSeconds * 1000).toISOString();
    } else {
      call.status = "finished";
      entry.callbackVerdict = decideCallback(outcome);
    }
    this.save();
    return entry;
  }

  // ------------------------------------------------------------ CALL-E plan check (no call)

  /**
   * Sends the exact task a call would use to CALL-E's planner and returns its verdict.
   * Works in every mode, including dry run; it never dials and changes nothing.
   */
  async checkWithCalle(
    target: { kind: "passenger"; disruptionId: string; pnr: string } | { kind: "intake" | "airline"; id: string },
  ): Promise<PlanCheck & { destinationMasked: string; region: string }> {
    const planner = this.options.planner;
    if (!planner) throw new DeskError("Checking with CALL-E is turned off (CALLE_PLAN_CHECK=off).", 503);
    const phone = this.options.planPhone;
    if (!phone) {
      throw new DeskError("Set CALLE_PLAN_PHONE to your own number in a CALL-E supported region, then restart. Planning never dials it.");
    }
    const route = routeFor(phone);
    if (!route.ok) throw new DeskError(route.reason);
    const task =
      target.kind === "passenger"
        ? this.preview(target.disruptionId, target.pnr).task
        : target.kind === "intake"
          ? this.previewPassengerCall(target.id).task
          : this.previewAirlineCall(target.id).task;
    let plan: PlanCheck;
    try {
      plan = await planner.plan({ phone, region: route.region, task });
    } catch (error) {
      throw new DeskError(redactText(error instanceof Error ? error.message : String(error)), 502);
    }
    return {
      ready: plan.ready,
      questions: plan.questions.map((q) => redactText(q)),
      goal: redactText(plan.goal),
      destinationMasked: maskPhone(phone),
      region: route.region,
    };
  }

  // ------------------------------------------------------------ fake GDS

  private apply(entry: LedgerEntry, action: Action): string {
    return this.applyChange(entry.pnr, entry.quote, action);
  }

  /**
   * Changes one booking in the fake GDS. `reissue` carries the booking code and
   * ticket an airline desk issued by phone; otherwise the fake GDS issues new ones.
   */
  private applyChange(pnr: string, quote: Quote, action: Action, reissue?: { pnr: string; ticket: string }): string {
    const state = this.state.bookings[pnr];
    if (!state) throw new Error(`No booking state for ${pnr}`);
    if (state.status !== "ticketed") throw new Error(`${pnr} was already changed (${state.status}).`);

    if (action.kind === "keep") {
      if (!quote.keep) throw new Error("The flight is cancelled, so there is no flight to keep.");
      const departure = localTime(quote.keep.newDeparture);
      state.status = "kept_on_delayed_flight";
      state.notes.push(`Kept on delayed flight, new departure ${departure}. Ticket unchanged.`);
      return `Kept on the delayed flight (${departure}). Ticket ${state.ticket} stays valid.`;
    }

    if (action.kind === "move") {
      const option = quote.moves.find((m) => m.id === action.optionId);
      if (!option) throw new Error("That flight was not offered on the call.");
      const seats = this.state.seats[option.flightId] ?? 0;
      if (seats <= 0) throw new Error(`No seats left on ${option.label}. Offer the passenger another option.`);
      this.state.seats[option.flightId] = seats - 1;
      state.status = "rebooked";
      state.flightId = option.flightId;
      state.currentPnr = reissue?.pnr ?? newPnr();
      state.ticket = reissue?.ticket ?? newTicket();
      state.charges = option.lines.filter((l) => l.amount > 0);
      state.notes.push(`Rebooked to ${option.label}. New booking code ${state.currentPnr}, ticket ${state.ticket} reissued.`);
      return `Rebooked to ${option.label}: booking code ${state.currentPnr}, ticket ${state.ticket}, charged ${idr(option.total)}.`;
    }

    state.status = "refunded";
    state.refundAmount = quote.refund.amount;
    state.charges = quote.refund.lines;
    state.notes.push(`Refund of ${idr(quote.refund.amount)} recorded. Ticket voided.`);
    return `Refund of ${idr(quote.refund.amount)} recorded and ticket ${state.ticket} voided.`;
  }

  // ------------------------------------------------------------ view

  snapshot() {
    const catalog = this.view();
    const partyName = (id: string) => this.catalog.rules.parties[id]?.name ?? id;
    const partyRole = (id: string) => this.catalog.rules.parties[id]?.role ?? "unknown";
    return {
      mode: this.gateway.mode,
      live: this.gateway.live,
      liveDemoPhone: this.options.liveDemoPhone && this.gateway.live ? maskPhone(this.options.liveDemoPhone) : null,
      liveBudget: { used: this.state.liveCallsUsed, limit: this.options.liveCallBudget },
      demoNow: this.options.demoNow ? new Date(this.options.demoNow()).toISOString() : null,
      planCheck: {
        available: Boolean(this.options.planner),
        phoneMasked: this.options.planPhone ? maskPhone(this.options.planPhone) : null,
      },
      opsEvents: Object.values(this.state.opsEvents).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
      polling: { firstSeconds: this.gateway.firstPollSeconds, everySeconds: this.gateway.pollSeconds },
      flights: catalog.flights.map((f) => ({
        ...f,
        passengers: this.catalog.bookings.filter((b) => b.flightId === f.id).length,
        disruption: this.activeDisruption(f.id) ?? null,
      })),
      bookings: this.catalog.bookings.map((b) => {
        const state = this.state.bookings[b.pnr];
        const quote = voluntaryQuoteFor(catalog, b);
        return {
          pnr: b.pnr,
          passenger: b.passenger,
          flight: findFlight(catalog, b.flightId),
          fareFamily: b.fareFamily,
          farePaid: b.farePaid,
          channel: b.channel.map((id) => ({ id, name: partyName(id), role: partyRole(id) })),
          state,
          disrupted: Boolean(this.activeDisruption(b.flightId)),
          voluntary: { moves: quote.moves.map((m) => ({ flightId: m.flightId, label: m.label, total: m.total })), refund: quote.refund.amount },
        };
      }),
      requests: Object.values(this.state.requests)
        .sort((a, b) => b.request.createdAt.localeCompare(a.request.createdAt))
        .map((r) => {
          const booking = findBooking(this.catalog, r.request.pnr);
          return {
            ...r,
            passenger: booking.passenger,
            flight: findFlight(catalog, booking.flightId),
            channel: booking.channel.map((id) => ({ id, name: partyName(id), role: partyRole(id) })),
            bookingState: this.state.bookings[booking.pnr],
          };
        }),
      disruptions: this.state.disruptions.map((d) => {
        const flight = findFlight(catalog, d.flightId);
        return {
          ...d,
          flight,
          bookings: this.catalog.bookings
            .filter((b) => b.flightId === d.flightId)
            .map((b) => {
              const entry = this.state.ledger[`${d.id}:${b.pnr}`] ?? null;
              return {
                pnr: b.pnr,
                passenger: b.passenger,
                phoneMasked: maskPhone(b.phone),
                fareFamily: b.fareFamily,
                farePaid: b.farePaid,
                channel: b.channel.map((id) => ({ id, name: partyName(id), role: partyRole(id) })),
                state: this.state.bookings[b.pnr],
                quote: entry?.quote ?? quoteFor(catalog, b, d),
                entry,
              };
            }),
        };
      }),
    };
  }
}
