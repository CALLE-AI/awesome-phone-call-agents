import { describe, expect, it } from "vitest";
import {
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
