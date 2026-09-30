import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDiscoveryQuery,
  discoveryClarification,
  isIanaTimezone,
  sevenDayLocalWindow,
} from "../lib/tools/discovery";

test("local discovery requires confirmed location and IANA timezone", () => {
  assert.match(discoveryClarification("local_events", { timezone: "Australia/Sydney" }) ?? "", /city or suburb/);
  assert.match(discoveryClarification("news", { timezone: "Sydney" }) ?? "", /timezone/);
  assert.equal(discoveryClarification("local_events", {
    location: "Sydney NSW",
    timezone: "Australia/Sydney",
  }), undefined);
  assert.equal(isIanaTimezone("Australia/Sydney"), true);
  assert.equal(isIanaTimezone("Sydney"), false);
});

test("relative event searches receive a concrete local seven-day window", () => {
  const now = new Date("2026-09-10T14:30:00.000Z");
  assert.deepEqual(sevenDayLocalWindow("Australia/Sydney", now), {
    startDate: "2026-09-11",
    endDate: "2026-09-17",
  });
  const query = buildDiscoveryQuery({
    context: { location: "Sydney NSW", timezone: "Australia/Sydney" },
    kind: "local_events",
    query: "gardening events this week",
  }, now);
  assert.match(query, /2026-09-11 through 2026-09-17/);
  assert.match(query, /official council, library, venue, or community listings/);
  assert.match(query, /availability needs confirmation unless confirmed/);
  assert.doesNotMatch(query, /workshop/i);
});

test("news searches are current, located when known, and source-aware", () => {
  const query = buildDiscoveryQuery({
    context: { location: "Sydney NSW", timezone: "Australia/Sydney" },
    kind: "news",
    query: "local transport news",
  }, new Date("2026-09-10T00:00:00.000Z"));
  assert.match(query, /Relevant location: Sydney NSW/);
  assert.match(query, /publication dates/);
  assert.match(query, /conflicting or developing claims/);
});

test("discovery rejects missing, excessive, and ambiguous context", () => {
  assert.throws(() => buildDiscoveryQuery({
    context: { location: "Sydney", timezone: "Sydney" },
    kind: "local_events",
    query: "events",
  }));
  assert.throws(() => buildDiscoveryQuery({
    context: { location: "x".repeat(161), timezone: "Australia/Sydney" },
    kind: "local_events",
    query: "events",
  }));
});
