import { describe, expect, it } from "vitest";

import { resolveWorkflowErrorMessage, isUpgradeWorkflowCode } from "../server/_core/workflow-errors";
import { mapErrorToUserMessage } from "../server/calle/error-taxonomy";

describe("workflow error resolution", () => {
  it("uses calle taxonomy for policy errors", () => {
    expect(resolveWorkflowErrorMessage("missing_consent")).toBe(
      mapErrorToUserMessage("missing_consent").userMessage,
    );
  });

  it("prefers explicit billing message", () => {
    expect(resolveWorkflowErrorMessage("upgrade_required", "Custom billing text")).toBe(
      "Custom billing text",
    );
  });

  it("detects upgrade workflow codes", () => {
    expect(isUpgradeWorkflowCode("insufficient_call_credits")).toBe(true);
    expect(isUpgradeWorkflowCode("missing_consent")).toBe(false);
  });
});

describe("calle error taxonomy extensions", () => {
  it("maps billing-related call codes", () => {
    expect(mapErrorToUserMessage("insufficient_call_credits").userMessage).toContain("credit");
    expect(mapErrorToUserMessage("call_e_disabled").userMessage).toContain("disabled");
    expect(mapErrorToUserMessage("timeout").userMessage).toContain("timed out");
    expect(mapErrorToUserMessage("call_failed").userMessage).toContain("dialer");
  });
});
