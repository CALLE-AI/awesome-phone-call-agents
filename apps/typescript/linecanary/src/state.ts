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

/**
 * A check whose latest run is older than this is stale: monitoring has
 * stopped, whatever the last result said. 26 hours covers a 12-hour cron
 * cadence with slack for retries and call-window delays.
 */
const STALE_AFTER_HOURS = 26;

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
  /** Latest run is older than STALE_AFTER_HOURS — not currently being checked. */
  stale: boolean;
  /** A call attempt awaiting reconciliation by the next run. */
  pending: boolean;
}

/** Verification as exposed to the UI and /api/state — never the raw E.164. */
export interface PublicVerification {
  lineId: string;
  method: string;
  verifiedAt: string;
  maskedPhone: string;
}

function projectVerification(verification: LineVerification | null): PublicVerification | null {
  // maskPhone, not the raw phone: /api/state serializes this object, and the
  // documented masking control must hold on the JSON surface too, not only
  // in the rendered HTML.
  return verification === null
    ? null
    : { lineId: verification.lineId, method: verification.method, verifiedAt: verification.verifiedAt, maskedPhone: maskPhone(verification.phone) };
}

export interface LineState {
  id: string;
  name: string;
  maskedPhone: string;
  verification: PublicVerification | null;
  checks: CheckState[];
  /**
   * Worst condition across checks: attention (a latest run failed), stale
   * (a check never ran or stopped running), or ok (all fresh passes).
   */
  health: "ok" | "attention" | "stale";
}

export interface DashboardState {
  generatedAt: string;
  /** IANA timezone absolute stamps render in, from config.callWindow. */
  timezone?: string;
  lines: LineState[];
  /** True only when every check has a fresh passing run. */
  allClear: boolean;
  totals: { lines: number; checks: number; passing: number; callsToday: number };
}

function checkState(check: CheckConfig, store: BaselineStore, nowMs: number): CheckState {
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
    stale: latest !== null && nowMs - Date.parse(latest.at) > STALE_AFTER_HOURS * 3_600_000,
    pending: store.pending(check.id) !== null,
  };
}

export function buildDashboardState(config: Config, store: BaselineStore, now: () => Date = () => new Date()): DashboardState {
  const generated = now();
  const lines: LineState[] = config.lines.map((line) => {
    const checks = config.checks.filter((check) => check.line === line.id).map((check) => checkState(check, store, generated.getTime()));
    const health =
      checks.some((check) => check.latest?.status === "fail" || check.latest?.status === "error")
        ? "attention"
        : checks.some((check) => check.latest === null || check.stale)
          ? "stale"
          : "ok";
    return {
      id: line.id,
      name: line.name ?? line.id,
      maskedPhone: maskPhone(line.phone),
      verification: projectVerification(store.verification(line.id)),
      checks,
      health,
    };
  });
  const allChecks = lines.flatMap((line) => line.checks);
  // "Today" is a calendar day in the operator's call-window timezone when
  // configured; UTC otherwise.
  const timezone = config.callWindow?.timezone;
  const dayOf =
    timezone === undefined
      ? (iso: string) => iso.slice(0, 10)
      : (() => {
          // en-CA formats as YYYY-MM-DD, matching the ISO day slice.
          const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
          return (iso: string) => format.format(new Date(iso));
        })();
  const today = dayOf(generated.toISOString());
  return {
    generatedAt: generated.toISOString(),
    timezone,
    lines,
    allClear: lines.every((line) => line.health === "ok"),
    totals: {
      lines: lines.length,
      checks: allChecks.length,
      passing: allChecks.filter((check) => check.latest?.status === "pass").length,
      callsToday: allChecks.reduce(
        (sum, check) => sum + check.history.filter((outcome) => dayOf(outcome.at) === today).length,
        0,
      ),
    },
  };
}
