import type { CallePort, SearchCheckpoint, SearchExecution, SearchReport, SearchRequest } from "./types.js";
import { buildCallInput, callIdempotencyKey } from "./plan.js";
import { createReport } from "./report.js";
import { assertLiveWindow } from "./request.js";

interface RunOptions {
  now?: () => Date;
  checkpoint?: (value: SearchCheckpoint) => Promise<void>;
}

export async function runSearch(request: SearchRequest, port: CallePort, options: RunOptions = {}): Promise<SearchReport> {
  const execution: SearchExecution = { providerCalls: [], attemptedLocationIds: [], stopReason: "route-complete" };
  const plannedLocations = request.locations.slice(0, request.policy.max_calls);
  const now = options.now ?? (() => new Date());

  for (const location of plannedLocations) {
    assertLiveWindow(request, now());
    const singleRequest: SearchRequest = {
      ...request,
      locations: [location],
      policy: { ...request.policy, max_calls: 1 },
    };
    const input = buildCallInput(singleRequest);
    const idempotencyKey = callIdempotencyKey(input);
    await options.checkpoint?.({
      phase: "before-create",
      search_id: request.search_id,
      location_id: location.id,
      idempotency_key: idempotencyKey,
      call_ids: execution.providerCalls.map((call) => call.id).filter((id): id is string => typeof id === "string" && id.length > 0),
    });
    const created = await port.create(input, idempotencyKey);
    if (typeof created.id !== "string" || created.id.length === 0) {
      throw new Error("CALL-E accepted a create response without a call id. Stop and reconcile the idempotency key before any retry.");
    }
    execution.providerCalls.push(created);
    execution.attemptedLocationIds.push(location.id);
    await options.checkpoint?.({
      phase: "waiting-for-result",
      search_id: request.search_id,
      location_id: location.id,
      idempotency_key: idempotencyKey,
      call_ids: execution.providerCalls.map((call) => call.id).filter((id): id is string => typeof id === "string" && id.length > 0),
    });
    const call = await port.waitForResult(created.id);
    if (call.id !== created.id) {
      throw new Error("CALL-E returned a different call id while polling. Stop and reconcile both ids before any retry.");
    }
    if (!new Set(["completed", "failed", "canceled"]).has(call.status ?? "")) {
      throw new Error("CALL-E wait returned a non-terminal status. Stop and inspect the checkpoint before any retry.");
    }
    execution.providerCalls[execution.providerCalls.length - 1] = call;

    const partial = createReport(request, execution);
    const finding = partial.findings.find((candidate) => candidate.location_id === location.id);
    if (call.status === "failed" || call.status === "canceled") {
      execution.stopReason = "provider-terminal-failure";
      return createReport(request, execution);
    }
    if (!finding?.provider_output_valid) {
      execution.stopReason = "invalid-provider-output";
      return createReport(request, execution);
    }
    if (finding.match_confidence === "strong") {
      execution.stopReason = "strong-match";
      return createReport(request, execution);
    }
  }

  if (plannedLocations.length < request.locations.length) execution.stopReason = "call-cap";
  return createReport(request, execution);
}
