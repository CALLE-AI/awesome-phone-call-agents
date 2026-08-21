import { describe, expect, it } from "vitest";
import {
  frameFromNppes,
  frameFromPaste,
  normalizeUsPhone,
  parsePastedRows,
  provenanceLabel,
} from "../src/core/frame";

describe("normalizeUsPhone", () => {
  it("normalizes the common directory formats", () => {
    expect(normalizeUsPhone("(215) 555-0100")).toBe("+12155550100");
    expect(normalizeUsPhone("215-555-0100")).toBe("+12155550100");
    expect(normalizeUsPhone("+1 215 555 0100")).toBe("+12155550100");
    expect(normalizeUsPhone("2155550100")).toBe("+12155550100");
    expect(normalizeUsPhone("12155550100")).toBe("+12155550100");
  });

  it("rejects unusable numbers rather than guessing", () => {
    expect(normalizeUsPhone("")).toBeNull();
    expect(normalizeUsPhone("555-0100")).toBeNull();
    expect(normalizeUsPhone("+44 20 7946 0000")).toBeNull();
    expect(normalizeUsPhone("hello")).toBeNull();
  });
});

describe("parsePastedRows", () => {
  it("parses tab-separated name/phone/note rows", () => {
    const rows = parsePastedRows("Jane Doe\t(215) 555-0100\tADHD eval\nBob Smith\t555-0199");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Jane Doe", phone: "(215) 555-0100", note: "ADHD eval" });
  });

  it("skips blank lines and rows without phones", () => {
    expect(parsePastedRows("\n\n  \nName Only\n")).toHaveLength(0);
  });
});

describe("frameFromPaste", () => {
  it("drops rows with non-normalizable numbers and attributes provenance", () => {
    const cands = frameFromPaste(
      [
        { name: "A", phone: "(215) 555-0100" },
        { name: "B", phone: "not a phone" },
      ],
      "alice",
    );
    expect(cands).toHaveLength(1);
    expect(cands[0]!.phoneE164).toBe("+12155550100");
    expect(cands[0]!.provenance.kind).toBe("paste");
    expect(cands[0]!.provenance.source).toBe("alice");
    expect(provenanceLabel(cands[0]!.provenance)).toContain("alice");
  });
});

describe("frameFromNppes", () => {
  function stubFetch(urls: string[], results: unknown = []) {
    return (async (url: string | URL | Request) => {
      urls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ results }),
      } as Response;
    }) as typeof fetch;
  }

  it("omits enumeration_type by default so organizations are not discarded", async () => {
    const urls: string[] = [];
    await frameFromNppes(
      { city: "Philadelphia", state: "PA", taxonomy: "Psychiatry" },
      { fetch: stubFetch(urls) },
    );
    expect(urls[0]).not.toContain("enumeration_type");
  });

  it("includes enumeration_type when explicitly requested", async () => {
    const urls: string[] = [];
    await frameFromNppes(
      { city: "Philadelphia", state: "PA", taxonomy: "Psychiatry", enumerationType: "NPI-1" },
      { fetch: stubFetch(urls) },
    );
    expect(urls[0]).toContain("enumeration_type=NPI-1");
  });

  it("labels a candidate with the taxonomy matching the filter, not an unrelated primary", async () => {
    const fetchFn = stubFetch([], [
      {
        number: "1234567890",
        basic: { organization_name: "Mind Clinic" },
        addresses: [{ address_purpose: "LOCATION", telephone_number: "(215) 555-0100" }],
        taxonomies: [
          { desc: "Counselor, Mental Health", primary: true },
          { desc: "Psychiatry & Neurology, Psychiatry", primary: false },
        ],
      },
    ]);
    const candidates = await frameFromNppes(
      { city: "Philadelphia", state: "PA", taxonomy: "Psychiatry" },
      { fetch: fetchFn },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.specialty).toBe("Psychiatry & Neurology, Psychiatry");
  });
});
