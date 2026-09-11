export const MAX_CONTACT_CSV_BYTES = 256 * 1024;
export const MAX_CONTACT_CSV_ROWS = 10;

export type ParsedCsvContact = {
  name: string;
  phoneNumber: string;
};

type CsvRow = {
  line: number;
  values: string[];
};

const NAME_HEADERS = new Set([
  "name",
  "fullname",
  "contactname",
  "customername",
  "recipientname",
]);
const FIRST_NAME_HEADERS = new Set(["firstname", "givenname"]);
const LAST_NAME_HEADERS = new Set(["lastname", "surname", "familyname"]);
const PHONE_HEADERS = new Set([
  "phone",
  "phonenumber",
  "mobile",
  "mobilenumber",
  "telephone",
  "tel",
  "recipientphone",
]);
const E164 = /^\+[1-9]\d{7,14}$/;

export class ContactCsvError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "ContactCsvError";
  }
}

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseRows(input: string): CsvRow[] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: CsvRow[] = [];
  let values: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const finishRow = () => {
    values.push(field.trim());
    if (values.some((value) => value.length > 0)) rows.push({ line: rowLine, values });
    values = [];
    field = "";
    rowLine = line + 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
        if (char === "\n") line += 1;
      }
      continue;
    }

    if (char === '"' && field.trim() === "") {
      quoted = true;
    } else if (char === ",") {
      values.push(field.trim());
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
      line += 1;
      rowLine = line;
    } else {
      field += char;
    }
  }

  if (quoted) throw new ContactCsvError(["CSV contains an unclosed quoted field"]);
  if (field.length > 0 || values.length > 0) finishRow();
  return rows;
}

function findHeader(headers: string[], names: Set<string>): number {
  return headers.findIndex((header) => names.has(header));
}

function cleanSpreadsheetPhone(value: string): string {
  let phone = value.trim();
  // Spreadsheets commonly use a leading apostrophe to preserve the `+` and prevent
  // phone numbers being interpreted as formulas or numbers. Some exports retain only
  // the leading apostrophe; hand-authored files sometimes retain a pair.
  if (phone.startsWith("'")) phone = phone.slice(1).trim();
  if (phone.endsWith("'")) phone = phone.slice(0, -1).trim();
  return phone;
}

export function parseContactCsv(
  input: string,
  maxContacts = MAX_CONTACT_CSV_ROWS,
): ParsedCsvContact[] {
  const rows = parseRows(input);
  if (!rows.length) throw new ContactCsvError(["CSV does not contain any contacts"]);

  const headers = rows[0].values.map(headerKey);
  const nameIndex = findHeader(headers, NAME_HEADERS);
  const firstNameIndex = findHeader(headers, FIRST_NAME_HEADERS);
  const lastNameIndex = findHeader(headers, LAST_NAME_HEADERS);
  const phoneIndex = findHeader(headers, PHONE_HEADERS);
  const knownHeader = headers.some(
    (header) =>
      NAME_HEADERS.has(header) ||
      FIRST_NAME_HEADERS.has(header) ||
      LAST_NAME_HEADERS.has(header) ||
      PHONE_HEADERS.has(header),
  );

  if (knownHeader && phoneIndex < 0) {
    throw new ContactCsvError(["CSV header must include a phone or mobile column"]);
  }
  if (knownHeader && nameIndex < 0 && firstNameIndex < 0) {
    throw new ContactCsvError(["CSV header must include a name or first name column"]);
  }

  const contactRows = knownHeader ? rows.slice(1) : rows;
  if (!contactRows.length) throw new ContactCsvError(["CSV does not contain any contact rows"]);
  if (contactRows.length > maxContacts) {
    throw new ContactCsvError([`CSV contains ${contactRows.length} contacts; maximum is ${maxContacts}`]);
  }

  const issues: string[] = [];
  const phones = new Set<string>();
  const contacts = contactRows.map((row): ParsedCsvContact => {
    const firstName = knownHeader
      ? nameIndex >= 0
        ? row.values[nameIndex] ?? ""
        : row.values[firstNameIndex] ?? ""
      : row.values[0] ?? "";
    const lastName = knownHeader && nameIndex < 0 && lastNameIndex >= 0
      ? row.values[lastNameIndex] ?? ""
      : "";
    const name = `${firstName} ${lastName}`.trim().replace(/\s+/g, " ");
    const phoneNumber = cleanSpreadsheetPhone(
      knownHeader ? row.values[phoneIndex] ?? "" : row.values[1] ?? "",
    );

    if (!name) issues.push(`line ${row.line}: contact name is missing`);
    if (name.length > 120) issues.push(`line ${row.line}: contact name exceeds 120 characters`);
    if (!E164.test(phoneNumber)) {
      issues.push(`line ${row.line}: phone must use E.164 format, for example +14155550100`);
    } else if (phones.has(phoneNumber)) {
      issues.push(`line ${row.line}: phone number duplicates another contact`);
    }
    phones.add(phoneNumber);
    return { name, phoneNumber };
  });

  if (issues.length) throw new ContactCsvError(issues);
  return contacts;
}
