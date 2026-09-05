// Registry loading. A registry is an opt-in list: every row must carry consent, a valid
// E.164 phone, and a locale. Rows that fail are skipped loudly and never dialled.

import { readFileSync } from "node:fs";
import type { Cooling, Person } from "./types.js";
import { isE164, maskPhone } from "./mask.js";

export interface RegistryLoadReport {
  loaded: number;
  skippedNoConsent: number;
  skippedInvalidPhone: number;
  skippedDuplicatePhone: number;
  skippedMissingFields: number;
  warnings: string[];
}

const REGION_BY_PREFIX: [string, string][] = [
  ["+1", "US"],
  ["+7", "KZ"],
  ["+20", "EG"],
  ["+27", "ZA"],
  ["+30", "GR"],
  ["+31", "NL"],
  ["+33", "FR"],
  ["+34", "ES"],
  ["+39", "IT"],
  ["+44", "GB"],
  ["+48", "PL"],
  ["+49", "DE"],
  ["+52", "MX"],
  ["+55", "BR"],
  ["+60", "MY"],
  ["+61", "AU"],
  ["+62", "ID"],
  ["+63", "PH"],
  ["+65", "SG"],
  ["+66", "TH"],
  ["+81", "JP"],
  ["+84", "VN"],
  ["+90", "TR"],
  ["+91", "IN"],
  ["+92", "PK"],
  ["+94", "LK"],
  ["+234", "NG"],
  ["+254", "KE"],
  ["+880", "BD"],
  ["+971", "AE"],
];

export function regionFromPhone(phone: string): string {
  // Longest prefix wins.
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
  if (value === undefined) {
    return false;
  }
  return ["yes", "true", "1", "y"].includes(value.trim().toLowerCase());
}

function cooling(value: string | undefined): Cooling {
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

function number(value: string | undefined): number | null {
  const v = (value ?? "").trim();
  if (v.length === 0) {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const REGISTRY_COLUMNS = [
  "person_id",
  "name",
  "phone",
  "locale",
  "region",
  "age",
  "lives_alone",
  "has_cooling",
  "medical_risks",
  "address",
  "lat",
  "lng",
  "contact_name",
  "contact_phone",
  "contact_locale",
  "consent",
  "consent_date",
  "notes",
  "scenario",
] as const;

export function parseRegistry(text: string): { people: Person[]; report: RegistryLoadReport } {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) {
    throw new Error("Registry is empty.");
  }
  const col = (name: string): number => header.findIndex((h) => h.trim().toLowerCase() === name);
  for (const required of ["person_id", "name", "phone", "consent"]) {
    if (col(required) < 0) {
      throw new Error(`Registry is missing the required column: ${required}`);
    }
  }
  const report: RegistryLoadReport = {
    loaded: 0,
    skippedNoConsent: 0,
    skippedInvalidPhone: 0,
    skippedDuplicatePhone: 0,
    skippedMissingFields: 0,
    warnings: [],
  };
  const people: Person[] = [];
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
      report.warnings.push(`Row ${id} skipped: no recorded consent.`);
      continue;
    }
    if (seenPhones.has(phone)) {
      // CALL-E collapses two recipients that share one phone into one run (issue #235).
      report.skippedDuplicatePhone += 1;
      report.warnings.push(`Row ${id} skipped: phone ${maskPhone(phone)} already belongs to another row.`);
      continue;
    }
    const contactPhone = optional(get("contact_phone"));
    if (contactPhone !== null && !isE164(contactPhone)) {
      report.warnings.push(`Row ${id}: contact phone is not E.164 and will not be used.`);
    }
    const locale = optional(get("locale")) ?? "en-US";
    const person: Person = {
      id,
      name,
      phone,
      locale,
      region: optional(get("region")) ?? regionFromPhone(phone),
      age: number(get("age")),
      livesAlone: truthy(get("lives_alone")),
      hasCooling: cooling(get("has_cooling")),
      medicalRisks: (get("medical_risks") ?? "")
        .split(/[;|]/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0),
      address: optional(get("address")),
      lat: number(get("lat")),
      lng: number(get("lng")),
      contactName: optional(get("contact_name")),
      contactPhone: contactPhone !== null && isE164(contactPhone) ? contactPhone : null,
      contactLocale: optional(get("contact_locale")),
      consent: true,
      consentDate: optional(get("consent_date")),
      notes: optional(get("notes")),
      scenario: optional(get("scenario")),
    };
    seenIds.add(id);
    seenPhones.add(phone);
    people.push(person);
    report.loaded += 1;
  }
  return { people, report };
}

export function loadRegistry(path: string): { people: Person[]; report: RegistryLoadReport } {
  return parseRegistry(readFileSync(path, "utf8"));
}

/** Live-mode allowlist: when configured, only these numbers may be dialled, consent or not. */
export function applyAllowlist(people: Person[], allowlist: string[] | null): { kept: Person[]; skipped: Person[] } {
  if (allowlist === null) {
    return { kept: people, skipped: [] };
  }
  const allowed = new Set(allowlist);
  const kept: Person[] = [];
  const skipped: Person[] = [];
  for (const person of people) {
    (allowed.has(person.phone) ? kept : skipped).push(person);
  }
  return { kept, skipped };
}
