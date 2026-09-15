// Gate between "CALL-E returned something" and "this app acts on it". A flow
// must not mutate a booking off a structured result unless the call actually
// completed, CALL-E itself reported the task as done, its confidence was
// reasonable, there's a transcript to back it up, and the JSON it returned
// actually matches the schema it was asked for.

import type { JsonSchema, NormalizedCallResult } from "./types.js";

export const MIN_CONFIDENCE = 0.5;

export interface EvidenceAssessment {
  trusted: boolean;
  reason?: string;
}

export function assessEvidence(call: NormalizedCallResult, schema: JsonSchema): EvidenceAssessment {
  if (call.dryRun) {
    return { trusted: true };
  }
  if (call.status !== "completed") {
    return { trusted: false, reason: `call status was "${call.status}", not completed` };
  }
  if (call.taskCompleted !== true) {
    return { trusted: false, reason: "CALL-E did not report the task as completed" };
  }
  if (call.completionConfidence === null || call.completionConfidence.score < MIN_CONFIDENCE) {
    const score = call.completionConfidence?.score ?? "none";
    return { trusted: false, reason: `completion confidence too low (${score})` };
  }
  if (call.transcript.length === 0) {
    return { trusted: false, reason: "no transcript evidence for a completed call" };
  }
  if (call.structuredResult === null) {
    return { trusted: false, reason: "no structured result returned" };
  }
  const schemaCheck = validateAgainstSchema(schema, call.structuredResult);
  if (!schemaCheck.valid) {
    return { trusted: false, reason: `structured result did not match schema: ${schemaCheck.reason}` };
  }
  return { trusted: true };
}

export function validateAgainstSchema(schema: JsonSchema, value: unknown): { valid: boolean; reason?: string } {
  if (schema.enum !== undefined) {
    if (!schema.enum.includes(value as string)) {
      return { valid: false, reason: `value "${String(value)}" is not one of [${schema.enum.join(", ")}]` };
    }
    return { valid: true };
  }

  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { valid: false, reason: "expected an object" };
    }
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record) || record[key] === undefined || record[key] === null) {
        return { valid: false, reason: `missing required field "${key}"` };
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (!(key in record)) continue;
      const result = validateAgainstSchema(propertySchema, record[key]);
      if (!result.valid) {
        return { valid: false, reason: `field "${key}": ${result.reason}` };
      }
    }
    return { valid: true };
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      return { valid: false, reason: "expected an array" };
    }
    if (schema.items !== undefined) {
      for (const [index, item] of value.entries()) {
        const result = validateAgainstSchema(schema.items, item);
        if (!result.valid) {
          return { valid: false, reason: `item ${index}: ${result.reason}` };
        }
      }
    }
    return { valid: true };
  }

  if (schema.type === "string") {
    return typeof value === "string" ? { valid: true } : { valid: false, reason: "expected a string" };
  }
  if (schema.type === "number" || schema.type === "integer") {
    return typeof value === "number" ? { valid: true } : { valid: false, reason: "expected a number" };
  }
  if (schema.type === "boolean") {
    return typeof value === "boolean" ? { valid: true } : { valid: false, reason: "expected a boolean" };
  }

  return { valid: true };
}
