import assert from "node:assert/strict";
import { test } from "node:test";
import { getRecallById, searchRecalls } from "../src/cpsc.js";

const raw = [{
  RecallID: 10887,
  RecallNumber: "26651",
  RecallDate: "2026-07-30T00:00:00",
  Description: "Description",
  URL: "https://www.cpsc.gov/Recalls/example",
  Title: "Example recall",
  ConsumerContact: "Call (833) 555-0108",
  Products: [{ Name: "Example product", NumberOfUnits: "47,000" }],
  Hazards: [{ Name: "Tip-over" }],
  Remedies: [{ Name: "Free repair kit" }],
  RemedyOptions: [{ Option: "Repair" }],
}];

function fakeFetch(expected: string): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    const url = String(input);
    assert.match(url, new RegExp(expected));
    return new Response(JSON.stringify(raw), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("searches and maps authoritative recall fields", async () => {
  const recalls = await searchRecalls("toddler tower", fakeFetch("ProductName=toddler\\+tower"));
  assert.equal(recalls[0]?.id, 10887);
  assert.equal(recalls[0]?.products[0]?.name, "Example product");
  assert.deepEqual(recalls[0]?.remedyOptions, ["Repair"]);
});

test("refetches an exact recall by id", async () => {
  const recall = await getRecallById(10887, fakeFetch("RecallID=10887"));
  assert.equal(recall.number, "26651");
});

test("rejects underspecified search and invalid ids", async () => {
  await assert.rejects(() => searchRecalls("x"), /at least two/);
  await assert.rejects(() => getRecallById(-1), /positive integer/);
});
