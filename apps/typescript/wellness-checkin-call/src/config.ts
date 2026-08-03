import { readFileSync } from "node:fs";
import type { WellnessRequest } from "./types.js";

export class ConfigError extends Error {}

const E164 = /^\+[1-9]\d{6,14}$/;

export function parseRequest(value: unknown): WellnessRequest {
  if (typeof value !== "object" || value === null) {
    throw new ConfigError("Request must be a JSON object.");
  }
  const v = value as Record<string, unknown>;

  if (typeof v.workflow_id !== "string" || v.workflow_id.trim() === "") {
    throw new ConfigError("workflow_id is required and must be a non-empty string.");
  }
  if (typeof v.phone !== "string" || !E164.test(v.phone)) {
    throw new ConfigError("phone is required and must be E.164, e.g. +12025550123.");
  }
  if (v.recipient_or_caregiver_opted_in !== true) {
    throw new ConfigError(
      "recipient_or_caregiver_opted_in must be literal `true` — this app refuses to run without recorded consent."
    );
  }

  return {
    workflow_id: v.workflow_id,
    phone: v.phone,
    recipient_or_caregiver_opted_in: true,
  };
}

export function loadRequest(path: string): WellnessRequest {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(`Could not read request file at ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(`Request file at ${path} is not valid JSON: ${(error as Error).message}`);
  }
  return parseRequest(parsed);
}
