import assert from "node:assert/strict";
import test from "node:test";

import { createManualRecipient, MAX_IMPORT_BYTES, normalizeTable, parseDelimitedText } from "../src/imports";

const header = "student_name,student_code,recipient_name,recipient_type,phone,employee_code,consent_status,consent_source,consent_timestamp";

test("CSV intake validates required identifiers, consent, and E.164 phones", () => {
  const result = parseDelimitedText(`${header}\nAmina Rahman,STU-1042,Farah Rahman,guardian,+60123456789,EMP-024,yes,Signed form,2026-07-28T14:20:00+08:00`, "shortlist.csv");
  assert.equal(result.sourceName, "shortlist.csv");
  assert.equal(result.recipients.length, 1);
  assert.equal(result.recipients[0].studentCode, "STU-1042");
  assert.equal(result.recipients[0].employeeCode, "EMP-024");
  assert.equal(result.recipients[0].status, "eligible");
});

test("withdrawn consent remains blocked and malformed rows are rejected", () => {
  const result = parseDelimitedText([
    header,
    "Noah Tan,STU-1097,Mei Tan,guardian,+60123456780,EMP-031,withdrawn,Guardian withdrawal,2026-07-31T16:40:00+08:00",
    "Bad Row,STU-9999,Contact,guardian,012345,EMP-031,yes,Phone note,2026-07-31",
  ].join("\n"));
  assert.equal(result.recipients.length, 1);
  assert.equal(result.recipients[0].status, "blocked");
  assert.match(result.recipients[0].blocker || "", /Do Not Call/u);
  assert.equal(result.warnings.length, 1);
});

test("intake rejects missing required columns and excessive rows", () => {
  assert.throws(() => parseDelimitedText("student_name,phone\nA,+60123456789"), /Missing required columns/u);
  const rows = [header.split(","), ...Array.from({ length: 501 }, (_, index) => ["A", `S-${index}`, "B", "guardian", "+60123456789", "E-1", "yes", "form", "2026-01-01"])];
  assert.throws(() => normalizeTable(rows), /500-row/u);
  assert.equal(MAX_IMPORT_BYTES, 52_428_800);
});

test("manual intake requires explicit consent evidence and rejects duplicate codes", () => {
  const input = {
    studentName: "Amina Rahman",
    studentCode: "STU-1042",
    recipientName: "Farah Rahman",
    recipientType: "guardian" as const,
    phone: "+60 12-345 6789",
    employeeCode: "EMP-024",
    consentSource: "Signed outreach consent",
    consentTimestamp: "2026-08-01T10:00",
    consentConfirmed: true,
  };
  const recipient = createManualRecipient(input, [], "manual-test");
  assert.equal(recipient.id, "manual-test");
  assert.equal(recipient.phone, "+60123456789");
  assert.equal(recipient.status, "eligible");
  assert.throws(() => createManualRecipient({ ...input, consentConfirmed: false }, []), /Confirm that the stored evidence/u);
  assert.throws(() => createManualRecipient(input, ["stu-1042"]), /already in this campaign/u);
});
