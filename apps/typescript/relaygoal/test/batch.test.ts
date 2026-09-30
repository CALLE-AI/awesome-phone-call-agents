import { describe, it, expect } from "vitest";
import { runVerifiedBatch, parseComparable, type RankSpec } from "../src/core/batch";
import { FakeCalle } from "../src/core/fakecalle";
import { pharmacyCompareA, pharmacyCompareB, pharmacyCompareC } from "../src/scenarios";
import type { CalleCallResult, CreateCallInput } from "../src/core/types";

const recipients = [
  { id: "a", label: "Rivertown", phone: "+12025550142" },
  { id: "b", label: "Central", phone: "+12025550177" },
  { id: "c", label: "Eastside", phone: "+12025550188" },
];

const byPhone: Record<string, CalleCallResult> = {
  "+12025550142": pharmacyCompareA,
  "+12025550177": pharmacyCompareB,
  "+12025550188": pharmacyCompareC,
};

const rank: RankSpec = {
  gateKey: "in_stock",
  gateEquals: "yes",
  compareKey: "price",
  kind: "price",
  direction: "asc",
  describe: "in stock, then cheapest (verified only)",
};

const keys = ["in_stock", "price"];

describe("runVerifiedBatch — honest reconciliation", () => {
  it("recommends the cheapest place whose in-stock AND price are BOTH verified", async () => {
    const client = new FakeCalle((input: CreateCallInput) => byPhone[input.phone]!);
    const out = await runVerifiedBatch(client, { task: "...", recipients, resultSchema: {}, requestedKeys: keys, rank });

    expect(out.bestId).toBe("a"); // A: in stock + $4.20, both verified

    const b = out.items.find((i) => i.recipient.id === "b")!;
    expect(b.outcome.fields.find((f) => f.key === "in_stock")!.status).toBe("verified");
    // B stated it's in stock but never gave a price on the call -> price must be unverified,
    // so B can't win on price even though it's cheaper on paper ($8 vs $4.20 is moot).
    expect(b.outcome.fields.find((f) => f.key === "price")!.status).toBe("unverified");

    const c = out.items.find((i) => i.recipient.id === "c")!;
    expect(c.outcome.fields.find((f) => f.key === "in_stock")!.value).toBe("no");
  });

  it("returns NO winner when no place can be confirmed to qualify", async () => {
    const client = new FakeCalle((input: CreateCallInput) => byPhone[input.phone]!);
    const out = await runVerifiedBatch(client, {
      task: "...",
      recipients: recipients.filter((r) => r.id !== "a"), // only B (unverified price) and C (out of stock)
      resultSchema: {},
      requestedKeys: keys,
      rank,
    });
    expect(out.bestId).toBeNull();
    expect(out.reason).toMatch(/call them yourself/i);
  });

  it("parseComparable extracts the leading number", () => {
    expect(parseComparable("$4.20")).toBeCloseTo(4.2);
    expect(parseComparable("about 40 minutes")).toBe(40);
  });
});
