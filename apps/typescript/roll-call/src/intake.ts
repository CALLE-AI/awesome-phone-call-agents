import { readFileSync } from "node:fs";
import type { Absence, Guardian, RollCallInput, SchoolConfig } from "./types.js";

const E164 = /^\+[1-9]\d{6,14}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class IntakeError extends Error {}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new IntakeError(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new IntakeError(`${path} must be true or false`);
  return value;
}

function parseGuardian(raw: unknown, path: string): Guardian {
  if (typeof raw !== "object" || raw === null) throw new IntakeError(`${path} must be an object`);
  const g = raw as Record<string, unknown>;
  const phone = expectString(g.phone, `${path}.phone`);
  if (!E164.test(phone)) throw new IntakeError(`${path}.phone must be E.164, got a value that is not`);
  const region = expectString(g.region, `${path}.region`).toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) throw new IntakeError(`${path}.region must be a two-letter country code`);
  return {
    name: expectString(g.name, `${path}.name`),
    phone,
    locale: expectString(g.locale, `${path}.locale`),
    region,
    automatedCallsConsent: expectBoolean(g.automatedCallsConsent, `${path}.automatedCallsConsent`),
  };
}

function parseAbsence(raw: unknown, index: number): Absence {
  const path = `absences[${index}]`;
  if (typeof raw !== "object" || raw === null) throw new IntakeError(`${path} must be an object`);
  const a = raw as Record<string, unknown>;
  const date = expectString(a.date, `${path}.date`);
  if (!ISO_DATE.test(date)) throw new IntakeError(`${path}.date must be YYYY-MM-DD`);
  if (!Array.isArray(a.guardians) || a.guardians.length === 0) {
    throw new IntakeError(`${path}.guardians must be a non-empty array`);
  }
  const firstName = expectString(a.firstName, `${path}.firstName`);
  if (/\s/.test(firstName)) {
    throw new IntakeError(`${path}.firstName must be a first name only; surnames are never disclosed on a call`);
  }
  return {
    studentId: expectString(a.studentId, `${path}.studentId`),
    firstName,
    classLabel: expectString(a.classLabel, `${path}.classLabel`),
    date,
    guardians: a.guardians.map((g, i) => parseGuardian(g, `${path}.guardians[${i}]`)),
  };
}

function parseSchool(raw: unknown): SchoolConfig {
  if (typeof raw !== "object" || raw === null) throw new IntakeError("school must be an object");
  const s = raw as Record<string, unknown>;
  const window = s.callingWindow as Record<string, unknown> | undefined;
  if (!window) throw new IntakeError("school.callingWindow is required");
  const start = expectString(window.start, "school.callingWindow.start");
  const end = expectString(window.end, "school.callingWindow.end");
  if (!HHMM.test(start) || !HHMM.test(end)) throw new IntakeError("school.callingWindow must use HH:MM");
  if (start >= end) throw new IntakeError("school.callingWindow.start must be before end");
  const officePhone = expectString(s.officePhone, "school.officePhone");
  if (!E164.test(officePhone)) throw new IntakeError("school.officePhone must be E.164");
  const max = s.maxGuardiansPerStudent;
  if (typeof max !== "number" || !Number.isInteger(max) || max < 1) {
    throw new IntakeError("school.maxGuardiansPerStudent must be a positive integer");
  }
  const dnc = Array.isArray(s.doNotCall) ? s.doNotCall : [];
  for (const n of dnc) {
    if (typeof n !== "string" || !E164.test(n)) throw new IntakeError("school.doNotCall entries must be E.164");
  }
  return {
    schoolName: expectString(s.schoolName, "school.schoolName"),
    officePhone,
    safeguardingContact: expectString(s.safeguardingContact, "school.safeguardingContact"),
    callingWindow: { start, end },
    timeZone: expectString(s.timeZone, "school.timeZone"),
    maxGuardiansPerStudent: max,
    doNotCall: dnc as string[],
  };
}

export function parseRollCallInput(raw: unknown): RollCallInput {
  if (typeof raw !== "object" || raw === null) throw new IntakeError("input must be an object");
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.absences)) throw new IntakeError("absences must be an array");
  const absences = r.absences.map(parseAbsence);
  const ids = new Set<string>();
  for (const a of absences) {
    if (ids.has(a.studentId)) throw new IntakeError(`duplicate studentId ${a.studentId}`);
    ids.add(a.studentId);
  }
  return { school: parseSchool(r.school), absences };
}

export function loadRollCallInput(path: string): RollCallInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new IntakeError(`cannot read ${path}: ${(error as Error).message}`);
  }
  return parseRollCallInput(parsed);
}
