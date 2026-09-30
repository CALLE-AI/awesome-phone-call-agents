import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { maskPhone, maskPhonesInText } from "../src/mask.js";
import { applyAllowlist, loadEnrollees, parseCsv, parseEnrollees, REGISTRY_COLUMNS } from "../src/registry.js";

type Column = (typeof REGISTRY_COLUMNS)[number];
const HEADER = REGISTRY_COLUMNS.join(",");
const row = (values: Partial<Record<Column, string>>): string => REGISTRY_COLUMNS.map((c) => values[c] ?? "").join(",");
const base: Partial<Record<Column, string>> = { person_id: "p1", name: "Ana Diaz", phone: "+14155550401", locale: "es-US", birth_year: "1990", check_date: "2027-01-31", consent: "yes" };
const SAMPLE = join(process.cwd(), "data", "enrollees.sample.csv");

test("the sample list loads 13 people and skips the no-consent, duplicate-phone and do-not-call rows", () => {
  const { people, report } = loadEnrollees(SAMPLE);
  assert.equal(people.length, 13);
  assert.equal(report.skippedNoConsent, 1);
  assert.equal(report.skippedDuplicatePhone, 1);
  assert.equal(report.skippedDoNotCall, 1);
});

test("parseCsv handles quoted commas and CRLF", () => {
  assert.deepEqual(parseCsv('a,b\r\n1,"x, y"\r\n'), [
    ["a", "b"],
    ["1", "x, y"],
  ]);
});

test("known_exempt and known_* columns record what the state already knows; an unknown code is ignored with a warning", () => {
  const { people, report } = parseEnrollees(`${HEADER}\n${row({ ...base, known_exempt: "tribal", known_snap_tanf: "no" })}\n${row({ ...base, person_id: "p2", phone: "+14155550402", known_exempt: "astronaut" })}`);
  assert.equal(people[0]?.known.tribal, "yes");
  assert.equal(people[0]?.known.snap_tanf, "no");
  assert.equal(people[1]?.known.tribal, undefined);
  assert.ok(report.warnings.some((w) => w.includes("astronaut")));
});

test("first name defaults to the first word; a bad check date and a missing birth year are flagged", () => {
  const { people, report } = parseEnrollees(`${HEADER}\n${row({ ...base, check_date: "31/01/2027", birth_year: "" })}`);
  assert.equal(people[0]?.firstName, "Ana");
  assert.equal(people[0]?.checkDate, null);
  assert.equal(people[0]?.birthYear, null);
  assert.ok(report.warnings.some((w) => w.includes("check_date")));
  assert.ok(report.warnings.some((w) => w.includes("identity cannot be confirmed")));
});

test("invalid phones and missing consent are never loaded", () => {
  const { people, report } = parseEnrollees(`${HEADER}\n${row({ ...base, phone: "415-555-0401" })}\n${row({ ...base, person_id: "p3", phone: "+14155550403", consent: "no" })}`);
  assert.equal(people.length, 0);
  assert.equal(report.skippedInvalidPhone, 1);
  assert.equal(report.skippedNoConsent, 1);
});

test("the live allowlist keeps only listed numbers", () => {
  const { people } = loadEnrollees(SAMPLE);
  const { kept, skipped } = applyAllowlist(people, ["+14155550301"]);
  assert.deepEqual(kept.map((p) => p.id), ["e001"]);
  assert.equal(skipped.length, 12);
});

test("masking keeps the country prefix and the last two digits only", () => {
  assert.equal(maskPhone("+14155550301"), "+14*******01");
  assert.equal(maskPhonesInText("call +14155550301 now"), "call +14*******01 now");
});
