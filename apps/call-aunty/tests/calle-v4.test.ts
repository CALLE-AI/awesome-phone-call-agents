import { describe, expect, it } from "vitest";

import { buildCallBriefRuleBased } from "../server/ai/call-brief";
import {
  filterCommandCenterRows,
  summarizeCommandCenter,
  workflowToCommandRow,
} from "../server/calle/command-center";
import {
  advanceConversation,
  assertConversationTransition,
  getConversationState,
  reduceConversationState,
  resetConversation,
} from "../server/calle/conversation-state";
import { compileCallIntent, compileFromColloquial } from "../server/calle/intent-compiler";
import {
  getDemoProviderCapabilities,
  getLiveProviderCapabilities,
  resolveProviderCapabilities,
} from "../server/calle/provider-capabilities";
import { createCalleService, maskE164 } from "../server/calle/service";
import { loadV4FeatureFlags } from "../server/calle/v4-flags";
import type { CallWorkflow } from "../server/calle/types";

const basePrepare = {
  womanId: "demo-ben-001",
  purpose: "follow_up_after_check_in" as const,
  recipientE164: "+15555550123",
  recipientRegion: "US",
  callLanguage: "en",
  triageState: "contact_chw_today" as const,
  callConsentGranted: true,
  consentSource: "chw_attestation" as const,
  actionToken: "action-token-12345678",
  forceDryRun: true,
};

function mockWorkflow(overrides: Partial<CallWorkflow> = {}): CallWorkflow {
  const now = new Date().toISOString();
  return {
    id: "wf_test_001",
    purpose: "follow_up_after_check_in",
    womanId: "Asha Demo",
    recipientE164: "+15555550101",
    recipientRegion: "US",
    callLanguage: "en",
    initiatorUserId: 9,
    triageState: "contact_chw_today",
    callConsentGranted: true,
    consentSource: "chw_attestation",
    attemptCount: 0,
    policyDecision: "dry_run",
    policyReasonCode: "ok",
    policyExplanation: "dry-run",
    idempotencyKey: "idem123456789012345678901234567890123456789012345678",
    prepareToken: "preparetoken12345678901234567890123456789012",
    providerCallId: null,
    status: "prepared",
    dryRun: true,
    structuredResult: null,
    failureCode: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("CALL-E V4 feature flags", () => {
  it("defaults to safe developer mode", () => {
    const flags = loadV4FeatureFlags({
      calleEnabled: true,
      aiEnabled: true,
      calleDemoMode: true,
      calleLiveCalls: false,
      calleKillSwitch: false,
      calleApiKey: "",
    } as never);
    expect(flags.safeDefault).toBe(true);
    expect(flags.demoMode).toBe(true);
  });
});

describe("CALL-E V4 provider capabilities", () => {
  it("documents demo vs live honestly", () => {
    const demo = getDemoProviderCapabilities();
    expect(demo.outboundDialing).toBe(true);
    expect(demo.unsupportedActions.some((a) => a.action === "carrier_dial")).toBe(true);

    const live = getLiveProviderCapabilities({
      apiKey: "k",
      liveCallsEnabled: true,
      killSwitch: false,
      configured: true,
      demoMode: false,
      mode: "live",
    });
    expect(live.outboundDialing).toBe(true);
    expect(live.transfer).toBe(false);
  });

  it("resolves capabilities from config mode", () => {
    const caps = resolveProviderCapabilities({
      apiKey: "",
      liveCallsEnabled: false,
      killSwitch: false,
      configured: false,
      demoMode: true,
      mode: "demo",
    });
    expect(caps.runtime).toBe("demo");
  });
});

describe("CALL-E V4 intent compiler", () => {
  it("compiles structured prepare input", () => {
    const result = compileCallIntent(basePrepare);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent.consentStatus).toBe("granted");
    expect(result.intent.allowedTools.length).toBeGreaterThan(0);
  });

  it("blocks missing consent and urgent triage", () => {
    expect(compileCallIntent({ ...basePrepare, callConsentGranted: false }).ok).toBe(false);
    expect(
      compileCallIntent({ ...basePrepare, triageState: "urgent_in_person_care" }).ok,
    ).toBe(false);
  });

  it("normalizes colloquial reminder phrasing", () => {
    const result = compileFromColloquial("remind Amina about tomorrow appointment");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent.purpose).toBe("appointment_coordination");
    expect(result.intent.source).toBe("colloquial");
  });
});

describe("CALL-E V4 conversation state machine", () => {
  it("walks a simple appointment reminder path", () => {
    resetConversation("wf_conv");
    advanceConversation("wf_conv", "start");
    expect(getConversationState("wf_conv")).toBe("identity_check");
    expect(reduceConversationState("identity_check", "identity_verified")).toBe(
      "purpose_confirmation",
    );
  });

  it("escalates on concern detection path", () => {
    expect(() => assertConversationTransition("greeting", "escalation")).not.toThrow();
    expect(reduceConversationState("concern_detection", "escalate")).toBe("escalation");
  });
});

describe("CALL-E V4 call brief", () => {
  it("caps facts and avoids raw phone numbers in brief", () => {
    const brief = buildCallBriefRuleBased({
      beneficiaryId: "demo-ben-001",
      purpose: "follow_up_after_check_in",
      locale: "en",
    });
    expect(brief.facts.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(brief)).not.toContain("+1555555");
    expect(brief.source).toBe("rule_based");
  });
});

describe("CALL-E V4 command center", () => {
  it("filters rows by bucket and summarizes counts", () => {
    const rows = [
      workflowToCommandRow(mockWorkflow({ status: "prepared" }), maskE164, false),
      workflowToCommandRow(
        mockWorkflow({ id: "wf2", status: "dry_run_completed", policyDecision: "dry_run" }),
        maskE164,
        false,
      ),
    ];
    const pending = filterCommandCenterRows(rows, { bucket: "pending" });
    expect(pending).toHaveLength(1);
    expect(summarizeCommandCenter(rows).completed).toBe(1);
  });

  it("scopes list to initiator user id", async () => {
    const store = new Map<string, CallWorkflow>();
    const service = createCalleService({
      config: {
        apiKey: "",
        liveCallsEnabled: false,
        killSwitch: false,
        configured: false,
        demoMode: true,
        mode: "demo",
      },
      store,
      idempotency: new Map(),
    });
    await service.prepare(basePrepare, 1);
    await service.prepare({ ...basePrepare, womanId: "other", actionToken: "other-token-99999999" }, 2);
    expect(service.listCommandCenter(1).calls).toHaveLength(1);
    expect(service.listCommandCenter(2).calls).toHaveLength(1);
  });
});

describe("CALL-E V4 command detail", () => {
  it("returns compile issues and brief for owned workflow", async () => {
    const service = createCalleService({
      config: {
        apiKey: "",
        liveCallsEnabled: false,
        killSwitch: false,
        configured: false,
        demoMode: true,
        mode: "demo",
      },
      store: new Map(),
      idempotency: new Map(),
    });
    const prepared = await service.prepare(basePrepare, 5);
    const detail = await service.getCallDetail(prepared.workflow.id, 5);
    expect(detail).not.toBeNull();
    expect(detail?.callBrief.briefVersion).toBeTruthy();
    expect(detail?.compiledIntent?.beneficiaryRef).toBe("demo-ben-001");
  });
});
