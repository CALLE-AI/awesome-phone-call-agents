import Papa from "papaparse";

import type { Recipient } from "./campaign";

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;

export type ImportResult = {
  recipients: Recipient[];
  sourceName: string;
  warnings: string[];
};

export type ManualRecipientInput = {
  studentName: string;
  studentCode: string;
  recipientName: string;
  recipientType: "guardian" | "adult_student";
  phone: string;
  employeeCode: string;
  consentSource: string;
  consentTimestamp: string;
  consentConfirmed: boolean;
};

const headerAliases = {
  studentName: ["student_name", "student", "learner_name"],
  studentCode: ["student_code", "student_id", "learner_code"],
  recipientName: ["recipient_name", "contact_name", "guardian_name", "adult_name"],
  recipientType: ["recipient_type", "contact_type"],
  phone: ["phone", "phone_number", "mobile", "telephone"],
  employeeCode: ["employee_code", "staff_code", "owner_code"],
  consentStatus: ["consent_status", "consent", "outreach_consent"],
  consentSource: ["consent_source", "consent_evidence", "consent_record"],
  consentTimestamp: ["consent_timestamp", "consent_date", "consented_at"],
} as const;

type Field = keyof typeof headerAliases;
type Cell = string | number | boolean | Date | null | undefined;

function normalizedHeader(value: Cell) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_")
    .replace(/[^a-z0-9_]/gu, "");
}

function cleanCell(value: Cell) {
  return value instanceof Date ? value.toISOString() : String(value ?? "").trim();
}

function columnIndexes(header: Cell[]) {
  const normalized = header.map(normalizedHeader);
  return Object.fromEntries(
    Object.entries(headerAliases).map(([field, aliases]) => [
      field,
      normalized.findIndex((column) => (aliases as readonly string[]).includes(column)),
    ])
  ) as Record<Field, number>;
}

function requiredColumns(indexes: Record<Field, number>) {
  return (Object.keys(headerAliases) as Field[]).filter((field) => indexes[field] < 0);
}

function normalizeRecipientType(value: string) {
  const normalized = normalizedHeader(value);
  if (["guardian", "parent", "caregiver"].includes(normalized)) return "guardian" as const;
  if (["adult_student", "adult", "student"].includes(normalized)) return "adult_student" as const;
  return null;
}

function consentState(value: string) {
  const normalized = normalizedHeader(value);
  if (["yes", "true", "eligible", "active", "consented", "opted_in", "approved"].includes(normalized)) return "eligible" as const;
  if (["no", "false", "blocked", "withdrawn", "do_not_call", "dnc", "opted_out"].includes(normalized)) return "blocked" as const;
  return null;
}

export function createManualRecipient(input: ManualRecipientInput, existingCodes: string[], id = `manual-${crypto.randomUUID()}`): Recipient {
  const values = [input.studentName, input.studentCode, input.recipientName, input.phone, input.employeeCode, input.consentSource, input.consentTimestamp];
  if (values.some((value) => !value.trim())) {
    throw new Error("Complete every recipient and consent-evidence field.");
  }
  const phone = input.phone.replace(/[\s()-]/gu, "");
  if (!/^\+[1-9]\d{7,14}$/u.test(phone)) {
    throw new Error("Use an E.164 phone number beginning with + and the country code.");
  }
  if (existingCodes.some((code) => code.toLowerCase() === input.studentCode.trim().toLowerCase())) {
    throw new Error("That student code is already in this campaign.");
  }
  const consentDate = new Date(input.consentTimestamp);
  if (Number.isNaN(consentDate.getTime())) {
    throw new Error("Enter a valid consent date and time.");
  }
  if (!input.consentConfirmed) {
    throw new Error("Confirm that the stored evidence covers automated, processed and transcribed outreach.");
  }
  return {
    id,
    studentName: input.studentName.trim(),
    studentCode: input.studentCode.trim(),
    recipientName: input.recipientName.trim(),
    recipientType: input.recipientType,
    phone,
    employeeCode: input.employeeCode.trim(),
    consentSource: input.consentSource.trim(),
    consentTimestamp: consentDate.toISOString(),
    status: "eligible",
  };
}

