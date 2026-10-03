import { describe, expect, it } from "vitest";
import { buildCallTask } from "../../src/domain/build-call-task";

const input = {
  vendorDisplayName: "Northstar Components",
  buyerOrgName: "Acme Manufacturing",
  safeCaseCode: "CL-7F3A9C",
};

describe("buildCallTask", () => {
  it("discloses automation, buyer org, safe case code, and the single question", () => {
    const task = buildCallTask(input);
    expect(task).toMatch(/automated/i);
    expect(task).toContain("Acme Manufacturing");
    expect(task).toContain("CL-7F3A9C");
    expect(task).toContain("Northstar Components");
    expect(task).toMatch(/Did your organization initiate a request associated with case code CL-7F3A9C to change where future payments are sent\?/);
  });

  it("forbids financial identifiers and states no change is approved", () => {
    const task = buildCallTask(input);
    expect(task).toMatch(/does not approve|does not apply/i);
    expect(task).toMatch(/do not (state|request|confirm)[^.]*(bank|account|routing|credential|one-time)/i);
    expect(task).toMatch(/refus/i);
    expect(task).toMatch(/60 seconds/i);
  });

  it("contains no bank account, routing, or credential values", () => {
    const task = buildCallTask(input);
    expect(task).not.toMatch(/\b\d{7,}\b/);
    expect(task).not.toMatch(/(account|routing|iban|swift|bic|card|otp|password|ssn|tax id)[^\n]{0,30}\d{4,}/i);
    expect(task).not.toMatch(/\+?\d[\d\s-]{8,}\d/);
  });

  it("rejects safe case codes in a wrong format", () => {
    expect(() => buildCallTask({ ...input, safeCaseCode: "case-123" })).toThrow();
    expect(() => buildCallTask({ ...input, safeCaseCode: "CL-7F3A9C; wire 8877665544" })).toThrow();
  });

  it("rejects inputs carrying financial identifiers", () => {
    expect(() =>
      buildCallTask({ ...input, vendorDisplayName: "Northstar acct 9876543210" }),
    ).toThrow();
    expect(() =>
      buildCallTask({ ...input, buyerOrgName: "Acme routing 021000021" }),
    ).toThrow();
  });
});
