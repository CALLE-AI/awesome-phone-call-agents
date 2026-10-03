import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeMode, readSecret } from "../lib/config/runtime";
import { PreviewOutboundCallAdapter } from "../lib/calle/preview";
import { PreviewSmsAdapter } from "../lib/tools/preview-sms";

test("runtime defaults to preview and rejects unknown modes", () => {
  assert.equal(parseRuntimeMode({}), "preview");
  assert.equal(parseRuntimeMode({ SENIOR_PHONE_AI_MODE: "preview" }), "preview");
  assert.throws(() => parseRuntimeMode({ SENIOR_PHONE_AI_MODE: "enabled" }));
});

test("server secrets reject empty and placeholder-length values", () => {
  assert.throws(() => readSecret("OPENAI_API_KEY", {}));
  assert.throws(() => readSecret("OPENAI_API_KEY", { OPENAI_API_KEY: "replace-me" }));
  assert.equal(
    readSecret("OPENAI_API_KEY", { OPENAI_API_KEY: "server-secret-over-sixteen" }),
    "server-secret-over-sixteen",
  );
});

test("preview adapters report previews without provider identifiers", async () => {
  const sms = await new PreviewSmsAdapter().send({
    destinationE164: "+12025550123",
    idempotencyKey: "preview-sms-1",
    message: "Synthetic preview",
  });
  const call = await new PreviewOutboundCallAdapter().plan({
    destinationE164: "+12025550123",
    purpose: "Synthetic preview",
    idempotencyKey: "preview-intent",
  });

  assert.deepEqual(sms, { status: "previewed" });
  assert.deepEqual(call, { status: "previewed", idempotencyKey: "preview-intent" });
});
