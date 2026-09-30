import { describe, it, expect } from "vitest";
import { maskPhone, deepMaskPhones, maskedJson } from "@/lib/mask";

const REAL = "+923005550000";

describe("maskPhone", () => {
  it("keeps the country code and the tail, hides the rest", () => {
    const m = maskPhone(REAL)!;
    expect(m.startsWith("+92")).toBe(true);
    expect(m.endsWith("00")).toBe(true);
    expect(m).toContain("•");
  });

  /* The property that matters: what comes out must not be dialable. */
  it("leaves no more than four digits of a real number", () => {
    const digits = (maskPhone(REAL)!.match(/\d/g) ?? []).length;
    expect(digits).toBeLessThanOrEqual(4);
  });

  it("keeps two different numbers distinguishable", () => {
    expect(maskPhone("+923005550000")).not.toBe(maskPhone("+923005550111"));
  });

  it("reveals more only when asked, and never the whole number", () => {
    const m = maskPhone(REAL, 4)!;
    expect(m.endsWith("0000")).toBe(true);
    expect(m).not.toContain("30055");
  });

  it("masks short number-ish values rather than passing them through", () => {
    expect(maskPhone("12345")).not.toContain("1");
  });

  it("passes null and empty through as null", () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone(undefined)).toBeNull();
    expect(maskPhone("  ")).toBeNull();
  });
});

describe("deepMaskPhones", () => {
  /* The reason this is recursive: the shapes come from a provider SDK and
     will change without telling us. */
  it("reaches numbers nested anywhere", () => {
    const payload = {
      recipient: { phones: [REAL], region: "PK" },
      attempts: [{ to: REAL, note: `dialled ${REAL} at 09:00` }],
    };
    expect(JSON.stringify(deepMaskPhones(payload))).not.toContain("3005550000");
  });

  it("masks numbers embedded in prose", () => {
    const out = deepMaskPhones(`we called ${REAL} twice`) as string;
    expect(out).not.toContain("3005550000");
    expect(out).toContain("we called");
  });

  it("leaves keys and non-numeric values alone", () => {
    const out = deepMaskPhones({ phone: REAL, name: "City FM 89", ok: true, n: null });
    expect(Object.keys(out)).toEqual(["phone", "name", "ok", "n"]);
    expect(out.name).toBe("City FM 89");
    expect(out.ok).toBe(true);
    expect(out.n).toBeNull();
  });

  it("survives a cycle rather than hanging", () => {
    const a: Record<string, unknown> = { phone: REAL };
    a.self = a;
    expect(() => deepMaskPhones(a)).not.toThrow();
    expect(JSON.stringify(deepMaskPhones(a))).not.toContain("3005550000");
  });

  /* Short digit strings that are not destinations should not be mangled into
     nonsense - a year or a rate is not a phone number. */
  it("leaves small numbers in prose alone", () => {
    expect(deepMaskPhones("the rate was 8000 rupees")).toBe("the rate was 8000 rupees");
  });
});

describe("maskedJson", () => {
  it("never emits a real number", () => {
    expect(maskedJson({ recipient: { phones: [REAL] } })).not.toContain("3005550000");
  });

  it("does not throw on something unserialisable", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    /* deepMaskPhones breaks the cycle, so this serialises rather than
       throwing - the point is that the caller never sees an exception from a
       log line. */
    expect(() => maskedJson(cyclic)).not.toThrow();
    expect(maskedJson(BigInt(1) as unknown)).toBe("[unserialisable]");
  });
});
