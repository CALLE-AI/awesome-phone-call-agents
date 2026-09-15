// Shared gate logic for the cleared-to-call helper scripts.
// Node standard library only. The policy is read from assets/policy.json so the
// scripts and the documented rules can never disagree.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_POLICY_PATH = resolve(HERE, "..", "assets", "policy.json");

export const E164 = /^\+[1-9]\d{7,14}$/;

export const REQUIRED_ACCOUNT_FIELDS = [
  "account_id",
  "display_name",
  "phone_e164",
  "timezone",
  "amount_due",
  "currency",
  "consent_on_file",
];

export function loadPolicy(path = DEFAULT_POLICY_PATH) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    ...raw,
    disclosureMatchers: raw.disclosure_elements.map((element) => ({
      id: element.id,
      description: element.description,
      patterns: element.patterns.map((pattern) => new RegExp(pattern, "i")),
    })),
  };
}

export function rule(policy, id) {
  const found = policy.rules.find((item) => item.id === id);
  if (!found) throw new Error(`policy ${policy.policy_id} has no rule ${id}`);
  return found;
}

export function maskPhone(phone) {
  if (!phone) return "";
  if (phone.length <= 6) return phone[0] + "*".repeat(phone.length - 1);
  return phone.slice(0, 2) + "*".repeat(phone.length - 6) + phone.slice(-4);
}

export function parseTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (!/(Z|z|[+-]\d{2}:?\d{2})$/.test(value.trim())) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Validation ---------------------------------------------------------------

export function validateAccount(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return ["account must be a JSON object"];
  }
  const problems = [];
  for (const field of REQUIRED_ACCOUNT_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null || value === "") {
      problems.push(`missing required field: ${field}`);
    }
  }
  if (typeof raw.phone_e164 === "string" && raw.phone_e164 && !E164.test(raw.phone_e164)) {
    problems.push(`phone_e164 is not E.164: ${maskPhone(raw.phone_e164)}`);
  }
  if (typeof raw.timezone === "string" && raw.timezone && !raw.timezone.includes("/")) {
    problems.push(`timezone is not an IANA zone name: ${raw.timezone}`);
  }
  if (typeof raw.timezone === "string" && raw.timezone.includes("/") && localTime(raw.timezone, new Date()) === null) {
    problems.push(`timezone is not a known IANA zone: ${raw.timezone}`);
  }
  if (raw.amount_due !== undefined && raw.amount_due !== null && Number.isNaN(Number(raw.amount_due))) {
    problems.push(`amount_due is not a number: ${JSON.stringify(raw.amount_due)}`);
  }
  if (raw.consent_on_file !== undefined && typeof raw.consent_on_file !== "boolean") {
    problems.push("consent_on_file must be true or false");
  }
  if (raw.consent_timestamp && parseTimestamp(raw.consent_timestamp) === null) {
    problems.push("consent_timestamp is not a UTC ISO-8601 timestamp");
  }
  return problems;
}

// Rules --------------------------------------------------------------------

export function localTime(timeZone, when) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(when);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    const hour = Number(get("hour")) % 24;
    return {
      hour,
      minute: Number(get("minute")),
      stamp: `${get("year")}-${get("month")}-${get("day")} ${String(hour).padStart(2, "0")}:${get("minute")}`,
    };
  } catch {
    return null;
  }
}

function minutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function ruleCallWindow(account, when, policy) {
  const meta = rule(policy, "R1");
  const local = account.timezone ? localTime(account.timezone, when) : null;
  if (!local) {
    return {
      rule_id: meta.id,
      name: meta.name,
      passed: false,
      detail: `no usable IANA timezone on the account record: ${JSON.stringify(account.timezone ?? null)}`,
    };
  }
  const now = local.hour * 60 + local.minute;
  const start = minutes(policy.call_window.start_local);
  const end = minutes(policy.call_window.end_local);
  const inside = now >= start && now < end;
  return {
    rule_id: meta.id,
    name: meta.name,
    passed: inside,
    detail: `local time ${local.stamp} (${account.timezone}) is ${inside ? "inside" : "outside"} ${policy.call_window.start_local}-${policy.call_window.end_local}`,
  };
}

export function ruleConsent(account, policy) {
  const meta = rule(policy, "R2");
  const base = { rule_id: meta.id, name: meta.name };
  if (!account.consent_on_file) {
    return { ...base, passed: false, detail: "no consent recorded on the account" };
  }
  if (!account.consent_timestamp) {
    return { ...base, passed: false, detail: "consent flag is set but no consent timestamp is recorded" };
  }
  if (parseTimestamp(account.consent_timestamp) === null) {
    return { ...base, passed: false, detail: `consent timestamp is unparseable: ${account.consent_timestamp}` };
  }
  return { ...base, passed: true, detail: `consent recorded ${account.consent_timestamp}` };
}

