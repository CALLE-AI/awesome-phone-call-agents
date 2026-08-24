import { read, utils, type WorkBook } from "xlsx";

import type { CandidateInput } from "@/lib/types";

export { rosterStatus } from "@/lib/status";

const MAX_ROWS = 500;

const NAME_HEADERS = ["name", "candidate", "candidate_name", "full_name", "student_name"];
const PHONE_HEADERS = ["phone", "mobile", "phone_number", "contact", "phone_no"];
const CONSENT_HEADERS = ["consent", "consented", "consent_given", "consent_status"];
const RESUME_HEADERS = [
  "resume_link",
  "resume_url",
  "resume",
  "cv_link",
  "cv_url",
  "cv",
];
const JOB_ROLE_HEADERS = [
  "job_role",
  "role",
  "position",
  "job",
  "job_title",
  "opening",
];

export type ParseIssue = {
  row: number;
  message: string;
};

export type ParseResult = {
  candidates: CandidateInput[];
  issues: ParseIssue[];
  skipped: number;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function pickColumn(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);
    if (index >= 0) return index;
  }
  return -1;
}

function cell(row: unknown[], index: number): string {
  if (index < 0) return "";
  const value = row[index];
  if (value == null) return "";
  return String(value).trim();
}

export function normalizePhone(value: string): string {
  let compact = value.replace(/[\s().-]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  if (/^91\d{10}$/.test(compact)) return `+${compact}`;
  return compact;
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

function parseConsent(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ["yes", "y", "true", "1", "consented", "granted", "ok"].includes(normalized);
}

export function parseWorkbook(buffer: ArrayBuffer): ParseResult {
  const workbook: WorkBook = read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { candidates: [], issues: [{ row: 0, message: "The file has no sheets." }], skipped: 0 };
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  if (matrix.length < 2) {
    return {
      candidates: [],
      issues: [{ row: 0, message: "Add a header row and at least one candidate." }],
      skipped: 0,
    };
  }

  const headers = (matrix[0] ?? []).map(normalizeHeader);
  const nameIndex = pickColumn(headers, NAME_HEADERS);
  const phoneIndex = pickColumn(headers, PHONE_HEADERS);
  const consentIndex = pickColumn(headers, CONSENT_HEADERS);
  const resumeIndex = pickColumn(headers, RESUME_HEADERS);
  const jobRoleIndex = pickColumn(headers, JOB_ROLE_HEADERS);

  const issues: ParseIssue[] = [];
  if (nameIndex < 0) issues.push({ row: 1, message: "Missing a Name column." });
  if (phoneIndex < 0) issues.push({ row: 1, message: "Missing a Phone column." });
  if (issues.length > 0) {
    return { candidates: [], issues, skipped: 0 };
  }

  const candidates: CandidateInput[] = [];
  let skipped = 0;
  const body = matrix.slice(1, MAX_ROWS + 1);

  body.forEach((rawRow, offset) => {
    const excelRow = offset + 2;
    const name = cell(rawRow, nameIndex);
    const phone = normalizePhone(cell(rawRow, phoneIndex));
    const resumeUrl = cell(rawRow, resumeIndex);
    const jobRole = cell(rawRow, jobRoleIndex);
    const consent = parseConsent(cell(rawRow, consentIndex));

    if (!name && !phone) {
      skipped += 1;
      return;
    }
    if (!name || !phone) {
      issues.push({
        row: excelRow,
        message: "Name and phone are both required. This row was skipped.",
      });
      skipped += 1;
      return;
    }
    if (!isValidE164(phone)) {
      issues.push({
        row: excelRow,
        message: "Phone needs a country code, e.g. +14155550123. This row was skipped.",
      });
      skipped += 1;
      return;
    }

    candidates.push({ name, phone, consent, resumeUrl, jobRole });
  });

  const sharedRole = candidates.find((row) => row.jobRole)?.jobRole ?? "";
  if (sharedRole) {
    for (const row of candidates) {
      if (!row.jobRole) row.jobRole = sharedRole;
    }
  }

  if (matrix.length - 1 > MAX_ROWS) {
    issues.push({
      row: MAX_ROWS + 1,
      message: `Only the first ${MAX_ROWS} data rows were imported.`,
    });
  }

  return { candidates, issues, skipped };
}
