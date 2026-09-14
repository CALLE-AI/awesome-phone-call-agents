import assert from "node:assert/strict";
import { test } from "node:test";
import { maskPhone, maskPhonesInText } from "../src/mask.js";
import { applyAllowlist, parseCsv, parseRegistry, regionFromPhone } from "../src/registry.js";

const HEADER = "person_id,name,phone,locale,region,age,lives_alone,has_cooling,medical_risks,address,lat,lng,contact_name,contact_phone,contact_locale,consent,consent_date,notes,scenario";

test("parseCsv handles quoted commas and CRLF", () => {
  const rows = parseCsv('a,b,c\r\n1,"x, y",3\r\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "x, y", "3"]]);
});

test("rows without consent are skipped and never dialled", () => {
  const text = `${HEADER}\np1,Ann,+14155550101,en-US,US,80,yes,no,,,,,,,,no,,,\np2,Ben,+14155550102,en-US,US,70,yes,yes,,,,,,,,yes,2026-01-01,,`;
  const { people, report } = parseRegistry(text);
  assert.equal(people.length, 1);
  assert.equal(people[0]?.id, "p2");
  assert.equal(report.skippedNoConsent, 1);
});

test("invalid phones are skipped", () => {
  const text = `${HEADER}\np1,Ann,415-555-0101,en-US,US,80,yes,no,,,,,,,,yes,,,`;
  const { people, report } = parseRegistry(text);
  assert.equal(people.length, 0);
  assert.equal(report.skippedInvalidPhone, 1);
});

test("two rows sharing one phone collapse to the first (platform issue #235)", () => {
  const text = `${HEADER}\np1,Ann,+14155550101,en-US,US,80,yes,no,,,,,,,,yes,,,\np2,Ann Again,+14155550101,en-US,US,80,yes,no,,,,,,,,yes,,,`;
  const { people, report } = parseRegistry(text);
  assert.equal(people.length, 1);
  assert.equal(report.skippedDuplicatePhone, 1);
});

test("medical risks split on ; and |, region inferred from the phone when blank", () => {
  const text = `${HEADER}\np1,Ann,+919999900001,hi-IN,,80,yes,no,cardiac; Dementia|oxygen,,,,,,,yes,,,`;
  const { people } = parseRegistry(text);
  assert.deepEqual(people[0]?.medicalRisks, ["cardiac", "dementia", "oxygen"]);
  assert.equal(people[0]?.region, "IN");
  assert.equal(regionFromPhone("+6591234567"), "SG");
  assert.equal(regionFromPhone("+971501234567"), "AE");
});

test("a non-E.164 contact phone is dropped with a warning, not used", () => {
  const text = `${HEADER}\np1,Ann,+14155550101,en-US,US,80,yes,no,,,,,Bob,555-0111,,yes,,,`;
  const { people, report } = parseRegistry(text);
  assert.equal(people[0]?.contactPhone, null);
  assert.ok(report.warnings.some((w) => w.includes("contact phone")));
});

test("live allowlist keeps only listed numbers", () => {
  const text = `${HEADER}\np1,Ann,+14155550101,en-US,US,80,yes,no,,,,,,,,yes,,,\np2,Ben,+14155550102,en-US,US,70,yes,yes,,,,,,,,yes,,,`;
  const { people } = parseRegistry(text);
  const { kept, skipped } = applyAllowlist(people, ["+14155550102"]);
  assert.deepEqual(kept.map((p) => p.id), ["p2"]);
  assert.deepEqual(skipped.map((p) => p.id), ["p1"]);
});

test("masking keeps the prefix and the last two digits only", () => {
  assert.equal(maskPhone("+14155550101"), "+14*******01");
  assert.equal(maskPhonesInText("call +14155550101 or +919999900001 now"), "call +14*******01 or +91********01 now");
});
