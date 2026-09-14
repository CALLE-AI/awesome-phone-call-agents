import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CallGateway } from "./calle.ts";
import { findBooking, findFlight, type Catalog } from "./data.ts";
import { decide } from "./decide.ts";
import { addMinutes, idr, localTime } from "./format.ts";
import { maskPhone, routeFor } from "./phone.ts";
import { quoteFor } from "./rules.ts";
import { buildResultSchema, buildTask } from "./task.ts";
import type { Action, BookingState, Disruption, LedgerEntry, Quote } from "./types.ts";

interface DeskState {
  disruptions: Disruption[];
  ledger: Record<string, LedgerEntry>;
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
    return { disruptions: [], ledger: {}, bookings, seats, liveCallsUsed: 0 };
  }

  private load(): DeskState | null {
    const path = this.options.statePath;
    if (!path || !existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as DeskState;
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
    const inFlight = Object.values(this.state.ledger).some((e) => e.status === "in_progress" || e.status === "submitted");
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

  reportDelay(flightId: string, delayMinutes: number, reason: string): Disruption {
    const flight = findFlight(this.catalog, flightId);
    if (!Number.isInteger(delayMinutes) || delayMinutes < 15 || delayMinutes > 24 * 60) {
      throw new DeskError("Delay must be a whole number of minutes between 15 and 1440.");
    }
    const existing = this.state.disruptions.find((d) => d.flightId === flightId);
    if (existing) throw new DeskError(`${flight.code} already has a reported delay. Reset the demo to report a new one.`, 409);
    if (!this.catalog.bookings.some((b) => b.flightId === flightId)) {
      throw new DeskError(`${flight.code} has no bookings in this demo.`);
    }
    const disruption: Disruption = {
      id: `evt_${flightId}_${delayMinutes}`,
      flightId,
      delayMinutes,
      reason: reason.trim() || "an operational issue",
      newDeparture: addMinutes(flight.departure, delayMinutes),
      createdAt: new Date(this.now()).toISOString(),
    };
    this.state.disruptions.push(disruption);
    this.save();
    return disruption;
  }

  quote(disruptionId: string, pnr: string): Quote {
    const disruption = this.disruption(disruptionId);
    const booking = findBooking(this.catalog, pnr);
    if (booking.flightId !== disruption.flightId) throw new DeskError(`${pnr} is not on the delayed flight.`);
    return quoteFor(this.view(), booking, disruption);
  }

  // ------------------------------------------------------------ calls

  private destinationFor(pnr: string): { phone: string; redirected: boolean } {
    const booking = findBooking(this.catalog, pnr);
    if (this.gateway.live) return { phone: this.options.liveDemoPhone as string, redirected: true };
    return { phone: booking.phone, redirected: false };
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
    if (this.gateway.live) {
      if (confirmLast4 !== phone.slice(-4)) {
        throw new DeskError("Type the last 4 digits of the destination number to confirm this real call.");
      }
      if (this.state.liveCallsUsed >= this.options.liveCallBudget) {
        throw new DeskError(`Live call budget of ${this.options.liveCallBudget} is used up for this server run.`, 429);
      }
    }

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
  }

  /** A person closes a review item, with or without changing the booking. */
  resolve(key: string, action: Action | null, note: string): LedgerEntry {
    const entry = this.entry(key);
    if (entry.status !== "needs_review" && entry.status !== "uncertain") {
      throw new DeskError(`This call is ${entry.status}; only review items can be resolved.`, 409);
    }
    const text = note.trim();
    entry.applied = action ? this.apply(entry, action) : "Closed without changing the booking.";
    if (text) this.state.bookings[entry.pnr]?.notes.push(`Agent note: ${text}`);
    entry.status = "resolved_by_human";
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
