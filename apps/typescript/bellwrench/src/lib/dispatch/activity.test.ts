import { describe, expect, it } from "vitest";

import { buildDispatchActivity } from "./activity";

describe("buildDispatchActivity", () => {
  it("labels the prepare phase as a safe no-call workspace", () => {
    expect(
      buildDispatchActivity({
        phase: "prepare",
        readiness: "configuration_required",
        vendorCount: 2,
        safetySafe: true,
        confirmed: false,
        isCalling: false,
        responseStatus: null,
      }),
    ).toEqual([
      { label: "Workspace", value: "Drafting request", tone: "active" },
      { label: "CALL-E", value: "Setup required", tone: "warning" },
      { label: "Safety", value: "Non-emergency screen active", tone: "success" },
      { label: "Roster", value: "2 vendors selected", tone: "neutral" },
    ]);
  });

  it("never describes an unconfirmed preview as an active call", () => {
    expect(
      buildDispatchActivity({
        phase: "preview",
        readiness: "ready",
        vendorCount: 1,
        safetySafe: true,
        confirmed: false,
        isCalling: false,
        responseStatus: null,
      }),
    ).toContainEqual({
      label: "Approval",
      value: "Waiting for operator",
      tone: "warning",
    });
  });

  it("describes a ready health check as configured rather than connected", () => {
    const items = buildDispatchActivity({
      phase: "prepare",
      readiness: "ready",
      vendorCount: 1,
      safetySafe: true,
      confirmed: false,
      isCalling: false,
      responseStatus: null,
    });

    expect(items).toContainEqual({
      label: "CALL-E",
      value: "Configured",
      tone: "success",
    });
  });

  it("does not claim final readiness when confirmation exists but setup is missing", () => {
    const items = buildDispatchActivity({
      phase: "preview",
      readiness: "configuration_required",
      vendorCount: 1,
      safetySafe: true,
      confirmed: true,
      isCalling: false,
      responseStatus: null,
    });

    expect(items).toContainEqual({
      label: "Approval",
      value: "Waiting for CALL-E setup",
      tone: "warning",
    });
  });
});
