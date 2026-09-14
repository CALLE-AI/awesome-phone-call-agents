import { PhoneAdapter } from "./provider.ts";
import { randomUUID } from "node:crypto";
import {
  buildRequest,
  terminal,
  verifyDonor,
  verifyPartner,
  rankPartners,
  minutes,
  validateInput,
} from "./workflow.ts";

import { Store } from "./store.ts";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class Engine {
  store: Store;
  busy = new Set<string>();
  adapter: PhoneAdapter;
  fixtureDelay: number;
  constructor(store: Store, client?: any, fixtureDelay = 2200) {
    this.store = store;
    this.fixtureDelay = fixtureDelay;
    this.adapter = new PhoneAdapter(client);
  }
  settings() {
    return this.adapter.settings(this.store.used());
  }
  now(run: any) {
    if (run.input.replayId) {
      const clock = this.adapter.read(run.input.replayId).clockMinute;
      if (Number.isFinite(clock)) return clock;
    }
    if (run.input.mode === "fixture") return minutes(run.input.ready) - 10;
    const offset = run.input.offset;
    const delta =
      (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4))) *
      (offset[0] === "-" ? -1 : 1);
    const d = new Date(Date.now() + delta * 60000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
  expired(run: any) {
    return (
      run.input.mode === "live" &&
      Date.now() >
        Date.parse(
          `${run.input.date}T${run.offer?.cutoff ?? run.input.cutoff}:00${run.input.offset}`,
        )
    );
  }
  event(run: any, title: string, detail: string) {
    run.events.push({ at: new Date().toISOString(), title, detail });
    this.store.save(run);
  }
  create(input: any, key: string) {
    if (input?.replayId) {
      const bundle = this.adapter.read(input.replayId);
      input = { ...bundle.input, mode: "fixture", replayId: input.replayId };
    }
    validateInput(input);
    const existing = this.store.byKey(key);
    if (existing) return existing;
    if (input.mode === "live") {
      this.adapter.assertAllowed(input);
      if (
        this.store
          .all()
          .some(
            (r) =>
              r.input.mode === "live" &&
              [
                "calling_donor",
                "matching",
                "calling_partner",
                "paused",
              ].includes(r.state),
          )
      )
        throw Error("Resolve the current live pickup before starting another.");
      if (
        Date.parse(`${input.date}T${input.cutoff}:00${input.offset}`) <=
        Date.now()
      )
        throw Error("The collection window has already expired.");
      if (this.settings().used + 2 > this.settings().cap)
        throw Error(
          "This workflow needs room for two calls within the local call cap.",
        );
    }
    const run = {
      id: randomUUID(),
      clientKey: key,
      input,
      roleplay: this.settings().roleplay,
      provenance: input.replayId
        ? "live-recording-replay"
        : input.mode === "live"
          ? "live-api"
          : "synthetic-template",
      createdAt: new Date().toISOString(),
      state: "calling_donor",
      events: [],
      calls: [],
      stopped: false,
      offer: null,
      ranking: [],
      selected: null,
      ticket: null,
      reason: null,
    };
    this.event(
      run,
      "Surplus reported",
      `${input.quantity} estimated loaves. Verify quantity, window, and release before offering a pickup.`,
    );
    void this.advance(run.id);
    return run;
  }
  async call(run: any, role: "donor" | "partner") {
    let step = run.calls.find((s: any) => s.role === role);
    if (!step) {
      const request = buildRequest(run.input, role, run.offer, run.selected);
      request.task =
        (run.input.mode === "live" && run.roleplay
          ? "This is a supervised hackathon role-play with an authorized test recipient. No real food collection should occur. State that clearly. "
          : "") + request.task;
      step = {
        role,
        key: `lastcrate-${run.id}-${role}`,
        request: {
          ...request,
          metadata: { workflow: "last-crate", run_id: run.id, role },
        },
        id: null,
        result: null,
        status: "queued",
      };
      run.calls.push(step);
      this.event(
        run,
        role === "donor"
          ? "Calling the bakery"
          : "Calling the collection partner",
        role === "donor"
          ? "Confirm the actual offer, not the estimate."
          : `Offer ${run.offer.quantity} loaves to ${run.selected.name}; require an exact pickup commitment.`,
      );
    }
    return this.adapter.execute({
      run,
      step,
      save: () => this.store.save(run),
      reserve: (key: string) => this.store.reserve(key, this.settings().cap),
      fixtureDelay: this.fixtureDelay,
    });
  }
  async advance(id: string) {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    const run = this.store.get(id);
    try {
      if (
        !run ||
        [
          "agreed",
          "review",
          "declined",
          "expired",
          "stopped",
          "collected",
        ].includes(run.state)
      )
        return;
      run.state = run.offer ? "calling_partner" : "calling_donor";
      run.reason = null;
      run.providerError = null;
      this.store.save(run);
      if (!run.offer) {
        const call = await this.call(run, "donor");
        const checked = verifyDonor(call);
        if (!checked.ok) {
          run.state = "review";
          run.reason = checked.reason;
          this.event(run, "Offer needs attention", checked.reason!);
          return;
        }
        run.offer = checked.offer;
        run.state = "matching";
        this.event(
          run,
          "Bakery offer verified",
          `${run.offer.quantity} loaves · ${run.offer.ready}–${run.offer.cutoff} · set aside for an approved partner.`,
        );
      }
      const partnerStarted = run.calls.some((c: any) => c.role === "partner");
      if (this.store.get(id).stopped && !partnerStarted) {
        run.stopped = true;
        run.state = "stopped";
        run.reason =
          "Future calls stopped. The bakery may still be holding bread; contact them if needed.";
        this.store.save(run);
        return;
      }
      if (this.expired(run) && !partnerStarted) {
        run.state = "expired";
        run.reason =
          "The collection window expired. No new partner call was placed.";
        this.store.save(run);
        return;
      }
      if (!run.selected) {
        run.matchClock = this.now(run);
        run.ranking = rankPartners(run.input, run.offer, run.matchClock);
        run.selected = run.ranking.find((p: any) => p.eligible) ?? null;
        if (!run.selected) {
          run.state = "review";
          run.reason =
            "No approved partner fits the full quantity and remaining collection window.";
          this.event(run, "No feasible collector", run.reason);
          return;
        }
        this.event(
          run,
          "Collector selected",
          `${run.selected.name}: ${run.selected.reason}. Closest eligible partner; no partial pickups.`,
        );
      }
      if (run.input.mode === "fixture") await delay(this.fixtureDelay);
      if (this.store.get(id).stopped && !partnerStarted) {
        run.stopped = true;
        run.state = "stopped";
        this.store.save(run);
        return;
      }
      run.state = "calling_partner";
      this.store.save(run);
      const call = await this.call(run, "partner");
      const checked = verifyPartner(call, run.offer, run.selected.earliest);
      // An in-flight call cannot be canceled. Always reconcile its commitment before honoring stop.
      run.stopped = !!this.store.get(id).stopped;
      if (!checked.ok) {
        run.state = checked.declined ? "declined" : "review";
        run.reason = checked.reason;
        this.event(run, "Pickup not assigned", checked.reason!);
        return;
      }
      if (this.expired(run)) {
        run.state = "expired";
        run.reason =
          "The agreement arrived after the collection cutoff. Contact both parties; no active ticket issued.";
        this.store.save(run);
        return;
      }
      run.ticket = {
        reference: `LC-${id.slice(0, 6).toUpperCase()}`,
        quantity: run.offer.quantity,
        donor: run.input.donor,
        partner: run.selected.name,
        address: run.input.address,
        date: run.input.date,
        arrival: checked.agreement.arrival,
        cutoff: run.offer.cutoff,
        offset: run.input.offset,
        createdAt: new Date().toISOString(),
        source: run.input.mode,
        callIds: run.calls.map((c: any) => c.id),
      };
      run.state = "agreed";
      this.event(
        run,
        "Pickup agreed",
        `${run.ticket.quantity} loaves assigned to ${run.ticket.partner} for ${run.ticket.arrival}. Ticket created. Collection is not yet confirmed.`,
      );
    } catch (error: any) {
      const rejected = [
        "call_not_ready",
        "unsupported_region",
        "unsupported_locale",
        "validation_error",
        "invalid_request",
      ].includes(error.code);
      run.state = rejected ? "review" : "paused";
      run.providerError = {
        code: error.code || error.name || "connection_error",
        message: String(error.message || "Connection failed")
          .replace(/iams_live_[\w-]+/g, "[REDACTED]")
          .slice(0, 700),
      };
      run.reason = rejected
        ? `CALL-E rejected this request before returning a call ID: ${run.providerError.message}`
        : error?.message?.includes("still unresolved")
          ? error.message
          : "CALL-E could not be reconciled. Check your connection, quota and credentials, then resume the saved request. No replacement call will be created.";
      this.event(
        run,
        rejected ? "Call request rejected" : "Workflow paused",
        run.reason,
      );
    } finally {
      try {
        if (run) this.adapter.record(run);
      } catch {
        if (run) {
          run.recordingError =
            "Recording could not be saved; original provider results remain in SQLite.";
          this.store.save(run);
        }
      }
      this.busy.delete(id);
    }
  }
  stop(id: string) {
    const run = this.store.get(id);
    if (!run) throw Error("Pickup not found.");
    run.stopped = true;
    const unresolved = run.calls.some((c: any) => !c.result);
    if (
      !this.busy.has(id) &&
      !unresolved &&
      !["agreed", "collected"].includes(run.state)
    )
      run.state = "stopped";
    this.event(
      run,
      "Stop requested",
      "No later calls will start. CALL-E cannot cancel a call already placed; an in-flight commitment will still be reconciled.",
    );
    return run;
  }
}
