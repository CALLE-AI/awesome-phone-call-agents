import { describe, expect, it } from "vitest";

import { evaluateLiveCallGate } from "@/application/live-call-gate";
import { parseServerEnvironment } from "@/config/environment";

const protectedWorkspace = {
  kind: "protected",
  provider: "call_e",
  liveCallsAllowed: true,
  role: "operator",
  globalKillSwitchPaused: false,
} as const;

const liveEnvironment = parseServerEnvironment({
  FIELDCLOSE_DEMO_MODE: "false",
  FIELDCLOSE_LIVE_CALLS_ENABLED: "true",
  CALL_E_API_KEY: "test-api-key",
});

describe("live call gate", () => {
  it("always blocks demo mode even when every other gate is open", () => {
    const environment = parseServerEnvironment({
      FIELDCLOSE_DEMO_MODE: "true",
      FIELDCLOSE_LIVE_CALLS_ENABLED: "true",
      CALL_E_API_KEY: "test-api-key",
    });

    expect(evaluateLiveCallGate(environment, protectedWorkspace)).toEqual({
      allowed: false,
      reason: "demo_mode",
    });
  });

  it("requires both the server flag and CALL-E credentials", () => {
    const flagDisabled = parseServerEnvironment({
      FIELDCLOSE_DEMO_MODE: "false",
      FIELDCLOSE_LIVE_CALLS_ENABLED: "false",
      CALL_E_API_KEY: "test-api-key",
    });
    const credentialsMissing = parseServerEnvironment({
      FIELDCLOSE_DEMO_MODE: "false",
      FIELDCLOSE_LIVE_CALLS_ENABLED: "true",
    });

    expect(evaluateLiveCallGate(flagDisabled, protectedWorkspace)).toEqual({
      allowed: false,
      reason: "environment_flag_disabled",
    });
    expect(evaluateLiveCallGate(credentialsMissing, protectedWorkspace)).toEqual({
      allowed: false,
      reason: "call_e_credentials_missing",
    });
  });

  it.each([
    [
      "workspace_not_protected",
      { ...protectedWorkspace, kind: "demo" as const },
    ],
    [
      "workspace_provider_not_call_e",
      { ...protectedWorkspace, provider: "fake" as const },
    ],
    [
      "workspace_live_calls_disabled",
      { ...protectedWorkspace, liveCallsAllowed: false },
    ],
    [
      "global_kill_switch_paused",
      { ...protectedWorkspace, globalKillSwitchPaused: true },
    ],
    [
      "operator_role_forbidden",
      { ...protectedWorkspace, role: "auditor" as const },
    ],
  ])("blocks when %s", (reason, context) => {
    expect(evaluateLiveCallGate(liveEnvironment, context)).toEqual({
      allowed: false,
      reason,
    });
  });

  it("allows an operator only when every independent gate is open", () => {
    expect(evaluateLiveCallGate(liveEnvironment, protectedWorkspace)).toEqual({
      allowed: true,
    });
  });
});
