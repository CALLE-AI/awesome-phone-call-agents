import assert from "node:assert/strict";
import test from "node:test";
import {
  blocking,
  forbiddenDisclosure,
  spokenItems,
  unauthorizedFindings,
  withoutKnownNumbers,
} from "../src/disclosure.js";
import type { DisclosureItem } from "../src/types.js";

const BUDGET: DisclosureItem[] = [
  { key: "full_name", label: "the caller's full name", value: "Fatima Haddad" },
  { key: "date_of_birth", label: "date of birth", value: "12 April 1990" },
  { key: "patient_id", label: "patient id", value: "PT 88213" },
];

function kinds(text: string): string[] {
  return unauthorizedFindings(text, BUDGET, "test").map((finding) => finding.kind);
}

test("details nobody authorized are found", () => {
  assert.deepEqual(kinds("write to fatima.haddad@example.com"), ["email address"]);
  assert.deepEqual(kinds("her social is 123-45-6789"), ["national identifier"]);
  assert.deepEqual(kinds("the reference is AB-994512"), ["identifier"]);
  assert.deepEqual(kinds("she lives at 42 Bayview Street"), ["street address"]);
  assert.ok(kinds("the number is 4915 6612 3300").includes("long number"));
});

test("an authorized value is not a finding, however it is written", () => {
  assert.deepEqual(kinds("the patient id is PT 88213"), []);
  assert.deepEqual(kinds("patient pt-88213 please"), []);
  assert.deepEqual(kinds("Fatima Haddad, born 12 April 1990"), []);
});

test("a bare date is a warning and not a refusal", () => {
  const findings = unauthorizedFindings("the form from 2026-08-12", BUDGET, "test");
  assert.deepEqual(findings.map((finding) => finding.kind), ["date"]);
  assert.equal(findings[0]!.severity, "warn");
  assert.deepEqual(blocking(findings), []);
});

test("an email is a refusal", () => {
  const findings = unauthorizedFindings("mail me at x@example.com", BUDGET, "test");
  assert.equal(blocking(findings).length, 1);
  assert.equal(findings[0]!.severity, "block");
});

test("findings mask the token, because a privacy report must not leak", () => {
  const findings = unauthorizedFindings("her social is 123-45-6789", BUDGET, "questions[0]");
  assert.equal(findings[0]!.masked.includes("123-45-6789"), false);
  assert.match(findings[0]!.masked, /^12\*+$/);
  assert.equal(findings[0]!.where, "questions[0]");
});

test("the same detail twice is one finding", () => {
  assert.deepEqual(kinds("x@example.com and again x@example.com"), ["email address"]);
});

test("payment cards and secrets are refused outright", () => {
  assert.match(
    String(forbiddenDisclosure({ key: "card_number", label: "card", value: "1234" })),
    /will not read that out/,
  );
  assert.match(String(forbiddenDisclosure({ key: "code", label: "CVV code", value: "123" })), /cvv/i);
  assert.match(String(forbiddenDisclosure({ key: "login", label: "portal password", value: "hunter2" })), /password/i);
  assert.match(
    String(forbiddenDisclosure({ key: "payment", label: "the long number", value: "4111 1111 1111 1111" })),
    /payment card number/,
  );
  assert.equal(forbiddenDisclosure({ key: "full_name", label: "full name", value: "Fatima Haddad" }), null);
});

test("what the caller actually said is matched back to the budget", () => {
  const said = "I am calling for Fatima Haddad. Her date of birth is 12 April 1990.";
  assert.deepEqual(
    spokenItems(said, BUDGET).map((item) => item.key),
    ["full_name", "date_of_birth"],
  );
});

test("the number being called is not a leak", () => {
  const text = "calling 415 555 0122 now";
  assert.equal(kinds(text).includes("long number"), true);
  assert.deepEqual(kinds(withoutKnownNumbers(text, ["+14155550122"])), []);
});
