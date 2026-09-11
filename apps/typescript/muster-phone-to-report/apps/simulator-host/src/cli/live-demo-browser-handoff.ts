import { spawn } from "node:child_process";

import {
  isExactLiveDemoViewerReadiness,
  type LiveDemoReviewIdentity,
  type LiveDemoViewerReadinessObservation,
} from "../live-runs/live-demo-review-session.js";

const opaqueIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DEFAULT_READINESS_TIMEOUT_MS = 60_000;

export type LiveDemoBrowserHandoffResult =
  | Readonly<{ outcome: "attached"; identity: LiveDemoReviewIdentity }>
  | Readonly<{ outcome: "blocked"; reason: "launch_failed" | "readiness_timeout" }>;

export interface LiveDemoBrowserHandoff {
  attach(input: {
    readonly simulatorUrl: string;
    readonly identity: LiveDemoReviewIdentity;
    readonly timeoutMs?: number;
  }): Promise<LiveDemoBrowserHandoffResult>;
  observe(observation: LiveDemoViewerReadinessObservation): void;
}

function exactIdentity(identity: LiveDemoReviewIdentity): LiveDemoReviewIdentity {
  if (
    !opaqueIdentifier.test(identity.operationId) ||
    !opaqueIdentifier.test(identity.scenarioId) ||
    !Number.isSafeInteger(identity.scenarioRevision) ||
    identity.scenarioRevision < 1 ||
    identity.scenarioRevision > 100
  ) {
    throw new Error("Live demo browser identity is invalid");
  }
  return Object.freeze({ ...identity });
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname === "[::1]" ? "::1" : hostname;
  return ["127.0.0.1", "::1", "localhost"].includes(normalized);
}

function handoffUrl(simulatorUrl: string, identity: LiveDemoReviewIdentity): string {
  const target = new URL(simulatorUrl);
  if (
    target.protocol !== "http:" ||
    !isLoopbackHostname(target.hostname) ||
    target.username.length > 0 ||
    target.password.length > 0 ||
    target.pathname !== "/simulator.html" ||
    target.search.length > 0 ||
    target.hash.length > 0
  ) {
    throw new Error("Live demo browser URL is invalid");
  }
  target.hash = new URLSearchParams({
    operationId: identity.operationId,
    scenarioId: identity.scenarioId,
    scenarioRevision: String(identity.scenarioRevision),
  }).toString();
  return target.href;
}

export async function launchSystemBrowser(url: string): Promise<void> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "http:" ||
    !isLoopbackHostname(parsed.hostname) ||
    parsed.pathname !== "/simulator.html"
  ) {
    throw new Error("Live demo browser launch URL is invalid");
  }
  const command =
    process.platform === "win32"
      ? Object.freeze({
          file: "explorer.exe",
          arguments: [url],
        })
      : process.platform === "darwin"
        ? Object.freeze({ file: "open", arguments: [url] })
        : Object.freeze({ file: "xdg-open", arguments: [url] });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.arguments, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export function createLiveDemoBrowserHandoff(input: {
  readonly launchBrowser: (url: string) => Promise<void>;
  readonly scheduleDeadline?: (callback: () => void, delayMs: number) => () => void;
}): LiveDemoBrowserHandoff {
  const scheduleDeadline =
    input.scheduleDeadline ??
    ((callback: () => void, delayMs: number): (() => void) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref();
      return () => clearTimeout(timer);
    });
  let pending:
    | Readonly<{
        identity: LiveDemoReviewIdentity;
        finish(result: LiveDemoBrowserHandoffResult): void;
      }>
    | undefined;

  return Object.freeze({
    async attach({
      simulatorUrl,
      identity: candidate,
      timeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
    }: {
      readonly simulatorUrl: string;
      readonly identity: LiveDemoReviewIdentity;
      readonly timeoutMs?: number;
    }) {
      if (pending !== undefined) throw new Error("Live demo browser handoff is already pending");
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
        throw new Error("Live demo browser readiness timeout is invalid");
      }
      const identity = exactIdentity(candidate);
      const url = handoffUrl(simulatorUrl, identity);
      let finish!: (result: LiveDemoBrowserHandoffResult) => void;
      const readiness = new Promise<LiveDemoBrowserHandoffResult>((resolve) => {
        finish = resolve;
      });
      let settled = false;
      let cancelDeadline = (): void => undefined;
      const complete = (result: LiveDemoBrowserHandoffResult): void => {
        if (settled) return;
        settled = true;
        pending = undefined;
        cancelDeadline();
        finish(result);
      };
      pending = Object.freeze({ identity, finish: complete });
      cancelDeadline = scheduleDeadline(
        () => complete(Object.freeze({ outcome: "blocked", reason: "readiness_timeout" })),
        timeoutMs,
      );
      if (settled) return await readiness;
      try {
        await input.launchBrowser(url);
      } catch {
        complete(Object.freeze({ outcome: "blocked", reason: "launch_failed" }));
      }
      return await readiness;
    },
    observe(observation: LiveDemoViewerReadinessObservation) {
      const active = pending;
      if (active === undefined || !isExactLiveDemoViewerReadiness(active.identity, observation)) {
        return;
      }
      active.finish(Object.freeze({ outcome: "attached", identity: active.identity }));
    },
  });
}
