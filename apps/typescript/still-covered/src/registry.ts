// Enrollee list loading. Every row must carry consent (the phone number the person gave on their
// Medicaid application), a valid E.164 phone, and must not be on the do-not-call list. Rows that fail
// are skipped loudly and never dialled.

import { readFileSync } from "node:fs";
import { isE164, maskPhone } from "./mask.js";
import { EXEMPTION_CODES, type Enrollee, type ExemptionCode, type YesNoUnknown } from "./types.js";

export interface RegistryLoadReport {
  loaded: number;
  skippedNoConsent: number;
  skippedDoNotCall: number;
  skippedInvalidPhone: number;
  skippedDuplicatePhone: number;
  skippedMissingFields: number;
  warnings: string[];
}

const REGION_BY_PREFIX: [string, string][] = [
  ["+1", "US"],
  ["+44", "GB"],
  ["+52", "MX"],
  ["+63", "PH"],
  ["+65", "SG"],
  ["+84", "VN"],
  ["+86", "CN"],
  ["+91", "IN"],
];

export function regionFromPhone(phone: string): string {
  const sorted = [...REGION_BY_PREFIX].sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, region] of sorted) {
    if (phone.startsWith(prefix)) {
      return region;
    }
  }
  return "US";
}

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF line endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

function truthy(value: string | undefined): boolean {
  return ["yes", "true", "1", "y"].includes((value ?? "").trim().toLowerCase());
}

function yesNoUnknown(value: string | undefined): YesNoUnknown {
  const v = (value ?? "").trim().toLowerCase();
  if (["yes", "true", "1", "y"].includes(v)) {
    return "yes";
  }
  if (["no", "false", "0", "n"].includes(v)) {
    return "no";
  }
  return "unknown";
}

function optional(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : null;
}

/** Registry columns that carry what the state's records already show. */
const KNOWN_COLUMNS: [string, ExemptionCode][] = [
  ["known_pregnant", "pregnant_postpartum"],
  ["known_snap_tanf", "snap_tanf"],
  ["known_veteran_disability", "veteran_disability"],
  ["known_tribal", "tribal"],
  ["known_foster_youth", "former_foster_youth"],
];

export const REGISTRY_COLUMNS = [
  "person_id",
  "name",
  "first_name",
  "phone",
  "locale",
  "region",
  "birth_year",
  "check_date",
  "known_exempt",
  "known_compliant",
  "known_snap_tanf",
  "known_pregnant",
  "known_veteran_disability",
  "known_tribal",
  "known_foster_youth",
  "has_online_account",
  "mail_returned",
  "prior_procedural_loss",
  "do_not_call",
  "consent",
  "consent_source",
  "notes",
  "scenario",
] as const;

