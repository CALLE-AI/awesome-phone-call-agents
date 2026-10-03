import { describe, expect, it } from "vitest";
import { gateRows, POLICY_GATES } from "../../src/domain/gates";

describe("gateRows", () => {
  it("marks every concrete binding gate failed when a binding failure is reported", () => {
    const rows = gateRows(new Set(["binding_call_id"]));
    const binding = rows.filter((r) => r.id.startsWith("binding_"));
    expect(binding.length).toBeGreaterThan(1);
    for (const b of binding) {
      expect(b.status).toBe("fail");
    }
    const others = rows.filter((r) => !r.id.startsWith("binding_"));
    for (const o of others) {
      expect(o.status).toBe("pass");
    }
  });

  it("fails the exact failed gate only", () => {
    const rows = gateRows(new Set(["confidence_threshold"]));
    expect(rows.find((r) => r.id === "confidence_threshold")!.status).toBe("fail");
    expect(rows.find((r) => r.id === "schema_valid")!.status).toBe("pass");
  });

  it("surfaces unknown failed gate ids as failures rather than dropping them", () => {
    const rows = gateRows(new Set(["future_gate_x"]));
    expect(rows.some((r) => r.id === "future_gate_x" && r.status === "fail")).toBe(true);
  });

  it("marks everything pending before any evaluation", () => {
    const rows = gateRows(null);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  it("covers every gate id the evaluator can emit", () => {
    const known = new Set(POLICY_GATES.map((g) => g.id));
    for (const id of [
      "binding_call_id",
      "binding_intent",
      "binding_request_hash",
      "binding_task_version",
      "binding_schema_version",
      "binding_destination",
      "provider_status_terminal",
      "provider_completed",
      "task_completed",
      "recipient_completed",
      "schema_valid",
      "identity_confirmed",
      "case_code_confirmed",
      "no_sensitive_data",
      "no_opt_out",
      "change_status_answered",
      "confidence_threshold",
      "evidence_present",
    ]) {
      expect(known.has(id)).toBe(true);
    }
  });
});
