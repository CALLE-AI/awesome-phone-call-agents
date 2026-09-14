import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CallGateway } from "./calle.ts";
import { findBooking, findFlight, type Catalog } from "./data.ts";
import { buildAirlineResultSchema, buildAirlineTask, decideAirline } from "./airline.ts";
import { buildCallbackResultSchema, buildCallbackTask, decideCallback } from "./callback.ts";
import { decide } from "./decide.ts";
import { checkEligibility } from "./eligibility.ts";
import { FakeGds, type Gds } from "./gds.ts";
import { addMinutes, idr, localTime } from "./format.ts";
import { maskPhone, routeFor } from "./phone.ts";
import { airlineOf, quoteFor, voluntaryQuoteFor } from "./rules.ts";
import { buildResultSchema, buildTask } from "./task.ts";
import type { Action, AirlineCall, BookingState, Disruption, DisruptionCause, DisruptionKind, DisruptionSource, LedgerEntry, Quote, RequestChannel, RequestEntry, RequestKind } from "./types.ts";

interface DeskState {
  disruptions: Disruption[];
  ledger: Record<string, LedgerEntry>;
  requests: Record<string, RequestEntry>;
  bookings: Record<string, BookingState>;
  seats: Record<string, number>;
  liveCallsUsed: number;
}

export interface DeskOptions {
  /** Where state is persisted so call ids survive a restart. null = memory only. */
  statePath: string | null;
  /** Live modes redirect every call to this one number. */
  liveDemoPhone?: string;
  liveCallBudget: number;
  now?: () => number;
  /** B2B portal or GDS used by Workflow B. Defaults to the fake portal. */
  gds?: Gds;
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

function newTicket(): string {
  return `000-24${String(randomInt(10_000_000, 99_999_999))}`;
}

export class Desk {
  private state: DeskState;
  private readonly now: () => number;
  private readonly gds: Gds;

  constructor(
    private readonly catalog: Catalog,
    private readonly gateway: CallGateway,
    private readonly options: DeskOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.gds = options.gds ?? new FakeGds();
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
    return { disruptions: [], ledger: {}, requests: {}, bookings, seats, liveCallsUsed: 0 };
  }

  private load(): DeskState | null {
    const path = this.options.statePath;
    if (!path || !existsSync(path)) return null;
    const state = JSON.parse(readFileSync(path, "utf8")) as DeskState;
    state.requests ??= {};
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
      Object.values(this.state.requests).some((r) => r.status === "airline_call_in_progress" || r.callback?.status === "in_progress");
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

  reportDelay(flightId: string, delayMinutes: number, reason: string, cause: DisruptionCause = "operational"): Disruption {
    return this.reportDisruption({ flightId, kind: "delay", cause, delayMinutes, reason });
  }

  reportCancellation(flightId: string, reason: string, cause: DisruptionCause = "operational"): Disruption {
    return this.reportDisruption({ flightId, kind: "cancellation", cause, delayMinutes: 0, reason });
  }

  /** Records one disruption per flight, whether an operator typed it or the airline pushed it. */
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
    const existing = this.state.disruptions.find((d) => d.flightId === flightId);
    if (existing) {
      throw new DeskError(`${flight.code} already has a reported ${existing.kind}. Reset the demo to report a new one.`, 409);
    }
    if (!this.catalog.bookings.some((b) => b.flightId === flightId)) {
      throw new DeskError(`${flight.code} has no bookings in this demo.`);
    }
    const suffix = kind === "cancellation" ? "cancelled" : String(delayMinutes);
    const disruption: Disruption = {
      id: `evt_${flightId}_${cause === "force_majeure" ? "fm_" : ""}${suffix}`,
      flightId,
      kind,
      cause,
      delayMinutes,
      reason: input.reason.trim() || (cause === "force_majeure" ? "conditions outside the airline's control" : "an operational issue"),
      newDeparture: kind === "delay" ? addMinutes(flight.departure, delayMinutes) : null,
      source: input.source ?? { kind: "manual" },
      createdAt: new Date(this.now()).toISOString(),
    };
    this.state.disruptions.push(disruption);
    this.save();
    return disruption;
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
    const idempotencyKey = `fda-${disruptionId}-${pnr}`.replace(/[^A-Za-z0-9_-]/g, "_");
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
      entry.error = result.message;
    } else {
      entry.status = "failed_to_submit";
      entry.error = result.message;
    }
    if (this.gateway.live && result.kind !== "rejected") this.state.liveCallsUsed += 1;
    this.save();
    return entry;
  }

