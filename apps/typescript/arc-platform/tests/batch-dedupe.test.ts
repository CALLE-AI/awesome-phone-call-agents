import { describe, it, expect } from "vitest";
import { resolvePhone, isE164 } from "@/lib/calle";

/**
 * The grouping the batch route performs. Two targets with no phone of their
 * own both resolve to CALLE_DEMO_PHONE; dialling both at once is what produced
 * SIP 486 Busy Here 166ms apart on 29 August.
 */
function groupByPhone(targets: { name: string; phone?: string }[], demo: string) {
  const byPhone = new Map<string, string[]>();
  const unreachable: string[] = [];
  for (const t of targets) {
    const phone = (t.phone && t.phone.trim()) || demo || "";
    if (!isE164(phone)) { unreachable.push(t.name); continue; }
    byPhone.set(phone, [...(byPhone.get(phone) ?? []), t.name]);
  }
  return { byPhone, unreachable };
}

describe("batch calls dedupe by resolved number", () => {
  const DEMO = "+923005550000";

  it("dials one call for targets that share the demo number", () => {
    const { byPhone } = groupByPhone([{ name: "Mast FM 103" }, { name: "FM 101" }], DEMO);
    expect(byPhone.size).toBe(1);
    expect(byPhone.get(DEMO)).toEqual(["Mast FM 103", "FM 101"]);
  });

  it("dials separately when targets carry their own numbers", () => {
    const { byPhone } = groupByPhone(
      [{ name: "A", phone: "+923001234567" }, { name: "B", phone: "+971501234567" }], DEMO);
    expect(byPhone.size).toBe(2);
  });

  it("reports targets with no reachable number instead of dialling", () => {
    const { byPhone, unreachable } = groupByPhone([{ name: "A" }], "");
    expect(byPhone.size).toBe(0);
    expect(unreachable).toEqual(["A"]);
  });

  it("a typed number still beats the demo fallback", () => {
    expect(resolvePhone("+971501234567")).toBe("+971501234567");
  });
});
