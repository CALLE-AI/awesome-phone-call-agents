import assert from "node:assert/strict";
import test from "node:test";
import { chooseSlot, intersect, parseSlots, SlotError, spokenTime, zoneOffset } from "../src/slots.js";

const ZONE = "America/Los_Angeles";

const THREE = [
  { id: "fri-09", start: "2026-08-07T09:00:00-07:00" },
  { id: "thu-10", start: "2026-08-06T10:00:00-07:00" },
  { id: "thu-14", start: "2026-08-06T14:00:00-07:00" },
];

test("slots are sorted by instant and numbered as options people can say", () => {
  const slots = parseSlots(THREE, ZONE);
  assert.deepEqual(
    slots.map((slot) => [slot.option, slot.id]),
    [
      [1, "thu-10"],
      [2, "thu-14"],
      [3, "fri-09"],
    ],
  );
  assert.match(slots[0]!.spoken, /^option 1, Thursday, August 6 at 10:00 AM$/);
});

test("an offset that disagrees with the declared zone is refused", () => {
  assert.throws(
    () =>
      parseSlots(
        [
          { id: "a", start: "2026-08-06T10:00:00-08:00" },
          { id: "b", start: "2026-08-06T14:00:00-07:00" },
        ],
        ZONE,
      ),
    (error: unknown) => {
      assert.ok(error instanceof SlotError);
      assert.match(error.message, /carries offset -08:00 but America\/Los_Angeles is -07:00/);
      return true;
    },
  );
});

test("the zone offset is read from the zone, not assumed", () => {
  assert.equal(zoneOffset(Date.parse("2026-08-06T10:00:00-07:00"), ZONE), "-07:00");
  assert.equal(zoneOffset(Date.parse("2026-01-06T10:00:00-08:00"), ZONE), "-08:00");
  assert.equal(zoneOffset(Date.parse("2026-08-06T10:00:00Z"), "UTC"), "+00:00");
});

test("a timezone that is not an IANA name is refused", () => {
  assert.throws(() => parseSlots(THREE, "PDT"), SlotError);
});

test("a call cannot read a calendar out loud", () => {
  assert.throws(() => parseSlots([THREE[0]!], ZONE), SlotError);
  assert.throws(
    () =>
      parseSlots(
        [
          ...THREE,
          { id: "sat-09", start: "2026-08-08T09:00:00-07:00" },
          { id: "sat-11", start: "2026-08-08T11:00:00-07:00" },
        ],
        ZONE,
      ),
    SlotError,
  );
});

test("duplicate ids and duplicate instants are refused", () => {
  assert.throws(
    () =>
      parseSlots(
        [
          { id: "a", start: "2026-08-06T10:00:00-07:00" },
          { id: "a", start: "2026-08-06T14:00:00-07:00" },
        ],
        ZONE,
      ),
    SlotError,
  );
  assert.throws(
    () =>
      parseSlots(
        [
          { id: "a", start: "2026-08-06T10:00:00-07:00" },
          { id: "b", start: "2026-08-06T10:00:00-07:00" },
        ],
        ZONE,
      ),
    SlotError,
  );
});

test("a start without an offset is refused, because it would need guessing", () => {
  assert.throws(
    () =>
      parseSlots(
        [
          { id: "a", start: "2026-08-06T10:00" },
          { id: "b", start: "2026-08-06T14:00:00-07:00" },
        ],
        ZONE,
      ),
    SlotError,
  );
});

test("times are spoken in the meeting zone, not the machine zone", () => {
  const instant = Date.parse("2026-08-06T17:00:00Z");
  assert.match(spokenTime(instant, "America/Los_Angeles", 2), /option 2, Thursday, August 6 at 10:00 AM/);
  assert.match(spokenTime(instant, "Asia/Kolkata", 2), /option 2, Thursday, August 6 at 10:30 PM/);
});

test("narrowing keeps slot order and choosing takes the earliest", () => {
  const slots = parseSlots(THREE, ZONE);
  const narrowed = intersect(slots, [3, 2]);
  assert.deepEqual(narrowed.map((slot) => slot.id), ["thu-14", "fri-09"]);
  assert.equal(chooseSlot(narrowed)?.id, "thu-14");
  assert.equal(chooseSlot([]), null);
});