  /** Polls one call if it is due. Safe to call as often as you like. */
  async refresh(key: string): Promise<LedgerEntry> {
    const entry = this.entry(key);
    if (entry.status !== "in_progress" || !entry.callId) return entry;
    if (this.now() < new Date(entry.nextPollAt).getTime()) return entry;

    const outcome = await this.gateway.get(entry.callId);
    entry.outcome = outcome;
    if (outcome.state === "in_progress") {
      entry.nextPollAt = new Date(this.now() + this.gateway.pollSeconds * 1000).toISOString();
      this.save();
      return entry;
    }

    const decision = decide(outcome, entry.quote);
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
   * Steps 1-2: a reschedule or refund request arrives through an existing channel.
   * The desk prices it and checks eligibility before anything reaches the passenger.
   */
  submitRequest(pnr: string, kind: RequestKind, targetFlightId: string | null, channel: RequestChannel): RequestEntry {
    if (kind !== "reschedule" && kind !== "refund") throw new DeskError('kind must be "reschedule" or "refund".');
    if (!["chat", "web_form", "phone"].includes(channel)) throw new DeskError('channel must be "chat", "web_form", or "phone".');
    const booking = this.catalog.bookings.find((b) => b.pnr === pnr);
    if (!booking) throw new DeskError(`Unknown booking ${pnr}`, 404);
    const open = Object.values(this.state.requests).find(
      (r) => r.request.pnr === pnr && !["ineligible", "declined", "completed", "resolved_by_human"].includes(r.status),
    );
    if (open) throw new DeskError(`${pnr} already has an open request (${open.status}).`, 409);

    const id = `req_${pnr}_${Object.values(this.state.requests).filter((r) => r.request.pnr === pnr).length + 1}`;
    const request = { id, pnr, kind, targetFlightId: targetFlightId || null, channel, createdAt: new Date(this.now()).toISOString() };
    const quote = voluntaryQuoteFor(this.view(), booking);
    const eligibility = checkEligibility({
      catalog: this.view(),
      booking,
      state: this.state.bookings[pnr],
      request,
      quote,
      disrupted: this.state.disruptions.some((d) => d.flightId === booking.flightId),
      now: this.now(),
    });
    let action: Action | null = null;
    let amount: number | null = null;
    if (eligibility.eligible) {
      if (kind === "refund") {
        action = { kind: "refund" };
        amount = quote.refund.amount;
      } else {
        const move = quote.moves.find((m) => m.flightId === targetFlightId);
        if (move) {
          action = { kind: "move", optionId: move.id };
          amount = move.total;
        }
      }
    }
    const entry: RequestEntry = {
      request,
      eligibility,
      quote,
      action,
      amount,
      status: eligibility.eligible ? "quoted" : "ineligible",
      confirmedAt: null,
      portal: null,
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

  /**
   * Steps 3-4: the passenger confirmed the quoted amount through their channel.
   * The operator types that amount back, then the change goes to the portal.
   */
  confirmRequest(id: string, confirmedAmount: number): RequestEntry {
    const entry = this.requestEntry(id);
    if (entry.status !== "quoted" || !entry.action || entry.amount === null) {
      throw new DeskError(`This request is ${entry.status}; only quoted requests can be confirmed.`, 409);
    }
    if (confirmedAmount !== entry.amount) {
      throw new DeskError(`The passenger must confirm the quoted amount of ${idr(entry.amount)}.`);
    }
    const booking = findBooking(this.catalog, entry.request.pnr);
    entry.confirmedAt = new Date(this.now()).toISOString();

    const portal = this.gds.submit(booking, entry.action);
    entry.portal = portal;
    if (portal.kind === "rejected") {
      if (entry.action.kind === "move") {
        entry.status = "portal_rejected";
      } else {
        entry.status = "needs_review";
        entry.reviewReasons = [`${portal.message} Ask the airline to approve the refund, then resolve this request.`];
      }
      this.save();
      return entry;
    }
    try {
      entry.applied = this.applyChange(entry.request.pnr, entry.quote, entry.action);
      entry.status = "completed";
    } catch (error) {
      entry.status = "needs_review";
      entry.reviewReasons = [error instanceof Error ? error.message : String(error)];
    }
    this.save();
    return entry;
  }

  /** The passenger said no to the quote. Nothing changes. */
  declineRequest(id: string): RequestEntry {
    const entry = this.requestEntry(id);
    if (entry.status !== "quoted") throw new DeskError(`This request is ${entry.status}; only quoted requests can be declined.`, 409);
    entry.status = "declined";
    this.save();
    return entry;
  }

  private airlineDesk(id: string) {
    const entry = this.requestEntry(id);
    const booking = findBooking(this.catalog, entry.request.pnr);
    const option = entry.action?.kind === "move" ? entry.quote.moves.find((m) => m.id === (entry.action as { optionId: string }).optionId) : undefined;
    if (!option || entry.portal?.kind !== "rejected") throw new DeskError("Only a reissue the portal refused needs the airline desk.", 409);
    const airline = airlineOf(this.catalog, booking).rules;
    const destination = this.route(airline.supportPhone);
    const task = buildAirlineTask(this.catalog, {
      booking,
      option,
      rejectionCode: entry.portal.code,
      rejectionMessage: entry.portal.message,
    });
    return { entry, booking, option, airline, destination, task };
  }

  previewAirlineCall(id: string) {
    const { entry, airline, destination, task } = this.airlineDesk(id);
    const route = routeFor(destination.phone);
    return {
      id,
      mode: this.gateway.mode,
      live: this.gateway.live,
      airline: airline.name,
      destinationMasked: maskPhone(destination.phone),
      redirected: destination.redirected,
      blockedReason: route.ok ? null : route.reason,
      task,
      resultSchema: buildAirlineResultSchema(),
      existing: entry.airlineCall,
      liveBudgetLeft: this.options.liveCallBudget - this.state.liveCallsUsed,
    };
  }

  /** Step 5: the portal refused the reissue, so ask the airline desk to force it. One call per request. */
  async callAirlineDesk(id: string, confirmLast4?: string): Promise<RequestEntry> {
    const { entry, booking, option, destination, task } = this.airlineDesk(id);
    if (entry.status !== "portal_rejected") {
      throw new DeskError(`This request is ${entry.status}; the airline desk is called at most once per request.`, 409);
    }
    if (entry.airlineCall && entry.airlineCall.status !== "failed_to_submit") {
      throw new DeskError(`The airline desk was already called for this request (${entry.airlineCall.status}).`, 409);
    }
    const route = routeFor(destination.phone);
    if (!route.ok) throw new DeskError(route.reason);
    this.guardLiveCall(destination.phone, confirmLast4);

    const idempotencyKey = `fda-${id}-airline`.replace(/[^A-Za-z0-9_-]/g, "_");
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
      resultSchema: buildAirlineResultSchema(),
      metadata: { request_id: id, pnr: booking.pnr, purpose: "airline_forced_reissue" },
      idempotencyKey,
      simulation: { kind: "airline_desk", booking, option },
    });
    if (result.kind === "started") {
      call.callId = result.callId;
      call.status = "in_progress";
      call.nextPollAt = new Date(this.now() + this.gateway.firstPollSeconds * 1000).toISOString();
    } else if (result.kind === "uncertain") {
      call.status = "uncertain";
      call.error = result.message;
      entry.status = "needs_review";
      entry.reviewReasons = [`CALL-E may or may not have called the airline desk: ${result.message} It will not be redialed.`];
    } else {
      call.status = "failed_to_submit";
      call.error = result.message;
      entry.status = "portal_rejected";
    }
    if (this.gateway.live && result.kind !== "rejected") this.state.liveCallsUsed += 1;
    this.save();
    return entry;
  }

  /** Polls the airline desk call if it is due, then applies a confirmed reissue or asks a person. */
  async refreshRequest(id: string): Promise<RequestEntry> {
    const entry = this.requestEntry(id);
    const call = entry.airlineCall;
    if (entry.status !== "airline_call_in_progress" || !call?.callId || call.status !== "in_progress") return entry;
    if (this.now() < new Date(call.nextPollAt).getTime()) return entry;

    const outcome = await this.gateway.get(call.callId);
    call.outcome = outcome;
    if (outcome.state === "in_progress") {
      call.nextPollAt = new Date(this.now() + this.gateway.pollSeconds * 1000).toISOString();
      this.save();
      return entry;
    }
    call.status = "finished";
    const decision = decideAirline(outcome);
    if (decision.kind === "reissued" && entry.action) {
      try {
        entry.applied = `${this.applyChange(entry.request.pnr, entry.quote, entry.action, { pnr: decision.newPnr, ticket: decision.ticket })} Reissued by the airline desk${decision.reference ? `, reference ${decision.reference}` : ""}.`;
        entry.status = "completed";
      } catch (error) {
        entry.status = "needs_review";
        entry.reviewReasons = [error instanceof Error ? error.message : String(error)];
      }
    } else {
      entry.status = "needs_review";
      entry.reviewReasons = decision.kind === "review" ? decision.reasons : ["The request has no action to apply."];
    }
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

    const idempotencyKey = `fda-${id}-callback`.replace(/[^A-Za-z0-9_-]/g, "_");
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
      call.error = result.message;
    }
    if (this.gateway.live && result.kind !== "rejected") this.state.liveCallsUsed += 1;
    this.save();
    return entry;
  }

  async refreshCallback(id: string): Promise<RequestEntry> {
    const entry = this.requestEntry(id);
    const call = entry.callback;
    if (!call?.callId || call.status !== "in_progress") return entry;
    if (this.now() < new Date(call.nextPollAt).getTime()) return entry;
    const outcome = await this.gateway.get(call.callId);
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

  // ------------------------------------------------------------ fake GDS

  private apply(entry: LedgerEntry, action: Action): string {
    return this.applyChange(entry.pnr, entry.quote, action);
  }

  /**
   * Changes one booking in the fake GDS. `reissue` carries the booking code and
   * ticket an airline desk issued by phone; otherwise the portal issues new ones.
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
      polling: { firstSeconds: this.gateway.firstPollSeconds, everySeconds: this.gateway.pollSeconds },
      flights: catalog.flights.map((f) => ({
        ...f,
        passengers: this.catalog.bookings.filter((b) => b.flightId === f.id).length,
        disruption: this.state.disruptions.find((d) => d.flightId === f.id) ?? null,
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
          disrupted: this.state.disruptions.some((d) => d.flightId === b.flightId),
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
