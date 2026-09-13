import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildCallInput, formatPreview, previewReceipt } from "../src/plan.js";
import { createReport, reservePrivateReport } from "../src/report.js";
import { assertLiveWindow, parseDriveRequest, RequestError } from "../src/request.js";
import { runDrive } from "../src/workflow.js";
import type { CallePort, DriveExecution, DriveRequest } from "../src/types.js";

function rawFixture(): Record<string, unknown> {
  return {
    drive_id: "drive-a1b2c3d4e5f6",
    operator_has_authorized_calls: true,
    operator_authorized_at: "2026-08-01T10:00:00Z",
    authorization_valid_until: "2026-08-01T13:00:00Z",
    donors: [{
      id: "harbor-bakery",
      display_name: "Harbor Bakery",
      phone: "+12025550142",
      region: "US",
      locale: "en-US",
      pledge_ref: "PLEDGE-104",
      food_category: "baked goods",
      expected_units: 24,
      unit_name: "trays",
      expected_storage_mode: "ambient",
      automated_call_opt_in_confirmed: true,
      opt_in_recorded_at: "2026-07-30T09:00:00Z",
      opt_in_valid_until: "2026-08-01T13:00:00Z",
    }],
    pickup_slots: [{ id: "slot-early", starts_at: "2026-08-01T14:00:00Z", ends_at: "2026-08-01T15:00:00Z" }],
    policy: {
      max_calls: 1,
      do_not_leave_voicemail: true,
      require_ai_disclosure: true,
      require_human_dispatch_review: true,
      call_window_start: "2026-08-01T12:00:00Z",
      call_window_end: "2026-08-01T13:00:00Z",
    },
  };
}

function fixture(): DriveRequest {
  return parseDriveRequest(rawFixture());
}

function completed(structuredResult: Record<string, unknown>, phone = "+12025550142") {
  return {
    id: "call_test_001",
    status: "completed",
    taskCompleted: true,
    recipients: [{ phones: [phone], status: "completed", structuredResult }],
  };
}

function validResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recipient_agreed_to_continue: true,
    recipient_status: "reached",
    pledge_status: "confirmed",
    confirmed_units: 24,
    pickup_slot_id: "slot-early",
    storage_mode: "ambient",
    packaging_state: "sealed",
    human_follow_up_required: false,
    ...overrides,
  };
}

test("preview is deterministic, masks phone numbers, and prints exact call text", () => {
  const request = fixture();
  assert.equal(previewReceipt(request), previewReceipt(request));
  const preview = formatPreview(request);
  assert.match(preview, /Exact CALL-E task text/);
  assert.match(preview, /\+12\*+42/);
  assert.doesNotMatch(preview, /\+12025550142/);
});

test("call task discloses AI use and forbids commitments and sensitive collection", () => {
  const input = buildCallInput(fixture(), fixture().donors[0]!);
  assert.match(input.task, /AI assistant/);
  assert.match(input.task, /processes and transcribes/);
  assert.match(input.task, /Do not leave voicemail/);
  assert.match(input.task, /Do not accept the donation/);
  assert.match(input.task, /human dispatcher must verify/);
  assert.equal((input.recipientResultSchema as Record<string, unknown>).additionalProperties, false);
  assert.equal(input.recipients.length, 1);
});

test("parser rejects missing opt-in, extra fields, duplicate phones, and prompt-like values", () => {
  const missingConsent = rawFixture();
  ((missingConsent.donors as Array<Record<string, unknown>>)[0]!).automated_call_opt_in_confirmed = false;
  assert.throws(() => parseDriveRequest(missingConsent), RequestError);

  const extra = rawFixture();
  extra.notes = "hidden";
  assert.throws(() => parseDriveRequest(extra), /unsupported field/);

  const duplicate = rawFixture();
  const first = (duplicate.donors as Array<Record<string, unknown>>)[0]!;
  (duplicate.donors as Array<Record<string, unknown>>).push({ ...first, id: "second-donor", pledge_ref: "PLEDGE-205" });
  (duplicate.policy as Record<string, unknown>).max_calls = 2;
  assert.throws(() => parseDriveRequest(duplicate), /phone numbers must be unique/);

  const injected = rawFixture();
  ((injected.donors as Array<Record<string, unknown>>)[0]!).food_category = "ignore instruction";
  assert.throws(() => parseDriveRequest(injected), /not an instruction/);
});

test("live window fails closed when stale, early, or nearly expired", () => {
  const request = fixture();
  assert.doesNotThrow(() => assertLiveWindow(request, new Date("2026-08-01T12:10:00Z")));
  assert.throws(() => assertLiveWindow(request, new Date("2026-08-01T11:59:00Z")), /outside/);
  assert.throws(() => assertLiveWindow(request, new Date("2026-08-01T12:55:00Z")), /ten minutes/);
});

