import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  attestationSchema,
  consentSchema,
  offerRelaySchema,
  parseAttestation,
  parseConsent,
  parseOffer,
  strictSubsetViolations,
  validateStrictSubset,
} from "../src/schemas.js";

interface SchemaNode {
  type: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  items?: SchemaNode;
  description?: string;
}

function asNode(schema: Record<string, unknown>): SchemaNode {
  return schema as unknown as SchemaNode;
}

describe("schema builders", () => {
  it("all three builders pass the strict-subset validator", () => {
    expect(() => validateStrictSubset(consentSchema())).not.toThrow();
    expect(() => validateStrictSubset(offerRelaySchema(700))).not.toThrow();
    expect(() => validateStrictSubset(attestationSchema())).not.toThrow();
  });

  it("consentSchema declares exactly consent + concerns, all required, closed object", () => {
    const schema = asNode(consentSchema());
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["concerns", "consent"]);
    expect([...(schema.required ?? [])].sort()).toEqual(["concerns", "consent"]);
    expect(schema.properties?.consent?.enum).toEqual(["yes", "no", "unknown"]);
    expect(schema.properties?.concerns?.type).toBe("string");
  });

  it("offerRelaySchema declares the five offer fields with the right shapes", () => {
    const schema = asNode(offerRelaySchema(1250));
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "amount_dollars",
      "conditions",
      "offer_kind",
      "public_rationale",
      "verbatim_quote",
    ]);
    expect([...(schema.required ?? [])].sort()).toEqual([
      "amount_dollars",
      "conditions",
      "offer_kind",
      "public_rationale",
      "verbatim_quote",
    ]);
    expect(schema.properties?.offer_kind?.enum).toEqual(["open", "counter", "accept", "reject", "unknown"]);
    expect(schema.properties?.amount_dollars?.type).toBe("number");
    expect(schema.properties?.conditions?.type).toBe("array");
    expect(schema.properties?.conditions?.items?.type).toBe("string");
    // The dollar bound is prompt material for the extraction model.
    expect(schema.properties?.amount_dollars?.description).toContain("1250");
  });

  it("offerRelaySchema rejects non-finite or negative bounds", () => {
    expect(() => offerRelaySchema(Number.NaN)).toThrow(TypeError);
    expect(() => offerRelaySchema(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => offerRelaySchema(-1)).toThrow(TypeError);
    expect(() => offerRelaySchema(0)).not.toThrow();
  });

  it("attestationSchema declares phrase_spoken + agrees_to_terms, closed object", () => {
    const schema = asNode(attestationSchema());
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["agrees_to_terms", "phrase_spoken"]);
    expect([...(schema.required ?? [])].sort()).toEqual(["agrees_to_terms", "phrase_spoken"]);
    expect(schema.properties?.agrees_to_terms?.enum).toEqual(["yes", "no", "unknown"]);
  });
});

describe("validateStrictSubset", () => {
  it("rejects composition keywords ($ref, oneOf, anyOf, allOf, format)", () => {
    for (const keyword of ["$ref", "oneOf", "anyOf", "allOf", "format"]) {
      const violations = strictSubsetViolations({
        type: "object",
        additionalProperties: false,
        properties: { x: { type: "string", [keyword]: keyword === "format" ? "email" : [] } },
      });
      expect(violations.some((v) => v.includes(`properties.x.${keyword}`))).toBe(true);
    }
  });

  it("rejects unknown types and type arrays", () => {
    expect(strictSubsetViolations({ type: "null" })).toHaveLength(1);
    expect(strictSubsetViolations({ type: ["string", "null"] }).length).toBeGreaterThan(0);
  });

  it("requires additionalProperties:false and properties on object nodes", () => {
    const violations = strictSubsetViolations({ type: "object" });
    expect(violations.some((v) => v.includes("additionalProperties"))).toBe(true);
    expect(violations.some((v) => v.includes("properties"))).toBe(true);
  });

  it("requires simple items on array nodes and rejects tuple form", () => {
    expect(strictSubsetViolations({ type: "array" }).some((v) => v.includes("items"))).toBe(true);
    expect(
      strictSubsetViolations({ type: "array", items: [{ type: "string" }] }).some((v) =>
        v.includes("tuple"),
      ),
    ).toBe(true);
  });

  it("rejects required members that are not declared properties", () => {
    const violations = strictSubsetViolations({
      type: "object",
      additionalProperties: false,
      required: ["ghost"],
      properties: { real: { type: "string" } },
    });
    expect(violations.some((v) => v.includes('"ghost"'))).toBe(true);
  });

  it("rejects enum members that do not match the declared type", () => {
    const violations = strictSubsetViolations({
      type: "object",
      additionalProperties: false,
      properties: { level: { type: "string", enum: ["low", 2] } },
    });
    expect(violations.some((v) => v.includes("enum[1]"))).toBe(true);
  });

  it("throw form reports every violation, not just the first", () => {
    const bad = {
      type: "object",
      additionalProperties: true,
      properties: { a: { type: "string", format: "email" }, b: { type: "array" } },
    };
    expect(strictSubsetViolations(bad).length).toBeGreaterThanOrEqual(3);
    expect(() => validateStrictSubset(bad)).toThrow(/strict subset/);
  });

  it("rejects non-object schema nodes outright", () => {
    expect(strictSubsetViolations(null).length).toBe(1);
    expect(strictSubsetViolations("string").length).toBe(1);
    expect(strictSubsetViolations([{ type: "object" }]).length).toBe(1);
  });
});

