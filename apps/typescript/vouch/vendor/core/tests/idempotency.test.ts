import { describe, expect, it } from "vitest";
import { headcountKey, vouchKey } from "../src/idempotency";

describe("idempotency keys", () => {
  it("derives headcount keys from the authorization, not the attempt", () => {
    expect(
      headcountKey({
        eventId: "evt_sonoma",
        rosterEntryId: "rst_01",
        waveNo: 1,
        instrumentVersion: 1,
      }),
    ).toBe("hc:evt_sonoma:rst_01:1:1");
  });

  it("derives vouch keys from consent scope", () => {
    expect(
      vouchKey({
        consentId: "cns_1",
        employerId: "emp_acme",
        fieldSetHash: "abc123",
        scopeVersion: 2,
      }),
    ).toBe("vo:cns_1:emp_acme:abc123:2");
  });
});
