import assert from "node:assert/strict";
import test from "node:test";

import { EngineOriginError, resolveEngineUrl } from "../lib/engine-origin";

test("engine origin permits loopback development URLs", () => {
  assert.equal(resolveEngineUrl("http://localhost:8008"), "http://localhost:8008");
  assert.equal(resolveEngineUrl("http://127.0.0.1:8008"), "http://127.0.0.1:8008");
  assert.equal(resolveEngineUrl("http://[::1]:8008"), "http://[::1]:8008");
});

test("remote engine must be an explicitly approved HTTPS origin", () => {
  assert.equal(
    resolveEngineUrl(
      "https://engine.example.com",
      "https://other.example.com, https://engine.example.com",
    ),
    "https://engine.example.com",
  );
  assert.throws(
    () => resolveEngineUrl("https://engine.example.com", undefined),
    EngineOriginError,
  );
  assert.throws(
    () => resolveEngineUrl("http://engine.example.com", "https://engine.example.com"),
    EngineOriginError,
  );
});

test("engine origins reject paths, embedded credentials, and unsafe allowlist entries", () => {
  assert.throws(
    () => resolveEngineUrl("https://engine.example.com/api", "https://engine.example.com"),
    EngineOriginError,
  );
  assert.throws(
    () => resolveEngineUrl("https://user:secret@engine.example.com"),
    EngineOriginError,
  );
  assert.throws(
    () => resolveEngineUrl("https://engine.example.com", "http://engine.example.com"),
    EngineOriginError,
  );
});
