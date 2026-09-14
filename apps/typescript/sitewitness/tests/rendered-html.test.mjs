import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://localhost${path}`, {
      headers: { accept: "text/html", authorization: "Basic " + Buffer.from("test-reviewer:test-password-not-a-real-secret").toString("base64") },
    }),
    {
      SITEWITNESS_BASIC_USER: "test-reviewer",
      SITEWITNESS_BASIC_PASSWORD: "test-password-not-a-real-secret",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}
test("server-renders the SiteWitness application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>SiteWitness/);
  assert.match(html, /Start with the source records/);
  assert.match(html, /The records leave one question open/);
  assert.match(html, /Sparkle Cleaners, 1987–1994/);
  assert.match(html, /I believe it was only a drop shop/);
  assert.match(html, /<iframe[^>]+baker-directory\.html#entry-47/);
  assert.match(html, /Next: people to call/);
  assert.match(
    html,
    /<button aria-current="step"><span>1<\/span><b>Source records<\/b>/,
  );
  assert.doesNotMatch(
    html,
    /People we need to call|Save contact &amp; permission|Reviewed interview years/,
  );
  assert.match(html, /47 Baker Street/i);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview/);
});
test("renders the required safety boundary", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /Synthetic property case/);
  assert.match(html, /Prepared, synthetic source documents/);
  assert.doesNotMatch(html, /Scripted rehearsal|Restart demo/);
  assert.doesNotMatch(html, /I personally did dry cleaning there in 1992/);
});

test("keeps the case-file alias on the same actual workspace", async () => {
  const response = await render("/case-file");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Start with the source records/);
  assert.match(html, /Demo history/);
  assert.match(html, /Start new demo/);
  assert.match(html, /aria-labelledby="reset-title"/);
});

