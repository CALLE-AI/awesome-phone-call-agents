import assert from "node:assert/strict";
import { test } from "node:test";
import { IntakeError, parseRollCallInput } from "../src/intake.js";
import { mayCallGuardian, withinCallingWindow } from "../src/policy.js";
import { maskPhone, maskPhonesInText } from "../src/privacy.js";
import type { RollCallInput } from "../src/types.js";

function valid(): Record<string, unknown> {
  return {
    school: {
      schoolName: "Riverside",
      officePhone: "+15550100000",
      safeguardingContact: "Ms. Alvarez",
      callingWindow: { start: "08:00", end: "11:30" },
      timeZone: "America/New_York",
      maxGuardiansPerStudent: 2,
      doNotCall: ["+15550100199"],
    },
    absences: [
      {
        studentId: "S-1",
        firstName: "Amara",
        classLabel: "5B",
        date: "2026-09-14",
        guardians: [
          { name: "Ms. Okafor", phone: "+15550100101", locale: "en-US", region: "us", automatedCallsConsent: true },
          { name: "Mr. Okafor", phone: "+15550100199", locale: "en-US", region: "US", automatedCallsConsent: true },
          { name: "Aunt", phone: "+15550100108", locale: "en-US", region: "US", automatedCallsConsent: false },
        ],
      },
    ],
  };
}

test("intake accepts a valid file and normalises region", () => {
  const input = parseRollCallInput(valid());
  assert.equal(input.absences[0].guardians[0].region, "US");
});

test("intake refuses surnames in firstName, bad phones, duplicate students, bad windows", () => {
  const surname = valid();
  (surname.absences as any)[0].firstName = "Amara Okafor";
  assert.throws(() => parseRollCallInput(surname), IntakeError);

  const badPhone = valid();
  (badPhone.absences as any)[0].guardians[0].phone = "555-0101";
  assert.throws(() => parseRollCallInput(badPhone), /E\.164/);

  const dup = valid();
  (dup.absences as any).push((valid().absences as any)[0]);
  assert.throws(() => parseRollCallInput(dup), /duplicate/);

  const window = valid();
  (window.school as any).callingWindow = { start: "12:00", end: "08:00" };
  assert.throws(() => parseRollCallInput(window), /before end/);
});

test("calling window is evaluated in the school's time zone", () => {
  const input: RollCallInput = parseRollCallInput(valid());
  // 13:10Z is 09:10 in New York in September (EDT)
  assert.equal(withinCallingWindow(new Date("2026-09-14T13:10:00Z"), input.school), true);
  // 16:00Z is 12:00 in New York — after the 11:30 end
  assert.equal(withinCallingWindow(new Date("2026-09-14T16:00:00Z"), input.school), false);
});

test("policy refuses consent-less, do-not-call, over-limit and out-of-window guardians with a reason", () => {
  const input = parseRollCallInput(valid());
  const a = input.absences[0];
  const inWindow = new Date("2026-09-14T13:10:00Z");
  assert.equal(mayCallGuardian(a.guardians[0], 0, a, input.school, inWindow).allowed, true);
  assert.match(mayCallGuardian(a.guardians[1], 1, a, input.school, inWindow).reason ?? "", /do-not-call/);
  assert.match(mayCallGuardian(a.guardians[2], 2, a, input.school, inWindow).reason ?? "", /consented/);
  const consenting = { ...a.guardians[2], automatedCallsConsent: true };
  a.guardians[2] = consenting;
  assert.match(mayCallGuardian(consenting, 2, a, input.school, inWindow).reason ?? "", /cascade limit/);
  assert.match(
    mayCallGuardian(a.guardians[0], 0, a, input.school, new Date("2026-09-14T03:00:00Z")).reason ?? "",
    /calling window/,
  );
});

test("phone masking keeps country code and last two digits only", () => {
  assert.equal(maskPhone("+15550100101"), "+155******01");
  assert.equal(maskPhone("+4915512345678"), "+491********78");
  assert.equal(maskPhonesInText("call +15550100101 or +15550100102"), "call +155******01 or +155******02");
});
