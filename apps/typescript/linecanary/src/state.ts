/**
 * Dashboard state assembly: everything the web surfaces render, computed in
 * one pure pass over config + baseline store. No HTML here — this is the
 * testable boundary between the engine and its face.
 */

import type { CheckOutcome } from "./assert.js";
import type { BaselineStore, IncidentNote, LineVerification } from "./baseline.js";
import { maskPhone } from "./alert.js";
import type { CheckConfig, Config } from "./config.js";
import { diffAgainstBaseline, type Regression } from "./diff.js";

export interface CheckState {
  id: string;
  name: string;
  task: string;
  latest: CheckOutcome | null;
  /** Regressions of the latest run against everything before it. */
  regressions: Regression[];
  /** Oldest → newest, capped by the store; used for timelines and trends. */
  history: CheckOutcome[];
  /** Answer-time series from pass runs, for the trend line. */
  answerSeconds: (number | null)[];
  /** AI incident note, present only while it describes the latest run. */
  note: IncidentNote | null;
}

export interface LineState {
  id: string;
  name: string;
  maskedPhone: string;
  verification: LineVerification | null;
  checks: CheckState[];
  /** Worst latest status across checks: ok | attention | unknown. */
  health: "ok" | "attention" | "unknown";
}

export interface DashboardState {
  generatedAt: string;
  lines: LineState[];
  /** True when every line with data is healthy. */
  allClear: boolean;
  totals: { lines: number; checks: number; passing: number; callsToday: number };
}

function checkState(check: CheckConfig, store: BaselineStore): CheckState {
  const history = store.history(check.id);
  const latest = history.length === 0 ? null : history[history.length - 1];
  const regressions = latest === null ? [] : diffAgainstBaseline(latest, history.slice(0, -1));
  const stored = store.note(check.id);
  return {
    id: check.id,
    name: check.name ?? check.id,
    task: check.task,
    latest,
    regressions,
    history,
    answerSeconds: history.map((outcome) => outcome.timing.secondsToAnswer),
    note: stored !== null && latest !== null && stored.callId === latest.callId ? stored : null,
  };
}

export function buildDashboardState(config: Config, store: BaselineStore, now: () => Date = () => new Date()): DashboardState {
  const lines: LineState[] = config.lines.map((line) => {
    const checks = config.checks.filter((check) => check.line === line.id).map((check) => checkState(check, store));
    const statuses = checks.map((check) => check.latest?.status ?? null);
    const health =
      statuses.every((status) => status === null)
        ? "unknown"
        : statuses.some((status) => status === "fail" || status === "error")
          ? "attention"
          : "ok";
    return {
      id: line.id,
      name: line.name ?? line.id,
      maskedPhone: maskPhone(line.phone),
      verification: store.verification(line.id),
      checks,
      health,
    };
  });
  const allChecks = lines.flatMap((line) => line.checks);
  const today = now().toISOString().slice(0, 10);
  return {
    generatedAt: now().toISOString(),
    lines,
    allClear: lines.every((line) => line.health !== "attention"),
    totals: {
      lines: lines.length,
      checks: allChecks.length,
      passing: allChecks.filter((check) => check.latest?.status === "pass").length,
      callsToday: allChecks.reduce(
        (sum, check) => sum + check.history.filter((outcome) => outcome.at.slice(0, 10) === today).length,
        0,
      ),
    },
  };
}