test("implements server-side reviewer and conclusion guards", async () => {
  const route = await readFile(
    new URL("../app/api/workflow/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /PERMISSION_DENIED/);
  assert.match(route, /BLOCKING_WARNING_PRESENT/);
  assert.match(route, /PROFESSIONAL_CONCLUSION_PROHIBITED/);
  assert.match(route, /evidence_gap_dispositions/);
});

test("keeps a case assigned through individual statement reviews", async () => {
  const source = await readFile("app/api/workflow/route.ts", "utf8");
  const reviewBlock = source.slice(
    source.indexOf('if (body.action === "review")'),
    source.indexOf('if (body.action === "edit")'),
  );
  const dispositionBlock = source.slice(
    source.indexOf('if (body.action === "disposition")'),
    source.indexOf('return error(\n    "UNKNOWN_ACTION"'),
  );
  assert.doesNotMatch(reviewBlock, /FOLLOW_UP_REQUIRED/);
  assert.match(dispositionBlock, /FOLLOW_UP_REQUIRED/);
});

test("implements a durable scoped secure respondent form", async () => {
  const form = await readFile(
    "app/respond/[token]/respondent-form.tsx",
    "utf8",
  );
  const api = await readFile("app/api/respondent/route.ts", "utf8");
  assert.match(form, /Share what you personally know/);
  assert.match(form, /Basis of answer/);
  assert.match(form, /accurately reflects my knowledge/);
  assert.match(api, /secure_form_responses/);
  assert.match(api, /UPDATE follow_up_tasks SET status = 'SUBMITTED'/);
  assert.match(api, /ingested_statements/);
  assert.match(api, /AWAITING_EP_REVIEW/);
  assert.match(api, /statements_created: 2/);
});

test("implements a durable human-led interview workspace", async () => {
  const workspace = await readFile(
    "app/human-interview/[taskId]/workspace.tsx",
    "utf8",
  );
  const api = await readFile("app/api/human-interview/route.ts", "utf8");
  assert.match(workspace, /Conduct the bounded interview/);
  assert.match(workspace, /Declined or unanswered questions/);
  assert.match(api, /human_interview_records/);
  assert.match(api, /'human_interview'/);
  assert.match(api, /AWAITING_EP_REVIEW/);
  assert.match(api, /statements_created: 2/);
});

test("enforces non-calling request lifecycle and audit controls", async () => {
  const api = await readFile("app/api/workflow/route.ts", "utf8");
  const ui = await readFile("app/sitewitness-app.tsx", "utf8");
  for (const action of [
    "send_request",
    "record_attempt",
    "extend_due",
    "cancel_request",
    "reopen_request",
    "reassign_request",
  ])
    assert.match(api, new RegExp(action));
  assert.match(api, /DUPLICATE_ACTIVE_REQUEST/);
  assert.match(api, /audit_events/);
  assert.match(ui, /Export integration JSON/);
  assert.match(ui, /Case activity timeline/);
  assert.match(ui, /Real calling remains disabled|Live calls enabled/);
});

test("implements editable statements, dispositions, and exports", async () => {
  const review = await readFile(
    new URL("../app/advanced-review.tsx", import.meta.url),
    "utf8",
  );
  assert.match(review, /Save revision/);
  assert.match(review, /Save human disposition/);
  assert.match(review, /Export JSON/);
  assert.match(review, /Export Markdown/);
  assert.match(review, /Immutable evidence/);
});

test("implements a guarded server-only CALL-E integration", async () => {
  const route = await readFile("app/api/calle/route.ts", "utf8");
  const provider = await readFile("app/lib/call-provider.ts", "utf8");
  const ui = await readFile("app/sitewitness-app.tsx", "utf8");
  const workflow = await readFile("app/api/workflow/route.ts", "utf8");
  const liveBudgetMigration = await readFile(
    "drizzle/0009_single_live_call_budget.sql",
    "utf8",
  );
  assert.match(route, /LIVE_CALLS_DISABLED/);
  assert.match(route, /LIVE_CALL_LIMIT_REACHED/);
  assert.match(route, /LIVE_CALL_SUBMISSION_REJECTED/);
  assert.match(route, /live_call_budget_reserved_at = NULL/);
  assert.match(route, /live_call_budget_reserved_at/);
  assert.match(route, /live_call_slots_remaining/);
  assert.match(
    liveBudgetMigration,
    /CREATE UNIQUE INDEX `idx_call_runs_single_live_budget`/,
  );
  const expandedBudgetMigration = await readFile(
    "drizzle/0010_expand_live_call_budget.sql",
    "utf8",
  );
  assert.match(
    expandedBudgetMigration,
    /DROP INDEX IF EXISTS `idx_call_runs_single_live_budget`/,
  );
  assert.match(route, /const LIVE_CALL_LIMIT = 20/);
  assert.match(route, /Math\.max\(0, LIVE_CALL_LIMIT - used\)/);
  assert.match(
    route,
    /authorizationVersion = \(latest\?\.version \|\| authorizationVersion\) \+ 1/,
  );
  assert.match(ui, /setAuthorizationVersion\(data\.authorization_version\)/);
  assert.ok(
    route.indexOf("live_call_budget_reserved_at = ?") <
      route.indexOf("created = await provider().create"),
  );
  assert.match(route, /PLACE LIVE CALL/);
  assert.match(route, /automated_call_allowed/);
  assert.match(route, /transcription_allowed/);
  assert.match(provider, /idempotency-key/);
  assert.match(provider, /sitewitness:/);
  assert.match(ui, /Place one live call/);
  assert.match(ui, /Confirm this is intentional/);
  assert.match(ui, /PLACE LIVE CALL/);
  const main = await readFile("app/case-file-app.tsx", "utf8");
  assert.doesNotMatch(main, /GOAL BRANCH PROOF|MACHINE OBSERVED IN REAR ROOM/);
  assert.match(route, /CALLE_GOAL_RESULT_INGESTED/);
  assert.match(route, /INVALID_RESULT/);
  assert.match(route, /evidence_quote/);
  assert.match(
    provider,
    /\/v1\/goals\/\$\{encodeURIComponent\(input.goalId\)\}\/runs/,
  );
  assert.match(provider, /\/v1\/calls/);
  assert.match(workflow, /transcript_turns/);
});

test("does not present synthetic transcript evidence as a live CALL-E result", async () => {
  const app = await readFile(
    new URL("../app/sitewitness-app.tsx", import.meta.url),
    "utf8",
  );
  const review = await readFile(
    new URL("../app/advanced-review.tsx", import.meta.url),
    "utf8",
  );
  const workflow = await readFile(
    new URL("../app/api/workflow/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(app, /statement\.origin === "calle_goal"/);
  assert.match(app, /Synthetic fixture content is intentionally hidden/);
  assert.match(review, /CALL-E supporting quote/);
  assert.match(review, /No reviewable factual statements were returned/);
  assert.match(workflow, /LIVE_HISTORY_PRESERVED/);
  assert.match(app, /CALL-E Calls API/);
  assert.match(workflow, /REVIEW_INCOMPLETE/);
});
