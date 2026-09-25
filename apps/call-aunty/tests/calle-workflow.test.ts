import { describe, expect, it } from "vitest";
import { DryRunCalleAdapter } from "../server/calle/adapter";
import { mapStructuredResultToFollowUp } from "../server/calle/map-to-follow-up";
import { evaluateCallPolicy } from "../server/calle/policy";
import { createCalleService, maskE164 } from "../server/calle/service";
import type { CallStructuredResult, PrepareCallInput } from "../server/calle/types";

const basePrepare = (): PrepareCallInput => ({
  womanId: "demo-woman",
  purpose: "follow_up_after_check_in",
  recipientE164: "+15555550123",
  recipientRegion: "US",
  callLanguage: "en",
  triageState: "contact_chw_today",
  callConsentGranted: true,
  actionToken: "action-token-12345678",
  forceDryRun: true,
});

describe("CALL-E policy", () => {
  it("denies missing consent", () => {
    const result = evaluateCallPolicy(
      { ...basePrepare(), callConsentGranted: false },
      { liveCallsEnabled: true, hasApiKey: true, killSwitch: false },
    );
    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("missing_consent");
  });

  it("denies urgent triage so humans stay primary", () => {
    const result = evaluateCallPolicy(
      { ...basePrepare(), triageState: "urgent_in_person_care" },
      { liveCallsEnabled: true, hasApiKey: true, killSwitch: false },
    );
    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("urgent_state_conflict");
  });

  it("denies unsupported region and language honestly", () => {
    expect(
      evaluateCallPolicy(
        { ...basePrepare(), recipientRegion: "BD" },
        { liveCallsEnabled: true, hasApiKey: true, killSwitch: false },
      ).reasonCode,
    ).toBe("unsupported_region");
    expect(
      evaluateCallPolicy(
        { ...basePrepare(), callLanguage: "bn" },
        { liveCallsEnabled: true, hasApiKey: true, killSwitch: false },
      ).reasonCode,
    ).toBe("unsupported_language");
  });

  it("forces dry-run when live calls are disabled", () => {
    const result = evaluateCallPolicy(basePrepare(), {
      liveCallsEnabled: false,
      hasApiKey: true,
      killSwitch: false,
    });
    expect(result.decision).toBe("dry_run");
    expect(result.dryRun).toBe(true);
  });
});

describe("CALL-E follow-up mapping", () => {
  it("maps urgent escalation to clinician review", () => {
    const result: CallStructuredResult = {
      reached: true,
      availability: "available",
      needsHumanFollowUp: true,
      appointmentConfirmed: null,
      preferredCallbackWindow: "unknown",
      safetyEscalation: "urgent_in_person_care",
      summaryCode: "urgent_care",
      nextAction: "urgent_review",
    };
    expect(mapStructuredResultToFollowUp(result)).toMatchObject({
      outcome: "needs_clinician",
      nextAction: "urgent_review",
      contactMethod: "phone",
    });
  });

  it("maps no-answer without forcing clinician escalation", () => {
    const result: CallStructuredResult = {
      reached: false,
      availability: "unavailable",
      needsHumanFollowUp: false,
      appointmentConfirmed: null,
      preferredCallbackWindow: "none",
      safetyEscalation: "none",
      summaryCode: "no_answer",
      nextAction: "call_again",
    };
    expect(mapStructuredResultToFollowUp(result)).toMatchObject({
      outcome: "no_answer",
      nextAction: "call_again",
    });
  });
});

describe("CALL-E service lifecycle", () => {
  it("masks recipient numbers in public workflow views", () => {
    expect(maskE164("+15555550123")).toBe("+15***23");
  });

  it("is idempotent for prepare with the same action token", async () => {
    const service = createCalleService({
      env: { liveCallsEnabled: false, hasApiKey: false, killSwitch: false, apiKey: "" },
      adapter: new DryRunCalleAdapter(),
      store: new Map(),
      idempotency: new Map(),
    });
    const first = await service.prepare(basePrepare(), 7);
    const second = await service.prepare(basePrepare(), 7);
    expect(second.reused).toBe(true);
    expect(second.workflow.id).toBe(first.workflow.id);
  });

  it("completes confirm in dry-run and returns follow-up mapping", async () => {
    const service = createCalleService({
      env: { liveCallsEnabled: false, hasApiKey: false, killSwitch: false, apiKey: "" },
      adapter: new DryRunCalleAdapter(),
      store: new Map(),
      idempotency: new Map(),
    });
    const prepared = await service.prepare(basePrepare(), 3);
    const confirmed = await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      3,
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.workflow.status).toBe("dry_run_completed");
    expect(confirmed.workflow.dryRun).toBe(true);
    expect(confirmed.followUp?.contactMethod).toBe("phone");
    expect(confirmed.followUp?.nextAction).toBe("call_again");
  });

  it("rejects confirm from a different initiator", async () => {
    const service = createCalleService({
      env: { liveCallsEnabled: false, hasApiKey: false, killSwitch: false, apiKey: "" },
      adapter: new DryRunCalleAdapter(),
      store: new Map(),
      idempotency: new Map(),
    });
    const prepared = await service.prepare(basePrepare(), 1);
    const confirmed = await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      2,
    );
    expect(confirmed.ok).toBe(false);
    if (confirmed.ok) return;
    expect(confirmed.code).toBe("unauthorized");
  });
});
