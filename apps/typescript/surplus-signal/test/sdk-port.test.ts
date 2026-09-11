import assert from "node:assert/strict";
import { test } from "node:test";
import { createSdkPort } from "../src/calle.js";
import { buildCallInput } from "../src/plan.js";
import { parseDriveRequest } from "../src/request.js";

test("official SDK sends the documented contract to an in-memory fake", async () => {
  let createBody: Record<string, unknown> | undefined;
  let authorization: string | null = null;
  let idempotencyKey: string | null = null;
  let requests = 0;
  const responseBody = (status: "queued" | "completed") => ({
    id: "call_sdk_contract",
    object: "call_task",
    status,
    task: typeof createBody?.task === "string" ? createBody.task : "Surplus confirmation",
    recipients: [{
      id: "recipient_sdk_contract",
      phones: ["+12025550142"],
      locale: "en-US",
      region: "US",
      status: status === "completed" ? "completed" : "pending",
      structured_result: status === "completed" ? {
        recipient_agreed_to_continue: true,
        recipient_status: "reached",
        pledge_status: "confirmed",
        confirmed_units: 24,
        pickup_slot_id: "slot-early",
        storage_mode: "ambient",
        packaging_state: "sealed",
        human_follow_up_required: false,
      } : null,
      summary: null,
      attempts: [],
    }],
    structured_result: status === "completed" ? { recipients_attempted: 1 } : null,
    summary: null,
    task_completed: status === "completed" ? true : null,
    completion_confidence: null,
    evidence: [],
    metadata: { workflow: "surplus-signal", drive_id: "drive-a1b2c3d4e5f6", donor_id: "harbor-bakery" },
    failure_code: null,
    failure_message: null,
    created_at: "2026-08-01T00:00:00Z",
    completed_at: status === "completed" ? "2026-08-01T00:00:05Z" : null,
  });
  const fakeFetch = async (request: Request): Promise<Response> => {
    requests += 1;
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/calls") {
      createBody = await request.json() as Record<string, unknown>;
      authorization = request.headers.get("authorization");
      idempotencyKey = request.headers.get("idempotency-key");
      return Response.json(responseBody("queued"), { status: 201 });
    }
    if (request.method === "GET" && url.pathname === "/v1/calls/call_sdk_contract") return Response.json(responseBody("completed"));
    return Response.json({ error: { code: "not_found", message: "Unexpected test route.", details: {} } }, { status: 404 });
  };
  const request = parseDriveRequest({
    drive_id: "drive-a1b2c3d4e5f6",
    operator_has_authorized_calls: true,
    operator_authorized_at: "2026-08-01T10:00:00Z",
    authorization_valid_until: "2026-08-01T13:00:00Z",
    donors: [{ id: "harbor-bakery", display_name: "Harbor Bakery", phone: "+12025550142", region: "US", locale: "en-US", pledge_ref: "PLEDGE-104", food_category: "baked goods", expected_units: 24, unit_name: "trays", expected_storage_mode: "ambient", automated_call_opt_in_confirmed: true, opt_in_recorded_at: "2026-07-30T09:00:00Z", opt_in_valid_until: "2026-08-01T13:00:00Z" }],
    pickup_slots: [{ id: "slot-early", starts_at: "2026-08-01T14:00:00Z", ends_at: "2026-08-01T15:00:00Z" }],
    policy: { max_calls: 1, do_not_leave_voicemail: true, require_ai_disclosure: true, require_human_dispatch_review: true, call_window_start: "2026-08-01T12:00:00Z", call_window_end: "2026-08-01T13:00:00Z" },
  });
  const port = await createSdkPort({ apiKey: "local-test-key", fetch: fakeFetch });
  const created = await port.create(buildCallInput(request, request.donors[0]!), "surplus-sdk-contract");
  const call = await port.waitForResult(created.id ?? "");
  assert.equal(requests, 2);
  assert.equal(authorization, "Bearer local-test-key");
  assert.equal(idempotencyKey, "surplus-sdk-contract");
  assert.ok(createBody?.recipient_result_schema);
  assert.deepEqual(createBody?.metadata, { workflow: "surplus-signal", drive_id: "drive-a1b2c3d4e5f6", donor_id: "harbor-bakery" });
  assert.equal(call.taskCompleted, true);
  assert.equal(call.recipients?.[0]?.structuredResult?.pledge_status, "confirmed");
});
