/**
 * The runner: one invocation, at most one call per check.
 *
 * Recurrence belongs to the host scheduler (cron, GitHub Actions) — this
 * process never sleeps, retries or re-dials. Dry-run is the default posture
 * upstream in the CLI; a live run refuses any line without a matching
 * ownership verification, and every task leaves with the AI-disclosure
 * preamble in front. One check's API failure is recorded and the run moves
 * on: a monitoring tool that dies on the first error is itself an outage.
 */

import { evaluateCheck, type CheckOutcome } from "./assert.js";
import type { BaselineStore } from "./baseline.js";
import { ApiError, CallTimeoutError, type CallePort } from "./calle.js";
import type { CallWindow, CheckConfig, Config, LineConfig } from "./config.js";
import { diffAgainstBaseline, type Regression } from "./diff.js";

export const DISCLOSURE_PREAMBLE =
  "Begin the call by saying: 'This is an automated test call from LineCanary, monitoring this line on behalf of its owner.' " +
  "If an unexpected live person answers and this seems to reach them personally rather than a business line, apologize briefly and end the call politely. ";

export interface RunOptions {
  live: boolean;
  only?: string[];
  timeoutMs: number;
  intervalMs: number;
  /** Injectable clock for tests; defaults to wall time. */
  now?: () => Date;
}

export interface PlannedCall {
  checkId: string;
  lineId: string;
  phone: string;
  task: string;
}

export interface CheckRun {
  planned: PlannedCall;
  outcome: CheckOutcome | null;
  regressions: Regression[];
  skipped: "dry-run" | "unverified-line" | "filtered" | "outside-call-window" | null;
  error: string | null;
}

export interface RunReport {
  startedAt: string;
  live: boolean;
  runs: CheckRun[];
  regressions: Regression[];
  ok: boolean;
}

const ALERTING_KINDS = new Set(["new_failure", "assertion_regressed", "timing_regressed", "confidence_dropped", "still_failing"]);

function lineFor(config: Config, check: CheckConfig): LineConfig {
  // Config validation guarantees the reference resolves.
  return config.lines.find((line) => line.id === check.line)!;
}

/** True when `at` falls inside the operator's calling window. */
export function insideCallWindow(window: CallWindow, at: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: window.timezone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const clock = `${get("hour").padStart(2, "0")}:${get("minute").padStart(2, "0")}`;
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  if (window.days !== undefined && !window.days.includes(dayIndex)) {
    return false;
  }
  return clock >= window.start && clock < window.end;
}

export function idempotencyKeyFor(checkId: string, startedAt: Date): string {
  return `linecanary:${checkId}:${startedAt.toISOString().slice(0, 16)}`;
}

export async function runChecks(
  config: Config,
  port: CallePort | null,
  store: BaselineStore,
  options: RunOptions,
): Promise<RunReport> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const runs: CheckRun[] = [];
  let hadError = false;
  const outsideWindow =
    options.live && config.callWindow !== undefined && !insideCallWindow(config.callWindow, startedAt);

  for (const check of config.checks) {
    const line = lineFor(config, check);
    const task = DISCLOSURE_PREAMBLE + check.task;
    const planned: PlannedCall = { checkId: check.id, lineId: line.id, phone: line.phone, task };
    const run: CheckRun = { planned, outcome: null, regressions: [], skipped: null, error: null };
    runs.push(run);

    if (options.only !== undefined && !options.only.includes(check.id)) {
      run.skipped = "filtered";
      continue;
    }
    if (!options.live) {
      run.skipped = "dry-run";
      continue;
    }
    if (outsideWindow) {
      // The operator said when this line may ring. Outside that window the
      // canary stays quiet; the next scheduled run inside the window catches up.
      run.skipped = "outside-call-window";
      continue;
    }
    const verification = store.verification(line.id);
    if (verification === null || verification.phone !== line.phone) {
      run.skipped = "unverified-line";
      continue;
    }
    if (port === null) {
      throw new Error("Live run requires a CALL-E port.");
    }

    try {
      const created = await port.createCall(
        {
          task,
          recipients: [{ phones: [line.phone], region: line.region, locale: line.locale }],
          resultSchema: check.resultSchema,
          metadata: { linecanary_check: check.id, linecanary_line: line.id },
        },
        idempotencyKeyFor(check.id, startedAt),
      );
      const terminal = await port.waitForResult(created.id, {
        timeoutMs: options.timeoutMs,
        intervalMs: options.intervalMs,
      });
      const outcome = evaluateCheck(check, line.id, terminal);
      run.outcome = outcome;
      run.regressions = diffAgainstBaseline(outcome, store.history(check.id));
      store.append(outcome);
    } catch (error) {
      hadError = true;
      if (error instanceof ApiError) {
        run.error = `${error.code}${error.ambiguous ? " (ambiguous: a call may exist)" : ""}: ${error.message}`;
      } else if (error instanceof CallTimeoutError) {
        run.error = `timeout waiting for the call result: ${error.message}`;
      } else {
        run.error = String(error);
      }
    }
  }

  const regressions = runs.flatMap((run) => run.regressions);
  const ok = !hadError && !regressions.some((entry) => ALERTING_KINDS.has(entry.kind));
  return { startedAt: startedAt.toISOString(), live: options.live, runs, regressions, ok };
}