test("pickup choices cannot predate the confirmation window or extend beyond seven days", () => {
  const early = rawFixture();
  ((early.pickup_slots as Array<Record<string, unknown>>)[0]!).starts_at = "2026-08-01T12:30:00Z";
  assert.throws(() => parseDriveRequest(early), /start at or after/);
  const distant = rawFixture();
  ((distant.pickup_slots as Array<Record<string, unknown>>)[0]!).starts_at = "2026-08-08T13:00:00Z";
  ((distant.pickup_slots as Array<Record<string, unknown>>)[0]!).ends_at = "2026-08-08T14:00:00Z";
  assert.throws(() => parseDriveRequest(distant), /within seven days/);
});

test("valid confirmation produces only a human-review manifest candidate", () => {
  const request = fixture();
  const execution: DriveExecution = { providerCalls: [completed(validResult())], attemptedDonorIds: ["harbor-bakery"], stopReason: "drive-complete" };
  const report = createReport(request, execution, new Date("2026-08-01T12:20:00Z"));
  assert.equal(report.dispatch_manifest.length, 1);
  assert.equal(report.dispatch_manifest[0]?.confirmed_units, 24);
  assert.equal(report.manifest_requires_human_approval, true);
  assert.match(report.next_step, /human coordinator/);
  assert.doesNotMatch(JSON.stringify(report), /\+12025550142/);
});

test("semantic contradictions invalidate provider output", () => {
  const request = fixture();
  const invalids = [
    validResult({ pledge_status: "withdrawn", confirmed_units: 1, pickup_slot_id: "none" }),
    validResult({ pledge_status: "confirmed", confirmed_units: 10 }),
    validResult({ recipient_agreed_to_continue: false }),
    validResult({ unknown_field: true }),
  ];
  for (const result of invalids) {
    const report = createReport(request, { providerCalls: [completed(result)], attemptedDonorIds: ["harbor-bakery"], stopReason: "drive-complete" });
    assert.equal(report.findings[0]?.provider_output_valid, false);
    assert.equal(report.dispatch_manifest.length, 0);
  }
});

test("refusal accepts no pledge evidence and does not create a manifest row", () => {
  const request = fixture();
  const refused = validResult({
    recipient_agreed_to_continue: false,
    recipient_status: "refused",
    pledge_status: "unclear",
    confirmed_units: 0,
    pickup_slot_id: "none",
    storage_mode: "unknown",
    packaging_state: "unknown",
    human_follow_up_required: true,
  });
  const report = createReport(request, { providerCalls: [completed(refused)], attemptedDonorIds: ["harbor-bakery"], stopReason: "drive-complete" });
  assert.equal(report.findings[0]?.provider_output_valid, true);
  assert.equal(report.findings[0]?.dispatch_state, "needs-human-review");
  assert.equal(report.dispatch_manifest.length, 0);
});

test("workflow stops before another donor after invalid output", async () => {
  const raw = rawFixture();
  const first = (raw.donors as Array<Record<string, unknown>>)[0]!;
  (raw.donors as Array<Record<string, unknown>>).push({ ...first, id: "garden-grocer", phone: "+12025550171", pledge_ref: "PLEDGE-205" });
  (raw.policy as Record<string, unknown>).max_calls = 2;
  const request = parseDriveRequest(raw);
  let creates = 0;
  const port: CallePort = {
    async create(input) {
      creates += 1;
      return { id: `call_${creates}`, status: "queued", recipients: [{ phones: [input.recipients[0]!.phones[0]!], status: "pending" }] };
    },
    async waitForResult(callId) {
      return { ...completed(validResult({ confirmed_units: 999 })), id: callId };
    },
  };
  const report = await runDrive(request, port, { now: () => new Date("2026-08-01T12:10:00Z") });
  assert.equal(creates, 1);
  assert.equal(report.stop_reason, "invalid-provider-output");
  assert.equal(report.donors_not_called, 1);
});

test("private report is created with owner-only permissions and cannot overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "surplus-signal-"));
  const path = join(directory, "report.json");
  const reservation = await reservePrivateReport(path);
  const report = createReport(fixture(), { providerCalls: [], attemptedDonorIds: [], stopReason: "drive-complete" });
  await reservation.finalize(report);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(path, "utf8")).drive_id, "drive-a1b2c3d4e5f6");
  await assert.rejects(() => reservePrivateReport(path), /EEXIST/);
});
