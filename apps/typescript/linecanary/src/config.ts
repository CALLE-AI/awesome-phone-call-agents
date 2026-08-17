/**
 * Configuration loading and validation.
 *
 * Config is operator input that later causes real phone calls, so every
 * refusal happens at load time and names the offending entry. Nothing here
 * reads the network; `env:` indirection reads process.env so secrets stay out
 * of the file.
 */

import { readFileSync } from "node:fs";
import { maskPhone } from "./alert.js";
import type { JsonSchema } from "./types.js";

export class ConfigError extends Error {}

export type Ownership =
  | { method: "greeting_code"; code: string }
  | { method: "attestation"; statement: string };

export interface LineConfig {
  id: string;
  /** Human-facing name, e.g. "Sample Dental — main line". Falls back to id. */
  name?: string;
  phone: string;
  region?: string;
  locale?: string;
  ownership: Ownership;
}

export type Assertion =
  | { path: string; equals: unknown }
  | { path: string; contains: string }
  | { path: string; matches: string }
  | { path: string; oneOf: unknown[] }
  | { path: string; exists: boolean };

export interface TimingBounds {
  maxSecondsToAnswer?: number;
  maxSecondsToFirstResponse?: number;
}

export interface CheckConfig {
  id: string;
  /** Human-facing name, e.g. "Billing menu option". Falls back to id. */
  name?: string;
  line: string;
  task: string;
  resultSchema: JsonSchema;
  assert: Assertion[];
  timing?: TimingBounds;
  minConfidence?: number;
}

export interface CallWindow {
  /** IANA timezone the window is evaluated in, e.g. "America/Los_Angeles". */
  timezone: string;
  /** Inclusive start, "HH:MM" 24h. */
  start: string;
  /** Exclusive end, "HH:MM" 24h. Must be after start. */
  end: string;
  /** Days 0 (Sunday) – 6 (Saturday); omitted = every day. */
  days?: number[];
}

export interface Config {
  lines: LineConfig[];
  checks: CheckConfig[];
  alerts?: { slackWebhookUrl?: string };
  baselineDir: string;
  /** Live calls are only placed inside this window; omitted = always. */
  callWindow?: CallWindow;
  /** Stored runs per check. Default 200. */
  historyLimit: number;
}

const ID_SHAPE = /^[A-Za-z0-9_-]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