export function parseEnrollees(text: string): { people: Enrollee[]; report: RegistryLoadReport } {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) {
    throw new Error("Enrollee list is empty.");
  }
  const col = (name: string): number => header.findIndex((h) => h.trim().toLowerCase() === name);
  for (const required of ["person_id", "name", "phone", "consent"]) {
    if (col(required) < 0) {
      throw new Error(`Enrollee list is missing the required column: ${required}`);
    }
  }
  const report: RegistryLoadReport = {
    loaded: 0,
    skippedNoConsent: 0,
    skippedDoNotCall: 0,
    skippedInvalidPhone: 0,
    skippedDuplicatePhone: 0,
    skippedMissingFields: 0,
    warnings: [],
  };
  const people: Enrollee[] = [];
  const seenPhones = new Set<string>();
  const seenIds = new Set<string>();
  for (const row of rows.slice(1)) {
    const get = (name: string): string | undefined => {
      const index = col(name);
      return index >= 0 ? row[index] : undefined;
    };
    const id = (get("person_id") ?? "").trim();
    const name = (get("name") ?? "").trim();
    const phone = (get("phone") ?? "").trim();
    if (!id || !name || !phone) {
      report.skippedMissingFields += 1;
      report.warnings.push(`Row skipped: missing person_id, name or phone (${id || "no id"}).`);
      continue;
    }
    if (seenIds.has(id)) {
      report.skippedMissingFields += 1;
      report.warnings.push(`Row skipped: duplicate person_id ${id}.`);
      continue;
    }
    if (!isE164(phone)) {
      report.skippedInvalidPhone += 1;
      report.warnings.push(`Row ${id} skipped: phone is not E.164.`);
      continue;
    }
    if (!truthy(get("consent"))) {
      report.skippedNoConsent += 1;
      report.warnings.push(`Row ${id} skipped: no consent to be called about coverage.`);
      continue;
    }
    if (truthy(get("do_not_call"))) {
      report.skippedDoNotCall += 1;
      report.warnings.push(`Row ${id} skipped: on the do-not-call list.`);
      continue;
    }
    if (seenPhones.has(phone)) {
      report.skippedDuplicatePhone += 1;
      report.warnings.push(`Row ${id} skipped: phone ${maskPhone(phone)} already belongs to another row.`);
      continue;
    }
    const known: Partial<Record<ExemptionCode, YesNoUnknown>> = {};
    for (const [column, code] of KNOWN_COLUMNS) {
      const value = yesNoUnknown(get(column));
      if (value !== "unknown") {
        known[code] = value;
      }
    }
    const knownExempt = (get("known_exempt") ?? "").trim().toLowerCase();
    if (knownExempt.length > 0) {
      if ((EXEMPTION_CODES as readonly string[]).includes(knownExempt)) {
        known[knownExempt as ExemptionCode] = "yes";
      } else {
        report.warnings.push(`Row ${id}: known_exempt "${knownExempt}" is not a recognised exemption code and was ignored.`);
      }
    }
    const checkDateRaw = optional(get("check_date"));
    const checkDate = checkDateRaw !== null && /^\d{4}-\d{2}-\d{2}$/.test(checkDateRaw) ? checkDateRaw : null;
    if (checkDateRaw !== null && checkDate === null) {
      report.warnings.push(`Row ${id}: check_date must be YYYY-MM-DD; treated as unknown.`);
    }
    const birthYearRaw = Number.parseInt((get("birth_year") ?? "").trim(), 10);
    const person: Enrollee = {
      id,
      name,
      firstName: optional(get("first_name")) ?? name.split(/\s+/)[0] ?? name,
      phone,
      locale: optional(get("locale")) ?? "en-US",
      region: optional(get("region")) ?? regionFromPhone(phone),
      birthYear: Number.isFinite(birthYearRaw) && birthYearRaw > 1900 ? birthYearRaw : null,
      checkDate,
      known,
      knownCompliant: yesNoUnknown(get("known_compliant")),
      hasOnlineAccount: truthy(get("has_online_account")),
      mailReturned: truthy(get("mail_returned")),
      priorProceduralLoss: truthy(get("prior_procedural_loss")),
      consent: true,
      consentSource: optional(get("consent_source")),
      notes: optional(get("notes")),
      scenario: optional(get("scenario")),
    };
    if (person.birthYear === null) {
      report.warnings.push(`Row ${id}: no birth year, so identity cannot be confirmed on the call; nothing about coverage will be discussed.`);
    }
    seenIds.add(id);
    seenPhones.add(phone);
    people.push(person);
    report.loaded += 1;
  }
  return { people, report };
}

export function loadEnrollees(path: string): { people: Enrollee[]; report: RegistryLoadReport } {
  return parseEnrollees(readFileSync(path, "utf8"));
}

/** Live-mode allowlist: when configured, only these numbers may be dialled, consent or not. */
export function applyAllowlist(people: Enrollee[], allowlist: string[] | null): { kept: Enrollee[]; skipped: Enrollee[] } {
  if (allowlist === null) {
    return { kept: people, skipped: [] };
  }
  const allowed = new Set(allowlist);
  return { kept: people.filter((p) => allowed.has(p.phone)), skipped: people.filter((p) => !allowed.has(p.phone)) };
}
