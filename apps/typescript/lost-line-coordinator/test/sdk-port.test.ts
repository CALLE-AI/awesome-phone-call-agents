import assert from "node:assert/strict";
import { test } from "node:test";
import { createSdkPort } from "../src/calle.js";
import { buildCallInput } from "../src/plan.js";
import { parseSearchRequest } from "../src/request.js";

test("the official SDK sends the documented wire contract to an in-memory fake", async () => {
  let createBody: Record<string, unknown> | undefined;
  let authorization: string | null = null;
  let idempotencyKey: string | null = null;
  let requestCount = 0;

  const responseBody = (status: "queued" | "completed") => ({
    id: "call_sdk_contract",
    object: "call_task",
    status,
    task: typeof createBody?.task === "string" ? createBody.task : "Lost-property inquiry",
    recipients: [{
      id: "recipient_sdk_contract",
      phones: ["+12025550142"],
      locale: "en-US",
      region: "US",
      status: status === "completed" ? "completed" : "pending",
      structured_result: status === "completed" ? {
        recipient_agreed_to_continue: true,
        desk_status: "reached",
        item_logged: "yes",
        matched_feature_ids: ["F1"],
        contradicted_feature_ids: [],
        reference_code: "LF-42",
        retrieval_mode: "official-channel",
        human_follow_up_required: true,
      } : null,
      summary: status === "completed" ? "Possible match." : null,
      attempts: [],
    }],
    structured_result: status === "completed" ? { locations_contacted: 1 } : null,
    summary: status === "completed" ? "Search finished." : null,
    task_completed: status === "completed" ? true : null,
    completion_confidence: status === "completed" ? { score: 0.8, label: "high" } : null,
    evidence: [],
    metadata: { workflow: "lost-line-coordinator", search_id: "sdk-contract" },
    failure_code: null,
    failure_message: null,
    created_at: "2026-08-01T00:00:00Z",
    completed_at: status === "completed" ? "2026-08-01T00:00:05Z" : null,
  });

  const fakeFetch = async (request: Request): Promise<Response> => {
    requestCount += 1;
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/calls") {
      createBody = await request.json() as Record<string, unknown>;
      authorization = request.headers.get("authorization");
      idempotencyKey = request.headers.get("idempotency-key");
      return Response.json(responseBody("queued"), { status: 201 });
    }
    if (request.method === "GET" && url.pathname === "/v1/calls/call_sdk_contract") {
      return Response.json(responseBody("completed"));
    }
    return Response.json({ error: { code: "not_found", message: "Unexpected test route.", details: {} } }, { status: 404 });
  };

  const request = parseSearchRequest({
    search_id: "search-a1b2c3d4e5f6",
    owner_has_authorized_search: true,
    owner_authorized_at: "2026-08-01T11:45:00Z",
    authorization_valid_until: "2026-08-01T13:00:00Z",
    claim_verification_detail_withheld: true,
    item: {
      category: "backpack",
      color: "blue",
      distinctive_features: ["orange zipper", "silver bicycle patch"],
      lost_after: "2026-08-01T08:00:00Z",
      lost_before: "2026-08-01T09:00:00Z",
    },
    locations: [{
      id: "station-desk",
      display_name: "Station Desk",
      phone: "+12025550142",
      published_source: "https://example.com/contact",
      published_contact_confirmed: true,
      published_contact_verified_at: "2026-08-01T11:30:00Z",
      calling_hours_confirmed: true,
      region: "US",
      locale: "en-US",
    }],
    policy: {
      max_calls: 1,
      do_not_leave_voicemail: true,
      stop_after_strong_match: true,
      call_window_start: "2026-08-01T12:00:00Z",
      call_window_end: "2026-08-01T12:30:00Z",
    },
  });
  const port = await createSdkPort({ apiKey: "local-test-key", fetch: fakeFetch });
  const created = await port.create(buildCallInput(request), "lostline-sdk-contract");
  const call = await port.waitForResult(created.id ?? "");

  assert.equal(requestCount, 2);
  assert.equal(authorization, "Bearer local-test-key");
  assert.equal(idempotencyKey, "lostline-sdk-contract");
  assert.ok(createBody?.recipient_result_schema);
  assert.deepEqual(createBody?.metadata, { workflow: "lost-line-coordinator", search_id: "search-a1b2c3d4e5f6", location_id: "station-desk" });
  assert.equal(call.id, "call_sdk_contract");
  assert.equal(call.taskCompleted, true);
  assert.equal(call.recipients?.[0]?.structuredResult?.desk_status, "reached");
  assert.equal(call.recipients?.[0]?.structuredResult?.recipient_agreed_to_continue, true);
});