function fail(message: string): never {
  throw new ConfigError(message);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${where} must be a non-empty string.`);
  }
  return value;
}

function resolveEnv(value: string, where: string): string {
  if (!value.startsWith("env:")) {
    return value;
  }
  const name = value.slice("env:".length);
  if (!/^LINECANARY_[A-Z0-9_]+$/.test(name)) {
    // A config may only name its own LINECANARY_* variables. Without this a
    // config could point an alert URL at CALLE_API_KEY and leak the key value
    // through the fetch error path.
    fail(`${where} may only reference LINECANARY_* environment variables, not ${name}.`);
  }
  const resolved = process.env[name];
  if (resolved === undefined || resolved.length === 0) {
    fail(
      `${where} points at environment variable ${name}, which is not set. ` +
        `Export ${name}, or remove the "alerts" block from the config to run without Slack alerts.`,
    );
  }
  return resolved;
}

const WEBHOOK_ALLOWED_HOSTS = new Set(["hooks.slack.com"]);

/**
 * Guard the alert webhook the same way calle.ts guards the API base URL: the
 * payload carries call-transcript excerpts and masked numbers, so an
 * unvalidated destination is an exfiltration channel and a blind-SSRF probe.
 * https only, no IP literals or private hosts, host on the allowlist (extended
 * by LINECANARY_ALLOWED_WEBHOOK_HOSTS).
 */
function assertWebhookUrl(value: string, where: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(`${where} is not a valid URL.`);
  }
  if (url.protocol !== "https:") {
    fail(`${where} must be an https URL.`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const allowed = new Set(WEBHOOK_ALLOWED_HOSTS);
  for (const extra of (process.env.LINECANARY_ALLOWED_WEBHOOK_HOSTS ?? "").split(/[\s,]+/).filter((entry) => entry.length > 0)) {
    allowed.add(extra.toLowerCase());
  }
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(":") || host === "localhost" || host.endsWith(".local")) {
    fail(`${where} must not point at an IP literal or a local address.`);
  }
  if (!allowed.has(host)) {
    fail(`${where} host ${host} is not allowed. Allow it via LINECANARY_ALLOWED_WEBHOOK_HOSTS, or use a hooks.slack.com URL.`);
  }
  return value;
}

function parseOwnership(value: unknown, where: string): Ownership {
  const record = asRecord(value, where);
  if (record.method === "greeting_code") {
    return { method: "greeting_code", code: asString(record.code, `${where}.code`) };
  }
  if (record.method === "attestation") {
    return { method: "attestation", statement: asString(record.statement, `${where}.statement`) };
  }
  return fail(`${where}.method must be "greeting_code" or "attestation".`);
}

function parseLine(value: unknown, index: number): LineConfig {
  const where = `lines[${index}]`;
  const record = asRecord(value, where);
  const id = asString(record.id, `${where}.id`);
  if (!ID_SHAPE.test(id)) {
    fail(`${where}.id must be alphanumeric with dashes or underscores (it also names on-disk files and store keys).`);
  }
  const phone = asString(record.phone, `${where}.phone`);
  if (!E164.test(phone)) {
    fail(`${where} phone ${maskPhone(phone)} is not E.164 (+15550100 style).`);
  }
  if (record.ownership === undefined) {
    fail(`${where} (${id}) has no ownership block. LineCanary only calls lines you own or are authorized to monitor.`);
  }
  return {
    id,
    name: record.name === undefined ? undefined : asString(record.name, `${where}.name`),
    phone,
    region: record.region === undefined ? undefined : asString(record.region, `${where}.region`),
    locale: record.locale === undefined ? undefined : asString(record.locale, `${where}.locale`),
    ownership: parseOwnership(record.ownership, `${where}.ownership`),
  };
}

function parseAssertion(value: unknown, where: string): Assertion {
  const record = asRecord(value, where);
  const path = asString(record.path, `${where}.path`);
  const kinds = ["equals", "contains", "matches", "oneOf", "exists"].filter((kind) => kind in record);
  if (kinds.length !== 1) {
    fail(`${where} must have exactly one of equals, contains, matches, oneOf, exists.`);
  }
  const kind = kinds[0];
  if (kind === "contains") {
    return { path, contains: asString(record.contains, `${where}.contains`) };
  }
  if (kind === "matches") {
    const source = asString(record.matches, `${where}.matches`);
    if (source.length > 200) {
      fail(`${where}.matches is too long (max 200 chars).`);
    }
    if (/\([^)]*[*+][^)]*\)\s*[*+]/.test(source)) {
      // Reject a quantifier applied to a group that already contains one
      // ((a+)+ and friends): the pattern runs against attacker-controlled
      // transcript text and V8 has no backtracking budget, so a catastrophic
      // pattern would hang the sweep forever.
      fail(`${where}.matches has nested quantifiers, which can hang the runner on hostile input. Simplify the pattern.`);
    }
    try {
      // Compiled case-insensitively: transcript-derived text has no stable case.
      void new RegExp(source, "i");
    } catch {
      fail(`${where}.matches is not a valid regular expression: ${source}`);
    }
    return { path, matches: source };
  }
  if (kind === "oneOf") {
    if (!Array.isArray(record.oneOf) || record.oneOf.length === 0) {
      fail(`${where}.oneOf must be a non-empty array.`);
    }
    return { path, oneOf: record.oneOf };
  }
  if (kind === "exists") {
    if (typeof record.exists !== "boolean") {
      fail(`${where}.exists must be a boolean.`);
    }
    return { path, exists: record.exists };
  }
  return { path, equals: record.equals };
}

function parseTiming(value: unknown, where: string): TimingBounds {
  const record = asRecord(value, where);
  const bounds: TimingBounds = {};
  for (const key of ["maxSecondsToAnswer", "maxSecondsToFirstResponse"] as const) {
    if (record[key] !== undefined) {
      if (typeof record[key] !== "number" || record[key] <= 0) {
        fail(`${where}.${key} must be a positive number.`);
      }
      bounds[key] = record[key];
    }
  }
  if (Object.keys(bounds).length === 0) {
    fail(`${where} sets no bounds.`);
  }
  return bounds;
}

export function parseCheck(value: unknown, index: number, lineIds: Set<string>): CheckConfig {
  const where = `checks[${index}]`;
  const record = asRecord(value, where);
  const id = asString(record.id, `${where}.id`);
  if (!ID_SHAPE.test(id)) {
    fail(`${where}.id must be alphanumeric with dashes or underscores (it also names on-disk files).`);
  }
  const line = asString(record.line, `${where}.line`);
  if (!lineIds.has(line)) {
    fail(`${where} (${id}) references unknown line ${line}.`);
  }
  const task = asString(record.task, `${where}.task`);
  const schema = asRecord(record.resultSchema, `${where}.resultSchema`);
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    fail(`${where} (${id}) resultSchema must be an object schema with additionalProperties: false — the platform rejects open schemas.`);
  }
  const assertions = Array.isArray(record.assert)
    ? record.assert.map((entry, i) => parseAssertion(entry, `${where}.assert[${i}]`))
    : fail(`${where} (${id}) assert must be an array.`);
  const timing = record.timing === undefined ? undefined : parseTiming(record.timing, `${where}.timing`);
  let minConfidence: number | undefined;
  if (record.minConfidence !== undefined) {
    if (typeof record.minConfidence !== "number" || record.minConfidence < 0 || record.minConfidence > 1) {
      fail(`${where}.minConfidence must be between 0 and 1.`);
    }
    minConfidence = record.minConfidence;
  }
  if (assertions.length === 0 && timing === undefined && minConfidence === undefined) {
    fail(`${where} (${id}) checks nothing: add assertions, timing bounds or minConfidence.`);
  }
  return {
    id,
    name: record.name === undefined ? undefined : asString(record.name, `${where}.name`),
    line,
    task,
    resultSchema: schema,
    assert: assertions,
    timing,
    minConfidence,
  };
}

function uniqueIds(values: { id: string }[], what: string): void {
  const seen = new Set<string>();
  for (const { id } of values) {
    if (seen.has(id)) {
      fail(`Duplicate ${what} id: ${id}.`);
    }
    seen.add(id);
  }
}

export function loadConfig(path: string): Config {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    fail(`Cannot read config file ${path}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(`${path} is not valid JSON.`);
  }
  const record = asRecord(parsed, "config");
  if (!Array.isArray(record.lines) || record.lines.length === 0) {
    fail("config.lines must be a non-empty array.");
  }
  const lines = record.lines.map(parseLine);
  uniqueIds(lines, "line");
  const lineIds = new Set(lines.map((line) => line.id));
  if (!Array.isArray(record.checks) || record.checks.length === 0) {
    fail("config.checks must be a non-empty array.");
  }
  const checks = record.checks.map((entry, index) => parseCheck(entry, index, lineIds));
  uniqueIds(checks, "check");

  let alerts: Config["alerts"];
  if (record.alerts !== undefined) {
    const alertsRecord = asRecord(record.alerts, "config.alerts");
    alerts = {};
    if (alertsRecord.slackWebhookUrl !== undefined) {
      alerts.slackWebhookUrl = assertWebhookUrl(
        resolveEnv(
          asString(alertsRecord.slackWebhookUrl, "config.alerts.slackWebhookUrl"),
          "config.alerts.slackWebhookUrl",
        ),
        "config.alerts.slackWebhookUrl",
      );
    }
  }

  const baselineDir =
    record.baselineDir === undefined ? "baselines" : asString(record.baselineDir, "config.baselineDir");

  let callWindow: CallWindow | undefined;
  if (record.callWindow !== undefined) {
    const window = asRecord(record.callWindow, "config.callWindow");
    const timezone = asString(window.timezone, "config.callWindow.timezone");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      fail(`config.callWindow.timezone ${timezone} is not a valid IANA timezone.`);
    }
    const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
    const start = asString(window.start, "config.callWindow.start");
    const end = asString(window.end, "config.callWindow.end");
    if (!clock.test(start) || !clock.test(end)) {
      fail("config.callWindow start/end must be HH:MM in 24-hour time.");
    }
    if (start >= end) {
      fail("config.callWindow.start must be before end (overnight windows are not supported).");
    }
    let days: number[] | undefined;
    if (window.days !== undefined) {
      if (!Array.isArray(window.days) || window.days.length === 0 || window.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
        fail("config.callWindow.days must be integers 0 (Sunday) through 6 (Saturday).");
      }
      days = window.days as number[];
    }
    callWindow = { timezone, start, end, days };
  }

  let historyLimit = 200;
  if (record.historyLimit !== undefined) {
    if (typeof record.historyLimit !== "number" || !Number.isInteger(record.historyLimit) || record.historyLimit < 10 || record.historyLimit > 5000) {
      fail("config.historyLimit must be an integer between 10 and 5000.");
    }
    historyLimit = record.historyLimit;
  }

  return { lines, checks, alerts, baselineDir, callWindow, historyLimit };
}
