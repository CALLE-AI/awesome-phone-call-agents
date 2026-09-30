import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { assertJobTransition, canTransitionJob, workflowStatusToJobState } from "../server/calle/call-job";
import { getCapabilitySnapshot, isSupportedCallLanguage, isSupportedRegion } from "../server/calle/capabilities";
import { loadCalleConfig, getCallePublicConfig } from "../server/calle/config";
import { normalizeStructuredResult } from "../server/calle/normalize-result";
import { runPreflight } from "../server/calle/preflight";
import { evaluateRetry, MAX_CALL_RETRIES } from "../server/calle/retry-policy";
import { createCalleService } from "../server/calle/service";
import type { PrepareCallInput } from "../server/calle/types";

const basePrepare = (): PrepareCallInput => ({
  womanId: "demo-woman",
  purpose: "follow_up_after_check_in",
  recipientE164: "+15555550123",
  recipientRegion: "US",
  callLanguage: "en",
  triageState: "contact_chw_today",
  callConsentGranted: true,
  consentSource: "chw_attestation",
  actionToken: "action-token-12345678",
  forceDryRun: true,
});

describe("CALL-E V2 capabilities", () => {
  it("exposes honest unsupported claims", () => {
    const snapshot = getCapabilitySnapshot();
    expect(snapshot.unsupportedClaims).toContain("Bangladesh");
    expect(snapshot.unsupportedClaims).toContain("bn");
    expect(snapshot.cancelSupported).toBe(false);
  });

  it("checks region and language via registry", () => {
    expect(isSupportedRegion("us")).toBe(true);
    expect(isSupportedRegion("BD")).toBe(false);
    expect(isSupportedCallLanguage("en-gb")).toBe(true);
    expect(isSupportedCallLanguage("bn")).toBe(false);
  });
});

describe("CALL-E V2 config", () => {
  it("defaults to demo mode without secrets when demo flag is on", () => {
    const config = loadCalleConfig({
      calleApiKey: "",
      calleLiveCalls: false,
      calleKillSwitch: false,
      calleDemoMode: true,
    } as never);
    expect(config.mode).toBe("demo");
    expect(
      loadCalleConfig({
        calleApiKey: "",
        calleLiveCalls: false,
        calleKillSwitch: false,
        calleDemoMode: false,
      } as never).mode,
    ).toBe("dry_run");
    expect(
      getCallePublicConfig({
        calleApiKey: "secret",
        calleLiveCalls: true,
        calleKillSwitch: false,
        calleDemoMode: false,
      } as never),
    ).toMatchObject({
      configured: true,
      mode: "live",
    });
  });
});

describe("CALL-E V2 preflight", () => {
  it("returns non-blocking consent source warning", () => {
    const result = runPreflight(
      { ...basePrepare(), consentSource: undefined },
      { liveCallsEnabled: false, hasApiKey: false, killSwitch: false },
    );
    expect(result.allowed).toBe(true);
    expect(result.reasons.some((r) => r.field === "consentSource" && !r.blocking)).toBe(true);
  });

  it("blocks invalid phone numbers", () => {
    const result = runPreflight(
      { ...basePrepare(), recipientE164: "5551234" as never },
      { liveCallsEnabled: true, hasApiKey: true, killSwitch: false },
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons.some((r) => r.code === "invalid_recipient")).toBe(true);
  });
});

describe("CALL-E V2 call job transitions", () => {
  it("allows prepared -> starting -> dry_run_completed", () => {
    expect(() => assertJobTransition("prepared", "starting")).not.toThrow();
    expect(() => assertJobTransition("starting", "dry_run_completed")).not.toThrow();
    expect(workflowStatusToJobState("dry_run_completed")).toBe("completed");
  });

  it("rejects illegal transitions", () => {
    expect(canTransitionJob("completed", "ready")).toBe(false);
    expect(() => assertJobTransition("completed", "prepared")).toThrow(/Illegal call job transition/);
  });
});

describe("CALL-E V2 result normalization", () => {
  it("coerces unreachable ok_routine to no_answer", () => {
    const normalized = normalizeStructuredResult({
      reached: false,
      availability: "unavailable",
      needsHumanFollowUp: false,
      appointmentConfirmed: null,
      preferredCallbackWindow: "none",
      safetyEscalation: "none",
      summaryCode: "ok_routine",
      nextAction: "call_again",
    });
    expect(normalized?.summaryCode).toBe("no_answer");
    expect(normalized?.normalizationNotes.length).toBeGreaterThan(0);
  });
});

describe("CALL-E V2 retry policy", () => {
  it("stops after max retries", () => {
    const decision = evaluateRetry({
      status: "no_answer",
      failureCode: "no_answer",
      attemptCount: MAX_CALL_RETRIES,
    });
    expect(decision.canRetry).toBe(false);
    expect(decision.reason).toBe("retry_exhausted");
  });
});

describe("CALL-E V2 service extensions", () => {
  it("returns capabilities without secrets", () => {
    const service = createCalleService({
      config: {
        apiKey: "super-secret-key",
        liveCallsEnabled: true,
        killSwitch: false,
        configured: true,
        demoMode: false,
        mode: "live",
      },
    });
    const caps = service.getCapabilities();
    expect(JSON.stringify(caps)).not.toContain("super-secret-key");
    expect(caps.publicConfig.mode).toBe("live");
  });

  it("tracks attempt count on confirm", async () => {
    const service = createCalleService({
      env: { liveCallsEnabled: false, hasApiKey: false, killSwitch: false, apiKey: "" },
      store: new Map(),
      idempotency: new Map(),
    });
    const prepared = await service.prepare(basePrepare(), 1);
    const confirmed = await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      1,
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.workflow.attemptCount).toBe(1);
  });
});

describe("CALL-E client secret guard", () => {
  function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules") continue;
        walk(full, acc);
      } else if (/\.(tsx?|jsx?)$/.test(entry)) {
        acc.push(full);
      }
    }
    return acc;
  }

  it("never references CALLE_API_KEY in Expo app code", () => {
    const appRoot = join(process.cwd(), "app");
    const files = walk(appRoot);
    const offenders = files.filter((file) => {
      const content = readFileSync(file, "utf8");
      return /CALLE_API_KEY|process\.env\.CALLE/.test(content);
    });
    expect(offenders).toEqual([]);
  });
});
