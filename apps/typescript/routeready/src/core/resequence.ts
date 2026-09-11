import type { TravelTimes } from "./travel.js";

export interface RouteStopInput {
  id: string;
  serviceMinutes: number;
  /** Do not start service before this minute; null when there is no constraint. */
  earliest: number | null;
  /** Promised latest delivery minute; null when nothing was promised. */
  windowEnd: number | null;
}

export interface Visit {
  id: string;
  arrive: number;
  wait: number;
  late: number;
  depart: number;
}

export interface RoutePlan {
  order: string[];
  visits: Visit[];
  finish: number;
  waiting: number;
  lateness: number;
  changes: number;
  cost: number;
}

export interface ResequenceInput {
  /** Where the rider is now (hub or a stop id). */
  from: string;
  /** Current minute after shift start. */
  now: number;
  /** Remaining stops in the order the rider currently follows. */
  current: RouteStopInput[];
  travel: TravelTimes;
}

export interface ResequenceResult {
  current: RoutePlan;
  best: RoutePlan;
  changed: boolean;
  /** Stops that now come earlier than in the current order. */
  movedUp: string[];
  /** Route minutes saved, counting each late minute LATE_WEIGHT times. */
  savedMinutes: number;
}

/** Each minute past a promised window costs this many minutes of route time. */
export const LATE_WEIGHT = 2;
/** Cost per reordered position, so the route never flips for a trivial gain. */
export const CHANGE_PENALTY = 0.5;
/** Largest number of stops searched exhaustively; any further stops keep their order. */
export const EXACT_LIMIT = 9;

export function evaluate(order: RouteStopInput[], input: ResequenceInput): RoutePlan {
  let time = input.now;
  let at = input.from;
  let waiting = 0;
  let lateness = 0;
  const visits: Visit[] = [];
  for (const stop of order) {
    const arrive = time + input.travel.minutes(at, stop.id);
    const wait = stop.earliest === null ? 0 : Math.max(0, stop.earliest - arrive);
    const start = arrive + wait;
    const late = stop.windowEnd === null ? 0 : Math.max(0, start - stop.windowEnd);
    time = start + stop.serviceMinutes;
    at = stop.id;
    waiting += wait;
    lateness += late;
    visits.push({ id: stop.id, arrive, wait, late, depart: time });
  }
  const ids = order.map((stop) => stop.id);
  const changes = ids.filter((id, i) => id !== input.current[i]?.id).length;
  return {
    order: ids,
    visits,
    finish: time,
    waiting,
    lateness,
    changes,
    cost: time + LATE_WEIGHT * lateness + CHANGE_PENALTY * changes,
  };
}

/**
 * Finds the cheapest order for the remaining stops with a branch-and-bound
 * search over every permutation. Ties keep the current order.
 */
export function resequence(input: ResequenceInput): ResequenceResult {
  const current = evaluate(input.current, input);
  const tail = input.current.slice(EXACT_LIMIT);
  let best = current;
  const prefix: RouteStopInput[] = [];

  const explore = (pool: RouteStopInput[], time: number, at: string, lateness: number): void => {
    // Time and lateness only grow from here, so this is a lower bound on the final cost.
    if (time + LATE_WEIGHT * lateness >= best.cost) return;
    if (pool.length === 0) {
      const plan = evaluate([...prefix, ...tail], input);
      if (plan.cost < best.cost) best = plan;
      return;
    }
    for (const stop of pool) {
      const arrive = time + input.travel.minutes(at, stop.id);
      const start = stop.earliest === null ? arrive : Math.max(arrive, stop.earliest);
      const late = stop.windowEnd === null ? 0 : Math.max(0, start - stop.windowEnd);
      prefix.push(stop);
      explore(
        pool.filter((other) => other !== stop),
        start + stop.serviceMinutes,
        stop.id,
        lateness + late,
      );
      prefix.pop();
    }
  };
  explore(input.current.slice(0, EXACT_LIMIT), input.now, input.from, 0);

  const before = new Map(current.order.map((id, i) => [id, i]));
  const movedUp = best.order.filter((id, i) => i < (before.get(id) ?? i));
  const savedMinutes = current.finish + LATE_WEIGHT * current.lateness - (best.finish + LATE_WEIGHT * best.lateness);
  return {
    current,
    best,
    changed: best.order.join() !== current.order.join(),
    movedUp,
    savedMinutes,
  };
}