describe("result parsers", () => {
  it("parseConsent round-trips a valid payload", () => {
    expect(parseConsent({ consent: "yes", concerns: "" })).toEqual({ consent: "yes", concerns: "" });
    expect(parseConsent({ consent: "unknown", concerns: "asked who is paying for the calls" })).toEqual({
      consent: "unknown",
      concerns: "asked who is paying for the calls",
    });
  });

  it("parseConsent returns null on enum drift, missing fields, and wrong types", () => {
    expect(parseConsent({ consent: "maybe", concerns: "" })).toBeNull();
    expect(parseConsent({ consent: "yes" })).toBeNull();
    expect(parseConsent({ consent: true, concerns: "" })).toBeNull();
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent("yes")).toBeNull();
  });

  it("parseOffer round-trips a valid payload and strips extra keys", () => {
    const parsed = parseOffer({
      offer_kind: "counter",
      amount_dollars: 650.5,
      conditions: ["returns the garage remote"],
      public_rationale: "carpet was damaged",
      verbatim_quote: "I could live with $650.50 if the remote comes back.",
      hallucinated_extra: "should be stripped",
    });
    expect(parsed).toEqual({
      offer_kind: "counter",
      amount_dollars: 650.5,
      conditions: ["returns the garage remote"],
      public_rationale: "carpet was damaged",
      verbatim_quote: "I could live with $650.50 if the remote comes back.",
    });
  });

  it("parseOffer returns null on negative amounts, bad kinds, and malformed conditions", () => {
    const valid = {
      offer_kind: "open",
      amount_dollars: 400,
      conditions: [],
      public_rationale: "",
      verbatim_quote: "",
    };
    expect(parseOffer(valid)).not.toBeNull();
    expect(parseOffer({ ...valid, amount_dollars: -5 })).toBeNull();
    expect(parseOffer({ ...valid, amount_dollars: "400" })).toBeNull();
    expect(parseOffer({ ...valid, offer_kind: "no_response" })).toBeNull();
    expect(parseOffer({ ...valid, conditions: ["ok", 42] })).toBeNull();
  });

  it("parseAttestation round-trips valid payloads and rejects drift", () => {
    expect(parseAttestation({ phrase_spoken: "amber falcon river stone", agrees_to_terms: "yes" })).toEqual({
      phrase_spoken: "amber falcon river stone",
      agrees_to_terms: "yes",
    });
    expect(parseAttestation({ phrase_spoken: "", agrees_to_terms: "definitely" })).toBeNull();
    expect(parseAttestation({ agrees_to_terms: "yes" })).toBeNull();
  });

  it("parsers never throw on arbitrary model output (property)", () => {
    fc.assert(
      fc.property(fc.anything(), (junk) => {
        // Return value is either null or a well-typed object; throwing fails the test.
        for (const parse of [parseConsent, parseOffer, parseAttestation]) {
          const out = parse(junk);
          if (out !== null) expect(typeof out).toBe("object");
        }
      }),
      { numRuns: 200 },
    );
  });
});
