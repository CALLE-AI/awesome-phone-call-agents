import { test } from "node:test";
import assert from "node:assert/strict";
import { findPhone, isE164 } from "../lib/phone";
import demoApplication from "../fixtures/demo-application.json" with { type: "json" };

test("reads the common written forms of a number", () => {
  assert.equal(findPhone("Phone: (555) 555-0100"), "+15555550100");
  assert.equal(findPhone("555.555.0100"), "+15555550100");
  assert.equal(findPhone("555-555-0100"), "+15555550100");
  assert.equal(findPhone("1-800-555-0199"), "+18005550199");
  assert.equal(findPhone("+1 (555) 555-0100"), "+15555550100");
  assert.equal(findPhone("+44 20 7946 0958"), "+442079460958");
});

test("a labelled number beats a bare run of digits", () => {
  const text = "Processed 4155550142 tickets.\nMobile: (555) 555-0100";
  assert.equal(findPhone(text), "+15555550100");
});

test("earlier fields win, so a resume's contact block beats the answers", () => {
  assert.equal(findPhone("Tel 555-555-0100", "Tel 555-555-0199"), "+15555550100");
});

test("figures that are not numbers to call are left alone", () => {
  // Date ranges, counts and percentages are what a resume is full of.
  assert.equal(findPhone("Meridian Cloud Services (2019-2022)"), null);
  assert.equal(findPhone("2019 - 2022"), null);
  assert.equal(findPhone("Maintained 98% CSAT across 25-30 open cases"), null);
  assert.equal(findPhone("Processed 1,250,000 requests"), null);
  assert.equal(findPhone("San Francisco, CA 94105-1234"), null);
  assert.equal(findPhone("Cut first-response time from 41 minutes to 12"), null);
});

test("a line break cannot splice two figures into a number", () => {
  assert.equal(findPhone("(2019-2022)\n40+ accounts"), null);
});

test("a run too short to place is declined rather than guessed at", () => {
  assert.equal(findPhone("555-0100"), null);
  assert.equal(findPhone("7946 0958"), null);
});

test("a bare ten-digit run is assumed to be NANP", () => {
  // This is the one guess the parser makes, and it is unavoidable: a UK number
  // written without its country code is character-for-character a NANP number.
  // Writing "+44" is what distinguishes them, and most resumes outside NANP do.
  assert.equal(findPhone("20 7946 0958"), "+12079460958");
  assert.equal(findPhone("+44 20 7946 0958"), "+442079460958");
});

test("nothing at all is not an error, it is null", () => {
  assert.equal(findPhone(""), null);
  assert.equal(findPhone(undefined, null), null);
});

test("the seeded example carries no number, which is what makes it the demo", () => {
  // If this ever starts returning a number, the demo is dialing whoever the
  // fixture names — see `demoRecipient` in app/api/analyze/route.ts.
  assert.equal(findPhone(demoApplication.resume, demoApplication.answers), null);
});

test("isE164 accepts only what CALL-E can dial", () => {
  assert.equal(isE164("+15555550100"), true);
  assert.equal(isE164("5555550100"), false);
  assert.equal(isE164("+0555550100"), false);
  assert.equal(isE164(undefined), false);
});
