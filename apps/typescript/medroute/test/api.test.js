import assert from "node:assert/strict";
import test from "node:test";

// ---------------------------------------------------------------------------
// Mock browser globals
// ---------------------------------------------------------------------------

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

globalThis.localStorage = createMemoryStorage();
globalThis.sessionStorage = createMemoryStorage();
globalThis.document = {
  querySelector: () => ({
    hidden: false, disabled: false, checked: false, value: "",
    textContent: "", innerHTML: "", classList: { add() {}, remove() {}, toggle() {} },
    dataset: {}, focus() {}, play() { return Promise.resolve(); }, pause() {},
    scrollIntoView() {}, querySelector() { return {}; }, addEventListener() {},
    onclick: null, onchange: null,
  }),
  querySelectorAll: () => [],
  createElement: () => ({ href: "", download: "", click() {} }),
  body: { classList: { add() {}, remove() {} } },
};
globalThis.window = { scrollTo() {} };
globalThis.URL = { createObjectURL: () => "blob:mock", revokeObjectURL() {} };

// Mock crypto.randomUUID (crypto is read-only in Node.js v24)
let uuidCounter = 0;
Object.defineProperty(globalThis, "crypto", {
  value: {
    randomUUID: () => {
      uuidCounter++;
      // Generate a UUID-like string: 8-4-4-4-12 hex chars
      return "00000001-0001-4001-8001-000000000000".replace(/0+/g, (m) =>
        String(uuidCounter).padStart(m.length, "0")
      );
    },
  },
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Mock fetch — each test sets mockFetch to control responses
// ---------------------------------------------------------------------------

let mockFetch = null;
globalThis.fetch = (...args) => mockFetch(...args);

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

const { apiCheck, apiFetchRuntimeCapabilities, apiFetchHistory, apiFetchAnalytics, apiResetDemoHistory, apiDownloadTranscript } =
  await import("../public/js/api.js");

// ---------------------------------------------------------------------------
// apiCheck
// ---------------------------------------------------------------------------

test("apiCheck sends POST with correct headers and body", async () => {
  let capturedUrl, capturedOptions;
  mockFetch = (url, opts) => {
    capturedUrl = url;
    capturedOptions = opts;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: "run_1", results: [] }),
    });
  };

  const body = {
    medicine: "Amoxicillin",
    strength: "500mg",
    pharmacies: [{ name: "Rx", phone: "+12025550001", distanceKm: "2" }],
    confirmLive: false,
    consentAcknowledged: true,
    liveCallAcknowledged: false,
  };

  const result = await apiCheck("test-token", body);
  assert.equal(capturedUrl, "/api/check");
  assert.equal(capturedOptions.method, "POST");
  assert.equal(capturedOptions.headers["Content-Type"], "application/json");
  assert.equal(capturedOptions.headers["Authorization"], "Bearer test-token");
  assert.ok(!capturedOptions.headers["Idempotency-Key"]);
  assert.equal(result.id, "run_1");
});

test("apiCheck includes Idempotency-Key for live requests", async () => {
  let capturedOptions;
  mockFetch = (url, opts) => {
    capturedOptions = opts;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: "run_2", results: [] }),
    });
  };

  const body = {
    medicine: "Ibuprofen",
    strength: "",
    pharmacies: [{ name: "Rx", phone: "+12025550002", distanceKm: "1" }],
    confirmLive: true,
    consentAcknowledged: true,
    liveCallAcknowledged: true,
  };

  await apiCheck("token", body);
  assert.ok(capturedOptions.headers["Idempotency-Key"]);
  assert.ok(capturedOptions.headers["Idempotency-Key"].length >= 16);
});

test("live progress closes independently of the pending result request and polling stops afterwards", { timeout: 4000 }, async () => {
  let finishRequest, reportProgress, postCount = 0, pollCount = 0, postKey;
  const observed = new Promise(resolve => { reportProgress = resolve; });
  mockFetch = (url, options) => {
    if (url === "/api/check") {
      postCount++;
      postKey = options.headers["Idempotency-Key"];
      return new Promise(resolve => { finishRequest = resolve; });
    }
    assert.equal(url, "/api/check-progress");
    assert.equal(options.headers["Idempotency-Key"], postKey);
    pollCount++;
    return Promise.resolve({ ok: true, json: async () => ({ phases: ["finalizing"] }) });
  };
  const pending = apiCheck("token", { confirmLive: true }, reportProgress);
  assert.deepEqual(await observed, { phases: ["finalizing"] });
  assert.equal(postCount, 1);
  finishRequest({ ok: true, json: async () => ({ id: "finished", results: [] }) });
  await pending;
  const pollsAtCompletion = pollCount;
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.equal(pollCount, pollsAtCompletion);
  assert.equal(postCount, 1);
});

test("apiCheck reuses idempotency key for same live request fingerprint", async () => {
  sessionStorage.clear();
  let callCount = 0;
  mockFetch = () => {
    callCount++;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: `run_${callCount}`, results: [] }),
    });
  };

  const body = {
    medicine: "Paracetamol",
    strength: "500mg",
    pharmacies: [{ name: "Rx", phone: "+12025550003", distanceKm: "1" }],
    confirmLive: true,
    consentAcknowledged: true,
    liveCallAcknowledged: true,
  };

  await apiCheck("token", body);
  const firstKey = JSON.parse(sessionStorage.getItem("medroute-pending-live-request") || "{}").idempotencyKey;

  await apiCheck("token", body);
  const secondKey = JSON.parse(sessionStorage.getItem("medroute-pending-live-request") || "{}").idempotencyKey;

  assert.equal(firstKey, secondKey);
});