export function ruleNotSuppressed(account, suppressed, policy) {
  const meta = rule(policy, "R3");
  const normalized = normalizePhone(account.phone_e164);
  const hit = suppressed.has(normalized);
  return {
    rule_id: meta.id,
    name: meta.name,
    passed: !hit,
    detail: `${maskPhone(account.phone_e164)} is ${hit ? "on" : "not on"} the suppression list`,
  };
}

export function ruleDisclosureReady(scriptText, policy) {
  const meta = rule(policy, "R4");
  const missing = policy.disclosureMatchers
    .filter((element) => !element.patterns.some((pattern) => pattern.test(scriptText ?? "")))
    .map((element) => element.id);
  if (missing.length > 0) {
    return { rule_id: meta.id, name: meta.name, passed: false, detail: `script is missing: ${missing.join(", ")}` };
  }
  return {
    rule_id: meta.id,
    name: meta.name,
    passed: true,
    detail: `script contains: ${policy.disclosureMatchers.map((element) => element.id).join(", ")}`,
  };
}

export function normalizePhone(phone) {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

export function loadSuppression(path) {
  const numbers = new Set();
  if (!path || !existsSync(path)) return numbers;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = JSON.parse(trimmed);
    numbers.add(normalizePhone(entry.phone_e164));
  }
  return numbers;
}

// Script rendering ---------------------------------------------------------

export const DISCLOSURE_TEMPLATE =
  "Hello, this is an automated assistant calling on behalf of {creditor} " +
  "about your account ending {account_tail}. " +
  "This is an attempt to collect a debt, and any information obtained will be " +
  "used for that purpose. " +
  "If you would like us to stop calling, say stop calling and I will end this " +
  "call and remove your number.";

export const BODY_TEMPLATE =
  "Our records show a balance of {amount} {currency} that is past due. " +
  "I am only here to arrange a payment date. " +
  "Would you like to set a date to pay, or would you rather discuss this with " +
  "a person?";

export function renderScript(account) {
  const disclosure = DISCLOSURE_TEMPLATE.replace("{creditor}", account.creditor_name ?? "your lender").replace(
    "{account_tail}",
    String(account.account_id ?? "").slice(-4),
  );
  const body = BODY_TEMPLATE.replace("{amount}", Number(account.amount_due ?? 0).toFixed(2)).replace(
    "{currency}",
    account.currency ?? "USD",
  );
  return { disclosure, body, text: `${disclosure} ${body}` };
}

// The gate -----------------------------------------------------------------

export function evaluateAccount(account, { now, policy, suppressed = new Set(), scriptText = null }) {
  const script = scriptText === null ? renderScript(account).text : scriptText;
  const rules = [
    ruleCallWindow(account, now, policy),
    ruleConsent(account, policy),
    ruleNotSuppressed(account, suppressed, policy),
    ruleDisclosureReady(script, policy),
  ];
  const failed = rules.filter((result) => !result.passed);
  const blockReason = failed.length > 0 ? rule(policy, failed[0].rule_id).block_reason : null;
  return {
    account_id: account.account_id,
    phone_masked: maskPhone(account.phone_e164),
    decision: failed.length === 0 ? "allow" : "block",
    block_reason: blockReason,
    rules,
    rules_evaluated: Object.fromEntries(rules.map((result) => [result.rule_id, result.passed ? "pass" : "fail"])),
    evaluated_at: now.toISOString(),
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
  };
}

// Rule 5 -------------------------------------------------------------------

export function normalizeUtterance(text) {
  const lowered = String(text ?? "")
    .toLowerCase()
    .replace(/['’`]/g, "");
  return ` ${lowered.replace(/[^a-z0-9]+/g, " ").trim()} `;
}

export function detectRevocation(text, policy) {
  if (!text) return null;
  const haystack = normalizeUtterance(text);
  for (const phrase of policy.revocation_phrases) {
    const needle = normalizeUtterance(phrase).trim();
    if (needle && haystack.includes(` ${needle} `)) return phrase;
  }
  return null;
}

// Argument helper ----------------------------------------------------------

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function readAccountArgument(args) {
  if (args["account-json"]) return JSON.parse(args["account-json"]);
  if (args.file) {
    const raw = JSON.parse(readFileSync(args.file, "utf8"));
    const rows = Array.isArray(raw) ? raw : raw.accounts;
    if (!Array.isArray(rows)) throw new Error(`${args.file} does not contain an accounts array`);
    if (!args["account-id"]) return rows;
    const match = rows.find((row) => row.account_id === args["account-id"]);
    if (!match) throw new Error(`no such account in ${args.file}: ${args["account-id"]}`);
    return match;
  }
  throw new Error("provide --account-json '<json>' or --file <path> [--account-id <id>]");
}
