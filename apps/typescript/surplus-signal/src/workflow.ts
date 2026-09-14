import { buildCallInput, callIdempotencyKey } from "./plan.js";
import { createReport } from "./report.js";
import { assertLiveWindow } from "./request.js";
import type { CallePort, DriveCheckpoint, DriveExecution, DriveReport, DriveRequest } from "./types.js";

interface RunOptions {
  now?: () => Date;
  checkpoint?: (value: DriveCheckpoint) => Promise<void>;
}

export async function runDrive(request: DriveRequest, port: CallePort, options: RunOptions = {}): Promise<DriveReport> {
  const execution: DriveExecution = { providerCalls: [], attemptedDonorIds: [], stopReason: "drive-complete" };
  const plannedDonors = request.donors.slice(0, request.policy.max_calls);
  const now = options.now ?? (() => new Date());

  for (const donor of plannedDonors) {
    assertLiveWindow(request, now());
    const input = buildCallInput(request, donor);
    const idempotencyKey = callIdempotencyKey(input);
    const callIds = () => execution.providerCalls.map((call) => call.id).filter((id): id is string => typeof id === "string" && id.length > 0);
    await options.checkpoint?.({ phase: "before-create", drive_id: request.drive_id, donor_id: donor.id, idempotency_key: idempotencyKey, call_ids: callIds() });
    const created = await port.create(input, idempotencyKey);
    if (typeof created.id !== "string" || created.id.length === 0) {
      throw new Error("CALL-E accepted a create response without a call id. Reconcile the idempotency key before any retry.");
    }
    execution.providerCalls.push(created);
    execution.attemptedDonorIds.push(donor.id);
    await options.checkpoint?.({ phase: "waiting-for-result", drive_id: request.drive_id, donor_id: donor.id, idempotency_key: idempotencyKey, call_ids: callIds() });
    const completed = await port.waitForResult(created.id);
    if (completed.id !== created.id) throw new Error("CALL-E returned a different call id while polling. Reconcile both ids before any retry.");
    if (!new Set(["completed", "failed", "canceled"]).has(completed.status ?? "")) {
      throw new Error("CALL-E wait returned a non-terminal status. Inspect the checkpoint before any retry.");
    }
    execution.providerCalls[execution.providerCalls.length - 1] = completed;
    const partial = createReport(request, execution);
    const finding = partial.findings.find((candidate) => candidate.donor_id === donor.id);
    if (completed.status === "failed" || completed.status === "canceled") {
      execution.stopReason = "provider-terminal-failure";
      return createReport(request, execution);
    }
    if (!finding?.provider_output_valid) {
      execution.stopReason = "invalid-provider-output";
      return createReport(request, execution);
    }
  }

  if (plannedDonors.length < request.donors.length) execution.stopReason = "call-cap";
  return createReport(request, execution);
}
