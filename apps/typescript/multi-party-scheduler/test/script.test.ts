import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmSchema,
  confirmTask,
  gatherSchema,
  gatherTask,
  idempotencyKey,
  metadata,
  releaseSchema,
  releaseTask,
} from "../src/script.js";
import { coordinationRequest } from "./fixtures.js";

const request = coordinationRequest();
const plumber = request.parties[0]!;

test("the gather call says plainly that nothing is booked", () => {
  const task = gatherTask(request, plumber, request.slots);
  assert.match(task, /Nothing is booked yet/);
  assert.match(task, /I am not a person/);
  assert.match(task, /Never say the appointment is booked, held, confirmed or reserved/);
  assert.match(task, /a second call confirms one time once everyone has answered/);
});

test("the gather call reads only the options that are still open", () => {
  const narrowed = request.slots.filter((slot) => slot.option !== 1);
  const task = gatherTask(request, plumber, narrowed);
  assert.equal(task.includes("option 1,"), false);
  assert.match(task, /option 2, Thursday, August 6 at 2:00 PM/);
  assert.match(task, /option 3, Friday, August 7 at 9:00 AM/);
});

test("the gather call names the zone, the length and the place once", () => {
  const task = gatherTask(request, plumber, request.slots);
  assert.match(task, /All times are Pacific Daylight Time/);
  assert.match(task, /lasts 90 minutes/);
  assert.match(task, /14 Ash Lane, apartment 3B/);
});

test("the confirm call names exactly one time and asks for one word", () => {
  const task = confirmTask(request, plumber, request.slots[1]!);
  assert.match(task, /Thursday, August 6 at 2:00 PM Pacific Daylight Time/);
  assert.equal(task.includes("option 2,"), false);
  assert.match(task, /Please say confirm/);
  assert.match(task, /Do not offer or accept a different time/);
});

test("the release call tells a person it is off without asking anything", () => {
  const task = releaseTask(request, plumber, request.slots[1]!);
  assert.match(task, /is not going ahead/);
  assert.match(task, /Nothing is booked/);
  assert.match(task, /Do not offer a new time/);
});

test("result contracts are strict and shaped for the answer", () => {
  const gather = gatherSchema(3);
  assert.equal(gather.additionalProperties, false);
  assert.equal(gather.properties?.available_options?.type, "array");
  assert.equal(gather.properties?.available_options?.items?.type, "integer");
  assert.deepEqual(gather.properties?.none_work?.enum, ["yes", "no", "unknown"]);
  assert.deepEqual(confirmSchema().properties?.answer?.enum, ["confirm", "decline", "unknown"]);
  assert.deepEqual(releaseSchema().properties?.acknowledged?.enum, ["yes", "no", "unknown"]);
});

test("every call script refuses advice, emergencies and payment details", () => {
  const tasks = [
    gatherTask(request, plumber, request.slots),
    confirmTask(request, plumber, request.slots[1]!),
    releaseTask(request, plumber, request.slots[1]!),
  ];
  for (const task of tasks) {
    assert.match(task, /Give no medical, legal or financial advice/);
    assert.match(task, /If the person says this is an emergency/);
    assert.match(task, /call their local emergency number/);
    assert.match(task, /Ask for no payment detail/);
  }
});

test("idempotency keys are stable, specific to phase and slot, and bound to the content", () => {
  const gather = { task: gatherTask(request, plumber, request.slots), schema: gatherSchema(3) };
  const key = idempotencyKey(request, "gather", plumber, undefined, gather);
  assert.match(key, /^mps-ash-lane-3b-leak-gather-plumber-[0-9a-f]{12}$/);
  assert.equal(idempotencyKey(request, "gather", plumber, undefined, gather), key);

  // A shorter option list is a different call, so it must not reuse the key.
  const narrowed = { task: gatherTask(request, plumber, request.slots.slice(1)), schema: gatherSchema(3) };
  assert.notEqual(idempotencyKey(request, "gather", plumber, undefined, narrowed), key);

  const confirm = { task: confirmTask(request, plumber, request.slots[1]!), schema: confirmSchema() };
  const confirmKey = idempotencyKey(request, "confirm", plumber, request.slots[1]!, confirm);
  assert.match(confirmKey, /^mps-ash-lane-3b-leak-confirm-plumber-thu-14-[0-9a-f]{12}$/);
  assert.notEqual(
    confirmKey,
    idempotencyKey(request, "release", plumber, request.slots[1]!, {
      task: releaseTask(request, plumber, request.slots[1]!),
      schema: releaseSchema(),
    }),
  );
});

test("metadata carries what a workflow needs to reconcile a call", () => {
  const data = metadata(request, "confirm", plumber, request.slots[1]!);
  assert.equal(data.app, "multi-party-scheduler");
  assert.equal(data.request_id, "ash-lane-3b-leak");
  assert.equal(data.phase, "confirm");
  assert.equal(data.party_id, "plumber");
  assert.equal(data.slot_id, "thu-14");
  assert.equal(data.timezone, "America/Los_Angeles");
});