test("apiCheck throws on 401 with helpful message", async () => {
  mockFetch = () => Promise.resolve({
    ok: false,
    status: 401,
    json: () => Promise.resolve({ error: "Unauthorized" }),
  });

  await assert.rejects(
    () => apiCheck("bad-token", { confirmLive: false }),
    (err) => {
      assert.match(err.message, /operator access token/i);
      return true;
    }
  );
});

test("apiFetchRuntimeCapabilities reports safe demo mode", async () => {
  mockFetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ safeDemoMode: true, liveCallsAvailable: false, requiresOperatorToken: false }),
  });
  assert.deepEqual(await apiFetchRuntimeCapabilities(), { safeDemoMode: true, liveCallsAvailable: false, requiresOperatorToken: false });
});

test("apiFetchRuntimeCapabilities returns null when the health check fails", async () => {
  mockFetch = () => Promise.resolve({ ok: false });
  assert.equal(await apiFetchRuntimeCapabilities(), null);
});

test("apiCheck throws server error message on failure", async () => {
  mockFetch = () => Promise.resolve({
    ok: false,
    status: 400,
    json: () => Promise.resolve({ error: "Medicine is required." }),
  });

  await assert.rejects(
    () => apiCheck("token", { confirmLive: false }),
    (err) => {
      assert.equal(err.message, "Medicine is required.");
      return true;
    }
  );
});

test("apiCheck clears pending live request on success", async () => {
  sessionStorage.setItem("medroute-pending-live-request", JSON.stringify({ fingerprint: "x", idempotencyKey: "y" }));
  mockFetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ id: "run_done", results: [] }),
  });

  await apiCheck("token", {
    medicine: "Test", strength: "", pharmacies: [],
    confirmLive: true, consentAcknowledged: true, liveCallAcknowledged: true,
  });

  assert.equal(sessionStorage.getItem("medroute-pending-live-request"), null);
});

// ---------------------------------------------------------------------------
// apiFetchHistory
// ---------------------------------------------------------------------------

test("apiFetchHistory returns history array on success", async () => {
  const mockHistory = [{ id: "run_1", medicine: "Aspirin", results: [] }];
  mockFetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ history: mockHistory }),
  });

  const result = await apiFetchHistory("token");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "run_1");
});

test("apiFetchHistory returns empty array on failure", async () => {
  mockFetch = () => Promise.resolve({ ok: false, status: 500 });
  const result = await apiFetchHistory("token");
  assert.deepEqual(result, []);
});

test("apiFetchHistory returns empty array when history field is missing", async () => {
  mockFetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  });
  const result = await apiFetchHistory("token");
  assert.deepEqual(result, []);
});

// ---------------------------------------------------------------------------
// apiFetchAnalytics
// ---------------------------------------------------------------------------

test("apiFetchAnalytics returns data on success", async () => {
  const mockData = { totalRuns: 5, totalCalls: 10, liveRuns: 2, inStockRate: 60, topMedicines: [], recent: [] };
  mockFetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(mockData),
  });

  const result = await apiFetchAnalytics("token");
  assert.equal(result.totalRuns, 5);
  assert.equal(result.inStockRate, 60);
});

test("apiFetchAnalytics returns null on failure", async () => {
  mockFetch = () => Promise.resolve({ ok: false, status: 500 });
  const result = await apiFetchAnalytics("token");
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// apiResetDemoHistory
// ---------------------------------------------------------------------------

test("apiResetDemoHistory posts an authenticated reset request", async () => {
  let capturedUrl, capturedOptions;
  mockFetch = (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ deleted: 3 }) });
  };

  const result = await apiResetDemoHistory("test-token");
  assert.equal(capturedUrl, "/api/demo/reset");
  assert.equal(capturedOptions.method, "POST");
  assert.equal(capturedOptions.headers.Authorization, "Bearer test-token");
  assert.equal(result.deleted, 3);
});

test("apiResetDemoHistory surfaces reset failures", async () => {
  mockFetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "Demo reset unavailable." }) });
  await assert.rejects(() => apiResetDemoHistory("token"), /Demo reset unavailable/);
});

// ---------------------------------------------------------------------------
// apiDownloadTranscript
// ---------------------------------------------------------------------------

test("apiDownloadTranscript fetches PDF and triggers download", async () => {
  let fetchedUrl;
  const fakeBlob = { size: 100 };
  mockFetch = (url) => {
    fetchedUrl = url;
    return Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(fakeBlob),
    });
  };

  const fakeLink = { href: "", download: "", click() { this._clicked = true; } };
  globalThis.document.createElement = () => fakeLink;

  await apiDownloadTranscript("token", "/api/transcripts/run_1/0.pdf");
  assert.equal(fetchedUrl, "/api/transcripts/run_1/0.pdf");
  assert.equal(fakeLink.download, "medroute-call-transcript.pdf");
  assert.ok(fakeLink._clicked);
});

test("apiDownloadTranscript throws on failure", async () => {
  mockFetch = () => Promise.resolve({
    ok: false,
    json: () => Promise.resolve({ error: "No transcript available." }),
  });

  await assert.rejects(
    () => apiDownloadTranscript("token", "/api/transcripts/missing/0.pdf"),
    (err) => {
      assert.equal(err.message, "No transcript available.");
      return true;
    }
  );
});

test("apiDownloadTranscript uses generic message when server returns no JSON", async () => {
  mockFetch = () => Promise.resolve({
    ok: false,
    json: () => Promise.reject(new Error("not json")),
  });

  await assert.rejects(
    () => apiDownloadTranscript("token", "/api/transcripts/missing/0.pdf"),
    (err) => {
      assert.equal(err.message, "Could not download transcript.");
      return true;
    }
  );
});
