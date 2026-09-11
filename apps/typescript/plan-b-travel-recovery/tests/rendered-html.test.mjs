import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the finished PLAN B experience", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /PLAN B/);
  assert.match(page, /Flight disruption detected/i);
  assert.match(page, /The trip failed/);
  assert.match(page, /START SAFE DEMO/);
  assert.match(page, /CALL-E EXTRACTED CONSTRAINTS/);
  assert.match(page, /Ready to evaluate providers/);
  assert.doesNotMatch(page, /Your site is taking shape|Building your site/i);
});

test("keeps Live Mode protected and Safe Demo truthful", async () => {
  const [page, route, layout, envExample, gitignore] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/recovery/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);

  assert.match(page, /liveAvailable && <button/);
  assert.match(page, /Hotel negotiation was not attempted in Live Mode/);
  assert.match(page, /Structured result returned directly by CALL-E/);
  assert.match(page, /WHY THIS PLAN/);
  assert.match(route, /LIVE_DEMO_ACCESS_CODE/);
  assert.match(route, /isCompletedRecoveryOption\(result, 400, 9 \* 60\)/);
  assert.match(route, /resolveRecipientConfiguration/);
  assert.match(envExample, /ENABLE_LIVE_CALLS=false/);
  assert.match(gitignore, /\.env\*/);
  assert.match(layout, /PLAN B/);
  assert.doesNotMatch(`${page}\n${route}\n${layout}`, /CALLE_API_KEY\s*=\s*["'][^"']+["']/);
});
