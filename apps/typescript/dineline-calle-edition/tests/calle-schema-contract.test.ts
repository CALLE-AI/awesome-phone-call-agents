import { describe, expect, it } from "vitest";

import {
  calleResultJsonSchema,
  normalizeCalleStructuredResult,
} from "../src/domain/call-result.js";
import {
  diningPreferencesJsonSchema,
  normalizeDiningPreferencesResult,
} from "../src/domain/dining-preferences.js";

const allowedKeywords = new Set([
  "type",
  "properties",
  "required",
  "enum",
  "items",
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
        confirmedDate: "unknown",
        confirmedTime: "unknown",
        confirmedPartySize: 0,
        confirmationCode: "none",
        alternativeDate: "unknown",
        alternativeTime: "unknown",
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

  if (typeof schema.type !== "string") {
    problems.push(`${path}.type must be one string`);
  }
  if (
    "additionalProperties" in schema &&
    schema.additionalProperties !== false
  ) {
    problems.push(`${path}.additionalProperties must be false`);
  }

  if (isRecord(schema.properties)) {
    for (const [name, child] of Object.entries(schema.properties)) {
      problems.push(...schemaProblems(child, `${path}.properties.${name}`));
    }
  }
  if (schema.items !== undefined) {
    problems.push(...schemaProblems(schema.items, `${path}.items`));
  }

  return problems;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
