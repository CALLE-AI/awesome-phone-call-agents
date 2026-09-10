import assert from "node:assert/strict";
import test from "node:test";

import { requestWebSearch } from "../lib/tools/search-web-client";
import {
  createWebSearchResult,
  describeWebSearchProviderError,
  extractWebSearchSources,
  parseSearchRequest,
} from "../lib/tools/search-web";

const correlationId = "11111111-1111-4111-8111-111111111111";

test("provider diagnostics expose only bounded codes", () => {
  assert.equal(describeWebSearchProviderError({ status: 429, message: "secret detail" }), "provider_http_429");
  assert.equal(describeWebSearchProviderError({ code: "search_timeout", message: "secret detail" }), "search_timeout");
  assert.equal(describeWebSearchProviderError({ name: "TimeoutError", message: "secret detail" }), "provider_timeouterror");
  assert.equal(describeWebSearchProviderError({ code: "unsafe value with spaces" }), "provider_object");
});

test("search requests require a bounded query and UUID v4 correlation ID", () => {
  assert.deepEqual(parseSearchRequest({ correlationId, query: "  current Sydney time  " }), {
    correlationId,
    query: "current Sydney time",
  });
  assert.throws(() => parseSearchRequest({ correlationId: "request-1", query: "current Sydney time" }));
  assert.throws(() => parseSearchRequest({ correlationId, query: "x" }));
  assert.throws(() => parseSearchRequest({ correlationId, query: "x".repeat(801) }));
});

test("search results bound text and retain at most five safe source URLs", () => {
  const sources = extractWebSearchSources({
    output: [
      { title: "One", url: "https://example.com/one" },
      { title: "Unsafe", url: "javascript:alert(1)" },
      ...Array.from({ length: 6 }, (_, index) => ({
        title: `Source ${index + 2}`,
        url: `https://example.com/${index + 2}`,
      })),
      {
        content: [{
          annotations: [{
            type: "url_citation",
            title: "Cited answer source",
            url: "https://example.com/cited",
          }],
        }],
      },
    ],
  });
  const result = createWebSearchResult({
    answer: ` Answer ${"a".repeat(4_100)} `,
    correlationId,
    query: "example",
    retrievedAt: "2026-09-10T00:00:00.000Z",
    sources,
  });

  assert.ok(result.answer.length <= 4_000);
  assert.match(result.answer, /…$/u);
  assert.equal(result.sources.length, 5);
  assert.equal(result.sources[0]?.url, "https://example.com/cited");
  assert.ok(result.sources.every((source) => source.url.startsWith("https://")));
  assert.throws(() => createWebSearchResult({
    answer: "   ",
    correlationId,
    query: "empty search",
    sources: [],
  }), /no answer/);
});

test("browser tool sends and correlates a fake provider result", async () => {
  let requestBody: unknown;
  const fakeFetch: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/tools/search-web");
    assert.equal(init?.method, "POST");
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      answer: "Sydney is currently observing Australian Eastern Standard Time.",
      correlationId,
      query: "current Sydney time zone",
      retrievedAt: "2026-09-10T00:00:00.000Z",
      sources: [{ title: "Example", url: "https://example.com/time" }],
      status: "completed",
    });
  };

  const result = await requestWebSearch("current Sydney time zone", correlationId, fakeFetch);
  assert.deepEqual(requestBody, { query: "current Sydney time zone", correlationId });
  assert.equal(result.correlationId, correlationId);
  assert.equal(result.sources.length, 1);
});

test("browser tool rejects an uncorrelated fake provider result", async () => {
  const fakeFetch: typeof fetch = async () => Response.json({
    answer: "Unexpected result",
    correlationId: "22222222-2222-4222-8222-222222222222",
    query: "current Sydney time zone",
    retrievedAt: "2026-09-10T00:00:00.000Z",
    sources: [],
    status: "completed",
  });

  await assert.rejects(
    requestWebSearch("current Sydney time zone", correlationId, fakeFetch),
    /correlation mismatch/,
  );
});
