import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfirmTask } from "../src/flows/confirm/prompt.js";
import { buildBackfillTask } from "../src/flows/backfill/prompt.js";
import { buildQualifyTask } from "../src/flows/qualify/prompt.js";

const slot = { startsAt: new Date("2026-08-10T14:00:00Z"), endsAt: new Date("2026-08-10T15:00:00Z"), serviceType: "Cleaning" };

test("buildConfirmTask mentions the contact, the appointment time, and requires will_attend in the schema", () => {
  const { task, resultSchema } = buildConfirmTask({
    businessName: "Riverside Dental",
    timezone: "UTC",
    contactName: "Ben Carter",
    appointmentSlot: slot,
    alternativeSlots: [],
  });
  assert.match(task, /Ben Carter/);
  assert.match(task, /Riverside Dental/);
  assert.deepEqual(resultSchema.required, ["will_attend", "reached_voicemail"]);
  assert.deepEqual(resultSchema.properties?.will_attend?.enum, ["yes", "no", "unknown"]);
});

test("buildConfirmTask lists offered alternatives when provided", () => {
  const alt = { id: "s2", startsAt: new Date("2026-08-11T10:00:00Z"), endsAt: new Date("2026-08-11T11:00:00Z"), serviceType: "Cleaning" };
  const { task } = buildConfirmTask({
    businessName: "Riverside Dental",
    timezone: "UTC",
    contactName: "Ben Carter",
    appointmentSlot: slot,
    alternativeSlots: [alt],
  });
  assert.match(task, /option_1/);
});

test("buildBackfillTask offers the freed slot and requires accepted enum", () => {
  const { task, resultSchema } = buildBackfillTask({
    businessName: "Riverside Dental",
    timezone: "UTC",
    contactName: "Elena Petrova",
    openSlot: slot,
  });
  assert.match(task, /Elena Petrova/);
  assert.match(task, /waitlist/i);
  assert.deepEqual(resultSchema.required, ["accepted"]);
  assert.deepEqual(resultSchema.properties?.accepted?.enum, ["yes", "no"]);
});

test("buildQualifyTask offers the next open slot when one exists", () => {
  const { task, resultSchema } = buildQualifyTask({
    businessName: "Riverside Dental",
    timezone: "UTC",
    contactName: "Hana Suzuki",
    rawInquiry: "Do you take new patients?",
    nextOpenSlot: slot,
  });
  assert.match(task, /Hana Suzuki/);
  assert.match(task, /next available slot/);
  assert.ok(resultSchema.required?.includes("interested"));
});

test("buildQualifyTask falls back to waitlist language when no slot is open", () => {
  const { task } = buildQualifyTask({
    businessName: "Riverside Dental",
    timezone: "UTC",
    contactName: "Hana Suzuki",
    rawInquiry: "Do you take new patients?",
    nextOpenSlot: null,
  });
  assert.match(task, /added to the waitlist/);
});
