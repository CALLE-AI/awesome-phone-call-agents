import assert from "node:assert/strict";
import test from "node:test";

import { ContactCsvError, parseContactCsv } from "../lib/campaigns/contact-csv";

test("contact CSV extracts common header names in any order", () => {
  assert.deepEqual(
    parseContactCsv("\uFEFFMobile,Full Name\r\n+14155550101,Asha Sen\r\n+14155550100,Sam Lee"),
    [
      { name: "Asha Sen", phoneNumber: "+14155550101" },
      { name: "Sam Lee", phoneNumber: "+14155550100" },
    ],
  );
});

test("contact CSV extracts Name and Phone from wider files and removes spreadsheet apostrophes", () => {
  assert.deepEqual(
    parseContactCsv(
      "Email,Name,Notes,Phone\nasha@example.com,XYZ,VIP,'+14155550101'\nsam@example.com,ABC,new,'+14155550100",
    ),
    [
      { name: "XYZ", phoneNumber: "+14155550101" },
      { name: "ABC", phoneNumber: "+14155550100" },
    ],
  );
});

test("contact CSV supports quoted commas and headerless name-phone rows", () => {
  assert.deepEqual(parseContactCsv('"Sen, Asha",+14155550101\nSam Lee,+14155550100'), [
    { name: "Sen, Asha", phoneNumber: "+14155550101" },
    { name: "Sam Lee", phoneNumber: "+14155550100" },
  ]);
});

test("contact CSV combines first and last name columns", () => {
  assert.deepEqual(parseContactCsv("first_name,last_name,phone_number\nAsha,Sen,+14155550101"), [
    { name: "Asha Sen", phoneNumber: "+14155550101" },
  ]);
});

test("contact CSV rejects duplicate standards-reserved fictional recipients", () => {
  assert.throws(
    () =>
      parseContactCsv(
        "Name,Phone\nMarta Reyes,+14155550100\nDaniel Osei,+14155550100",
      ),
    (error: unknown) =>
      error instanceof ContactCsvError &&
      error.issues.some((issue) => issue.includes("duplicates")),
  );
});

test("contact CSV rejects malformed and duplicate recipients", () => {
  assert.throws(
    () => parseContactCsv("name,phone\nAsha,4155550100\nSam,+14155550101\nLee,+14155550101"),
    (error: unknown) =>
      error instanceof ContactCsvError &&
      error.issues.some((issue) => issue.includes("E.164")) &&
      error.issues.some((issue) => issue.includes("duplicates")),
  );
});
