import { describe, expect, it } from "vitest";

import {
  calleResultJsonSchema,
  normalizeCalleStructuredResult,
} from "../src/domain/call-result.js";
import {
  diningPreferencesJsonSchema,
  DiningPreferencesSchema,
  normalizeDiningPreferencesResult,
} from "../src/domain/dining-preferences.js";

const allowedKeywords = new Set([
  "type",
  "properties",
  "required",
  "enum",
  "description",
  "additionalProperties",
]);

describe("CALL-E result schema contract", () => {
  it("keeps the preference schema inside CALL-E's supported subset", () => {
    expect(schemaProblems(diningPreferencesJsonSchema)).toEqual([]);
  });

  it("keeps the booking schema inside CALL-E's supported subset", () => {
    expect(schemaProblems(calleResultJsonSchema)).toEqual([]);
  });

  it("normalizes CALL-E preference sentinels into strict DineLine values", () => {
    expect(
      normalizeDiningPreferencesResult({
        location: "Manhattan, New York",
        cuisine: "Italian",
        date: "unknown",
        time: "unknown",
        timeZone: "America/New_York",
        partySize: 0,
        budget: "upscale",
        atmosphere: "quiet enough to talk",
        dietaryNeeds: [" vegetarian ", 42],
        notes: "none",
      }),
    ).toEqual({
      location: "Manhattan, New York",
      cuisine: "Italian",
      date: null,
      time: null,
      timeZone: "America/New_York",
      partySize: null,
      budget: "upscale",
      atmosphere: "quiet enough to talk",
      dietaryNeeds: ["vegetarian"],
      notes: null,
    });
  });

  it("normalizes CALL-E booking sentinels before contract verification", () => {
    expect(
      normalizeCalleStructuredResult({
        outcome: "unavailable",
        confirmed_date: "unknown",
        confirmed_time: "unknown",
        confirmed_party_size: 0,
        confirmation_code: "none",
        alternative_date: "unknown",
        alternative_time: "unknown",
        notes: "The requested time was unavailable.",
      }),
    ).toEqual({
      outcome: "unavailable",
      confirmedDate: null,
      confirmedTime: null,
      confirmedPartySize: null,
      confirmationCode: null,
      alternativeDate: null,
      alternativeTime: null,
      notes: "The requested time was unavailable.",
    });
  });

  it("decodes dietary needs from the scalar wire format without discarding invalid input", () => {
    const preferences = {
      location: "Manhattan", cuisine: "Italian", date: "2026-11-06", time: "19:30",
      time_zone: "America/New_York", party_size: 2, budget: "moderate", atmosphere: "quiet", notes: "none",
    };
    expect(DiningPreferencesSchema.parse(normalizeDiningPreferencesResult({
      ...preferences, dietary_needs: '["no peanuts", " vegetarian "]',
    })).dietaryNeeds).toEqual(["no peanuts", "vegetarian"]);
    for (const dietaryNeeds of ["no peanuts", '{"allergy":"peanuts"}', "null", undefined]) {
      expect(DiningPreferencesSchema.safeParse(normalizeDiningPreferencesResult({
        ...preferences, dietary_needs: dietaryNeeds,
      })).success).toBe(false);
    }
  });
});

function schemaProblems(schema: unknown, path = "$" ): string[] {
  if (!isRecord(schema)) {
    return [`${path} must be an object`];
  }

  const problems: string[] = [];
  for (const key of Object.keys(schema)) {
    if (!allowedKeywords.has(key)) {
      problems.push(`${path}.${key} is not supported`);
    }
  }

  if (path === "$") {
    if (schema.type !== "object" || schema.additionalProperties !== false || !isRecord(schema.properties)) {
      return [...problems, "The result must be a closed object"];
    }
    const fields = Object.keys(schema.properties);
    if (fields.some((name) => !/^[a-z][a-z0-9_]{0,63}$/.test(name))) problems.push("Use lowercase result field names");
    if (fields.length === 0 || fields.length > 32) problems.push("Use 1 to 32 result fields");
    if (JSON.stringify([...(schema.required as string[])].sort()) !== JSON.stringify([...fields].sort())) {
      problems.push("Every result field must be required");
    }
    for (const [name, child] of Object.entries(schema.properties)) {
      problems.push(...schemaProblems(child, `${path}.${name}`));
    }
  } else if (!["string", "number", "integer", "boolean"].includes(String(schema.type))) {
    problems.push(`${path} must be a scalar field`);
  }

  return problems;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
