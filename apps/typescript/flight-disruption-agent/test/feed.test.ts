import assert from "node:assert/strict";
import { test } from "node:test";
import { DryRunGateway } from "../src/calle.ts";
import { loadCatalog } from "../src/data.ts";
import { Desk } from "../src/desk.ts";
import { FeedError, FeedPoller, feedConfigFromEnv } from "../src/feed.ts";

const catalog = loadCatalog();
const NOW = Date.parse("2026-09-19T08:00:00+07:00");

const delay = { id: "feed-1", type: "flight.delayed", occurred_at: "2026-09-19T07:00:00+07:00", flight: { id: "NA721-2026-09-20" }, delay_minutes: 150 };
const cancel = { id: "feed-2", type: "flight.cancelled", occurred_at: "2026-09-19T07:30:00+07:00", flight: { id: "NA721-2026-09-20" }, cause: "force_majeure" };

/** A feed that serves `events` two per page, with the index as cursor. */
function fakeFeed(events: unknown[], seen: { url: string; auth?: string }[] = []) {
  return async (url: string, init: { headers: Record<string, string> }) => {
    seen.push({ url, auth: init.headers.authorization });
    const cursor = Number(new URL(url).searchParams.get("cursor") ?? 0);
    const page = events.slice(cursor, cursor + 2);
    const body = { events: page, next_cursor: String(cursor + page.length) };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
}

function setup(events: unknown[], seen?: { url: string; auth?: string }[]) {
  const desk = new Desk(catalog, new DryRunGateway(0), { statePath: null, liveCallBudget: 0, now: () => NOW });
  const poller = new FeedPoller(desk, catalog, { url: "https://ops.example.test/events", token: "t0ken", intervalSeconds: 30 }, fakeFeed(events, seen), () => NOW);
  return { desk, poller };
}

test("the poller pages through the feed, records disruptions, and resumes from the saved cursor", async () => {
  const seen: { url: string; auth?: string }[] = [];
  const events: unknown[] = [delay, { ...delay, id: "feed-1b", flight: { id: "NA812-2026-09-20" } }, cancel];
  const { desk, poller } = setup(events, seen);
  await poller.poll();
  const snap = desk.snapshot();
  assert.equal(snap.flights.find((f) => f.id === "NA721-2026-09-20")?.disruption?.kind, "cancellation", "the later cancellation escalated the delay");
  assert.equal(snap.flights.find((f) => f.id === "NA812-2026-09-20")?.disruption?.source.kind, "airline_feed");
  assert.deepEqual(snap.opsEvents.map((e) => [e.eventId, e.via, e.status]).sort(), [
    ["feed-1", "feed", "created"],
    ["feed-1b", "feed", "created"],
    ["feed-2", "feed", "escalated"],
  ]);
  assert.equal(desk.feedCursor, "3");
  assert.equal(seen[0]?.auth, "Bearer t0ken");
  assert.equal(poller.status().lastError, null);

  // Nothing new: one request from the saved cursor, nothing recorded twice.
  seen.length = 0;
  await poller.poll();
  assert.equal(seen.length, 1);
  assert.match(seen[0]?.url ?? "", /cursor=3/);
  assert.equal(desk.snapshot().opsEvents.length, 3);
});

test("invalid events are listed without stopping the feed, and feed errors are reported", async () => {
  const { desk, poller } = setup([{ id: "bad", type: "flight.diverted" }, delay]);
  await poller.poll();
  assert.equal(poller.status().invalid[0]?.eventId, "bad");
  assert.equal(desk.snapshot().opsEvents.length, 1);

  const broken = new FeedPoller(desk, catalog, { url: "https://ops.example.test/events", token: null, intervalSeconds: 30 }, async () => ({
    ok: false,
    status: 503,
    text: async () => "",
  }));
  await broken.poll();
  assert.equal(broken.status().lastError, "Feed returned HTTP 503.");
  const notJson = new FeedPoller(desk, catalog, { url: "https://ops.example.test/events", token: null, intervalSeconds: 30 }, async () => ({
    ok: true,
    status: 200,
    text: async () => "<html>",
  }));
  await notJson.poll();
  assert.equal(notJson.status().lastError, "Feed page is not JSON.");
});

test("overlapping polls share one run", async () => {
  let calls = 0;
  const desk = new Desk(catalog, new DryRunGateway(0), { statePath: null, liveCallBudget: 0 });
  const poller = new FeedPoller(desk, catalog, { url: "https://ops.example.test/events", token: null, intervalSeconds: 30 }, async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return { ok: true, status: 200, text: async () => '{"events":[],"next_cursor":null}' };
  });
  await Promise.all([poller.poll(), poller.poll(), poller.poll()]);
  assert.equal(calls, 1);
});

test("feed configuration refuses bad URLs, clear-text tokens, and tight polling", () => {
  assert.equal(feedConfigFromEnv({}), null);
  assert.deepEqual(feedConfigFromEnv({ AIRLINE_FEED_URL: "https://ops.example.test/events", AIRLINE_FEED_TOKEN: "x" }), {
    url: "https://ops.example.test/events",
    token: "x",
    intervalSeconds: 30,
  });
  assert.equal(feedConfigFromEnv({ AIRLINE_FEED_URL: "http://127.0.0.1:4320/events", AIRLINE_FEED_TOKEN: "x" })?.token, "x", "loopback http is fine");
  assert.throws(() => feedConfigFromEnv({ AIRLINE_FEED_URL: "http://ops.example.test/events", AIRLINE_FEED_TOKEN: "x" }), /clear text/);
  assert.throws(() => feedConfigFromEnv({ AIRLINE_FEED_URL: "ftp://ops.example.test" }), FeedError);
  assert.throws(() => feedConfigFromEnv({ AIRLINE_FEED_URL: "not a url" }), /not a valid URL/);
  assert.throws(() => feedConfigFromEnv({ AIRLINE_FEED_URL: "https://ops.example.test", AIRLINE_FEED_POLL_SECONDS: "1" }), /at least 5/);
});
