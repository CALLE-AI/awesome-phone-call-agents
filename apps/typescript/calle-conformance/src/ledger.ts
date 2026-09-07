/**
 * A quota ledger that does not claim to know the rule.
 *
 * Every call-budget guard in the repository counts one unit per created call.
 * `apps/python/accessline` caps at 20 in memory, `apps/web/local-atlas` buckets
 * by UTC calendar day, `callback-scam-screener` increments a monotonic integer
 * that never decays. All of them assume calls are the unit. Nine created calls
 * consuming twenty units says that assumption is worth testing.
 *
 * So this does not pick a rule. It holds the competing rules at once, predicts
 * what each would say the counter should read, and then reads the real counter
 * and eliminates the ones that disagree. It is an instrument for finding the
 * accounting rule, and only afterwards a guard that enforces it.
 *
 * The counter is readable without placing a call: payload validation runs
 * before the rate limiter but destination screening runs after it, so a
 * well-formed request aimed at an unsupported region returns 422 under the cap
 * and 429 carrying { limit, window_hours, count } at it.
 *
 * Nothing here places a call.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** How a request ended, from the caller's point of view. */
export type RequestKind =
  /** Rejected on payload shape. Never reached the planner. */
  | "rejected_shape"
  /** Reached the planner and was refused, e.g. unsupported region. No call placed. */
  | "rejected_planner"
  /** Accepted, dialled, never connected. Zero transcript turns. */
  | "placed_unconnected"
  /** Accepted, connected, a conversation happened. */
  | "placed_connected";

export type Entry = {
  at: string;
  kind: RequestKind;
  callId: string | null;
  /** Attempts the API reported. Known to under-report actual dials. */
  attemptsReported: number;
  note?: string;
};

/** A candidate accounting rule: which requests consume, and how many units. */
export type Hypothesis = {
  id: string;
  describes: string;
  cost: (e: Entry) => number;
};

export const HYPOTHESES: Hypothesis[] = [
  {
    id: "per-connected-call",
    describes: "Only calls that reached a person consume a unit",
    cost: (e) => (e.kind === "placed_connected" ? 1 : 0),
  },
  {
    id: "per-placed-call",
    describes: "Every accepted create consumes one unit, connected or not",
    cost: (e) => (e.kind === "placed_connected" || e.kind === "placed_unconnected" ? 1 : 0),
  },
  {
    id: "per-planned-request",
    describes: "Anything that reached the planner consumes a unit, including refusals that place no call",
    cost: (e) => (e.kind === "rejected_shape" ? 0 : 1),
  },
  {
    id: "per-request",
    describes: "Every request consumes a unit, including those rejected on payload shape",
    cost: () => 1,
  },
  {
    id: "per-reported-attempt",
    describes: "Each attempt the API reports consumes a unit",
    cost: (e) => e.attemptsReported,
  },
];

/**
 * A sixth possibility that is not a cost function at all.
 *
 * On 2 September 2026 a developer reported this same payload with the same
 * complaint, that they had not made twenty calls. A maintainer answered that
 * risk controls had recently been tightened and the account "may have been
 * affected by mistake", then asked for the account email in order to look at it
 * case by case.
 *
 * So the counter may include units that no request of the caller's produced. No
 * amount of counting requests can rule that out, because every hypothesis above
 * is a function of the caller's own requests. It is falsified differently: by
 * observing the counter move while the caller issues nothing that could move it.
 * `src/watch.ts` samples exactly that way, since a probe is rejected by the
 * limiter before it reaches the planner while the cap is in force.
 */
export const EXTERNAL_MOVEMENT = {
  id: "not-caller-derived",
  describes:
    "Part of the count comes from something other than the caller's requests, such as a risk control",
  falsifiedBy: "the counter holding steady across a window in which the caller issues no billable request",
  evidence: "reported by another developer on 2 September 2026; a maintainer called it a possible mistake",
} as const;