export function normalizeTable(rows: Cell[][], sourceName = "local file"): ImportResult {
  const nonEmpty = rows.filter((row) => row.some((cell) => cleanCell(cell)));
  if (nonEmpty.length < 2) {
    throw new Error("The file needs one header row and at least one recipient row.");
  }
  if (nonEmpty.length - 1 > MAX_IMPORT_ROWS) {
    throw new Error(`The shortlist exceeds the ${MAX_IMPORT_ROWS}-row safety limit.`);
  }

  const indexes = columnIndexes(nonEmpty[0]);
  const missing = requiredColumns(indexes);
  if (missing.length) {
    throw new Error(`Missing required columns: ${missing.map((field) => headerAliases[field][0]).join(", ")}.`);
  }

  const warnings: string[] = [];
  const seenCodes = new Set<string>();
  const recipients = nonEmpty.slice(1).flatMap((row, offset) => {
    const rowNumber = offset + 2;
    const value = (field: Field) => cleanCell(row[indexes[field]]);
    const studentName = value("studentName");
    const studentCode = value("studentCode");
    const recipientName = value("recipientName");
    const recipientType = normalizeRecipientType(value("recipientType"));
    const phone = value("phone").replace(/[\s()-]/gu, "");
    const employeeCode = value("employeeCode");
    const status = consentState(value("consentStatus"));
    const consentSource = value("consentSource");
    const consentTimestamp = value("consentTimestamp");

    const missingValues = [studentName, studentCode, recipientName, phone, employeeCode, consentSource, consentTimestamp].some((item) => !item);
    if (missingValues || !recipientType || !status || !/^\+[1-9]\d{7,14}$/u.test(phone)) {
      warnings.push(`Row ${rowNumber} was rejected: required value, recipient type, consent status, or E.164 phone is invalid.`);
      return [];
    }
    if (seenCodes.has(studentCode)) {
      warnings.push(`Row ${rowNumber} was rejected: duplicate student_code ${studentCode}.`);
      return [];
    }
    seenCodes.add(studentCode);

    return [{
      id: `import-${rowNumber}-${studentCode.replace(/[^a-z0-9]/giu, "").toLowerCase()}`,
      studentName,
      studentCode,
      recipientName,
      phone,
      recipientType,
      employeeCode,
      consentSource,
      consentTimestamp,
      status,
      ...(status === "blocked" ? { blocker: "Consent is not active — Do Not Call" } : {}),
    } satisfies Recipient];
  });

  if (!recipients.length) {
    throw new Error(warnings[0] || "No valid recipients were found.");
  }
  return { recipients, sourceName, warnings };
}

export function parseDelimitedText(text: string, sourceName = "local file") {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/u, ""), {
    delimiter: "",
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length) {
    throw new Error(`The table could not be read: ${parsed.errors[0].message}`);
  }
  return normalizeTable(parsed.data, sourceName);
}

function extensionOf(name: string) {
  return name.toLowerCase().split(".").at(-1) || "";
}

export async function importShortlist(file: File): Promise<ImportResult> {
  if (!file.size) throw new Error("The selected file is empty.");
  if (file.size >= MAX_IMPORT_BYTES) throw new Error("Files must be smaller than 50 MB.");

  const extension = extensionOf(file.name);
  if (extension === "csv") {
    return parseDelimitedText(await file.text(), file.name);
  }
  if (extension === "xlsx") {
    const { default: readXlsxFile } = await import("read-excel-file");
    const rows = await readXlsxFile(file);
    return normalizeTable(rows as unknown as Cell[][], file.name);
  }
  if (extension === "docx") {
    const { parseDocxTable } = await import("./word-import");
    return normalizeTable(await parseDocxTable(await file.arrayBuffer()), file.name);
  }
  if (extension === "pdf") {
    const { parsePdfTable } = await import("./pdf-import");
    return normalizeTable(await parsePdfTable(await file.arrayBuffer()), file.name);
  }
  throw new Error("Use a CSV, XLSX, DOCX, or text-based PDF file.");
}
