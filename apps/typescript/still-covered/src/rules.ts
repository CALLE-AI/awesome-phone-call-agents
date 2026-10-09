// The rule, encoded as data. Exemption categories, the questions that screen for them, the checklist
// each one needs, and the state's own wording live in JSON files, so a policy analyst can change them
// without touching code. Every function here is pure.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASKABLE_CODES, EXEMPTION_CODES, type Enrollee, type ExemptionCode } from "./types.js";

export interface ExemptionRule {
  code: ExemptionCode;
  order: number;
  label: string;
  /** null means never asked on a call; taken from state records only. */
  question: string | null;
  follow_up?: string;
  ask_if_age_under?: number;
  note?: string;
  checklist: string[];
}

export interface Rules {
  id: string;
  title: string;
  source: string;
  age_range: [number, number];
  requirement: {
    hours_per_month: number;
    income_per_month_usd: number;
    plain_language: string;
    awareness_question: string;
    hours_question: string;
    income_question: string;
    checklist_meets: string[];
    checklist_at_risk: string[];
  };
  exemptions: ExemptionRule[];
}

export interface StateConfig {
  id: string;
  state_name: string;
  program_name: string;
  /** Who is calling: the state agency or a managed care plan acting under its direction. */
  caller_org: string;
  start_date: string;
  report_how: string;
  callback_phone: string;
  navigator_line: string;
  /** Left on voicemail. Never names Medicaid: whoever hears it must not learn what coverage the person has. */
  voicemail: string;
  self_attestation_note: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RULES_PATH = join(HERE, "..", "rules", "federal-2027.json");
export const DEFAULT_STATES_DIR = join(HERE, "..", "states");

export function validateRules(rules: Rules, file = "rules"): void {
  const req = rules.requirement;
  if (!req || typeof req.hours_per_month !== "number" || req.hours_per_month <= 0 || typeof req.income_per_month_usd !== "number") {
    throw new Error(`${file}: requirement.hours_per_month and income_per_month_usd are required`);
  }
  for (const key of ["plain_language", "awareness_question", "hours_question", "income_question"] as const) {
    if (typeof req[key] !== "string" || req[key].trim().length === 0) {
      throw new Error(`${file}: requirement.${key} is required`);
    }
  }
  if (!Array.isArray(rules.exemptions)) {
    throw new Error(`${file}: exemptions must be a list`);
  }
  for (const code of EXEMPTION_CODES) {
    if (rules.exemptions.filter((e) => e.code === code).length !== 1) {
      throw new Error(`${file}: exemption ${code} must appear exactly once`);
    }
  }
  for (const e of rules.exemptions) {
    if (!(EXEMPTION_CODES as readonly string[]).includes(e.code)) {
      throw new Error(`${file}: unknown exemption code ${String(e.code)}`);
    }
    if (e.code === "tribal" && e.question !== null) {
      throw new Error(`${file}: tribal status must never be asked on a call; it comes from state records only`);
    }
    if ((ASKABLE_CODES as readonly string[]).includes(e.code) && (typeof e.question !== "string" || e.question.trim().length === 0)) {
      throw new Error(`${file}: exemption ${e.code} needs a question`);
    }
    if (e.code === "medically_frail" && (typeof e.follow_up !== "string" || e.follow_up.trim().length === 0)) {
      throw new Error(`${file}: medically_frail needs a follow_up about daily activities; a condition alone is not enough`);
    }
    if (!Array.isArray(e.checklist) || e.checklist.length === 0) {
      throw new Error(`${file}: exemption ${e.code} needs a checklist`);
    }
  }
}

export function loadRules(path = DEFAULT_RULES_PATH): Rules {
  const rules = JSON.parse(readFileSync(path, "utf8")) as Rules;
  validateRules(rules, path);
  return rules;
}

export function validateState(state: StateConfig, file = "state"): void {
  for (const key of ["id", "state_name", "program_name", "caller_org", "start_date", "report_how", "callback_phone", "navigator_line", "voicemail", "self_attestation_note"] as const) {
    if (typeof state[key] !== "string" || state[key].trim().length === 0) {
      throw new Error(`${file}: ${key} is required`);
    }
  }
  if (/medicaid/i.test(state.voicemail)) {
    throw new Error(`${file}: the voicemail must not mention Medicaid; whoever hears it must not learn what coverage the person has`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.start_date)) {
    throw new Error(`${file}: start_date must be YYYY-MM-DD`);
  }
}

export function listStates(dir = DEFAULT_STATES_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

export function loadState(id: string, dir = DEFAULT_STATES_DIR): StateConfig {
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`State id must be lowercase letters, digits and hyphens: ${id}`);
  }
  const path = join(dir, `${id}.json`);
  const state = JSON.parse(readFileSync(path, "utf8")) as StateConfig;
  validateState(state, path);
  return state;
}

export function ageOn(birthYear: number | null, isoDate: string): number | null {
  if (birthYear === null) {
    return null;
  }
  return Number(isoDate.slice(0, 4)) - birthYear;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** "January 2027", or "your next renewal" when the date is unknown. */
export function formatMonth(iso: string | null): string {
  if (iso === null) {
    return "your next renewal";
  }
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function exemptionLabel(rules: Rules, code: ExemptionCode): string {
  return rules.exemptions.find((e) => e.code === code)?.label ?? code;
}

export function exemptionLabels(rules: Rules): Record<ExemptionCode, string> {
  const labels = {} as Record<ExemptionCode, string>;
  for (const code of EXEMPTION_CODES) {
    labels[code] = exemptionLabel(rules, code);
  }
  return labels;
}

export interface DataClearance {
  cleared: boolean;
  kind: "exempt" | "meets" | null;
  codes: ExemptionCode[];
  reason: string;
}

/** Ex parte first: what the state's own records already settle, so nobody is called about it. */
export function clearedByData(person: Enrollee, rules: Rules): DataClearance {
  const codes = EXEMPTION_CODES.filter((c) => person.known[c] === "yes");
  if (codes.length > 0) {
    return { cleared: true, kind: "exempt", codes, reason: `state records already show: ${codes.map((c) => exemptionLabel(rules, c)).join("; ")}` };
  }
  if (person.knownCompliant === "yes") {
    return { cleared: true, kind: "meets", codes: [], reason: "state wage or income data already shows the requirement is met" };
  }
  return { cleared: false, kind: null, codes: [], reason: "" };
}

/** Only the questions the state's data has not answered, and only the ones that apply at the person's age, in order. */
export function questionsFor(rules: Rules, person: Enrollee, asOf: string): ExemptionRule[] {
  const age = ageOn(person.birthYear, asOf);
  return rules.exemptions
    .filter((e) => e.question !== null)
    .filter((e) => person.known[e.code] === undefined || person.known[e.code] === "unknown")
    .filter((e) => e.ask_if_age_under === undefined || age === null || age < e.ask_if_age_under)
    .sort((a, b) => a.order - b.order);
}

export function checklistFor(rules: Rules, codes: ExemptionCode[]): string[] {
  const items: string[] = [];
  for (const code of codes) {
    for (const line of rules.exemptions.find((e) => e.code === code)?.checklist ?? []) {
      if (!items.includes(line)) {
        items.push(line);
      }
    }
  }
  return items;
}