export type Observation = { at: string; count: number; limit: number; windowHours: number };

type State = { entries: Entry[]; observations: Observation[] };

const EMPTY: State = { entries: [], observations: [] };

export class Ledger {
  private state: State;

  constructor(private readonly path = ".calle-ledger.json") {
    try {
      this.state = JSON.parse(readFileSync(path, "utf8")) as State;
    } catch {
      this.state = structuredClone(EMPTY);
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path) === "" ? "." : dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }

  record(entry: Omit<Entry, "at"> & { at?: string }): void {
    this.state.entries.push({ at: entry.at ?? new Date().toISOString(), ...entry });
    this.save();
  }

  observe(observation: Omit<Observation, "at"> & { at?: string }): void {
    this.state.observations.push({ at: observation.at ?? new Date().toISOString(), ...observation });
    this.save();
  }

  get entries(): readonly Entry[] { return this.state.entries; }
  get observations(): readonly Observation[] { return this.state.observations; }

  /** What each hypothesis predicts the counter should read, over a window. */
  predict(since?: Date): Array<{ id: string; describes: string; predicted: number }> {
    const from = since?.getTime() ?? 0;
    const inWindow = this.state.entries.filter((e) => Date.parse(e.at) >= from);
    return HYPOTHESES.map((h) => ({
      id: h.id,
      describes: h.describes,
      predicted: inWindow.reduce((sum, e) => sum + h.cost(e), 0),
    }));
  }

  /**
   * Compares predictions against the most recent reading. A hypothesis is only
   * eliminated when the ledger has seen every request in the window, so a
   * partial ledger reports "cannot judge" instead of a false verdict.
   */
  reconcile(complete: boolean, since?: Date): {
    reading: Observation | null;
    rows: Array<{ id: string; describes: string; predicted: number; drift: number | null; survives: boolean | null }>;
    externalMovement: Array<{ from: Observation; to: Observation; rise: number }>;
  } {
    const reading = this.state.observations.at(-1) ?? null;
    // Two consecutive readings that move without an intervening entry are the
    // signature of movement the caller did not cause.
    const rows = this.predict(since).map((p) => ({
      ...p,
      drift: reading === null ? null : p.predicted - reading.count,
      survives: reading === null || !complete ? null : p.predicted === reading.count,
    }));
    return { reading, rows, externalMovement: this.externalMovement() };
  }

  /**
   * Readings that rose without any recorded request in between. Each one is a
   * unit the caller cannot account for, and the only evidence that bears on
   * EXTERNAL_MOVEMENT.
   */
  externalMovement(): Array<{ from: Observation; to: Observation; rise: number }> {
    const found: Array<{ from: Observation; to: Observation; rise: number }> = [];
    const obs = this.state.observations;
    for (let i = 1; i < obs.length; i += 1) {
      const from = obs[i - 1]!;
      const to = obs[i]!;
      if (to.count <= from.count) continue;
      const between = this.state.entries.filter(
        (e) => Date.parse(e.at) > Date.parse(from.at) && Date.parse(e.at) <= Date.parse(to.at),
      );
      if (between.length === 0) found.push({ from, to, rise: to.count - from.count });
    }
    return found;
  }

  /**
   * How many requests of a kind can still be made, under the most pessimistic
   * surviving hypothesis. Absent a reading it refuses to guess.
   */
  headroom(kind: RequestKind, complete: boolean, since?: Date): number | null {
    const { reading, rows } = this.reconcile(complete, since);
    if (reading === null) return null;
    const surviving = rows.filter((r) => r.survives !== false);
    const costs = HYPOTHESES.filter((h) => surviving.some((s) => s.id === h.id)).map((h) =>
      h.cost({ at: new Date().toISOString(), kind, callId: null, attemptsReported: 1 }),
    );
    const worst = Math.max(0, ...costs);
    const left = reading.limit - reading.count;
    return worst === 0 ? left : Math.floor(left / worst);
  }
}
