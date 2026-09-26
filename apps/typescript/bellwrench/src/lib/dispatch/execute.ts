import type { CallPort } from "../calle/client";
import {
  CREATE_OUTCOME_UNRESOLVED,
  CreateOutcomeUnresolvedError,
  reconcileCreateWithOriginalKey,
} from "../calle/reconciliation";
import { providerIdempotencyKey } from "./identity";
import { rankVendorResults } from "./rank";
import { classifyTerminalCall } from "./result";
import { buildVendorCallTask, vendorResultSchema } from "./task";
import type {
  DispatchRequest,
  Vendor,
  VendorCallResult,
} from "./types";

const SAFE_FAILURE_CODE = /^[A-Za-z0-9_-]{1,64}$/;

interface ExecuteOptions {
  reconciliationSleep?: (milliseconds: number) => Promise<void>;
}

function errorCode(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && SAFE_FAILURE_CODE.test(code)
    ? code
    : fallback;
}

function emptyResultFields() {
  return {
    callStatus: null,
    recipientStatus: null,
    taskCompleted: null,
    availability: "unknown" as const,
    earliestEta: null,
    priceType: "not_provided" as const,
    priceAmount: null,
    currency: null,
    constraints: [],
    completionConfidence: null,
    confidenceScore: null,
    summary: null,
    evidence: [],
  };
}

function failedResult(
  vendor: Vendor,
  failureCode: string,
): VendorCallResult {
  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    status: "failed",
    callId: null,
    ...emptyResultFields(),
    failureCode,
  };
}

function unknownResult(
  vendor: Vendor,
  callId: string | null,
  failureCode: string,
): VendorCallResult {
  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    status: "unknown",
    callId,
    ...emptyResultFields(),
    failureCode,
  };
}

export async function executeDispatch(
  request: DispatchRequest,
  port: CallPort,
  options: ExecuteOptions = {},
): Promise<VendorCallResult[]> {
  const selectedVendors = request.vendors.filter((vendor) => vendor.selected);
  const calls = selectedVendors.map(
    async (vendor): Promise<VendorCallResult> => {
      const callInput = {
        task: buildVendorCallTask(request.workOrder, vendor),
        recipient: { phone: vendor.phone },
        recipientResultSchema:
          vendorResultSchema as unknown as Record<string, unknown>,
        metadata: {
          workflow: "bellwrench_dispatch",
          dispatch_id: request.dispatchId,
          vendor_id: vendor.id,
        },
      };
      const key = providerIdempotencyKey(request, vendor);

      let created;
      try {
        created = await reconcileCreateWithOriginalKey(
          (idempotencyKey) =>
            port.create(callInput, { idempotencyKey }),
          key,
          { sleep: options.reconciliationSleep },
        );
      } catch (error) {
        if (error instanceof CreateOutcomeUnresolvedError) {
          return unknownResult(vendor, null, CREATE_OUTCOME_UNRESOLVED);
        }
        return failedResult(
          vendor,
          errorCode(error, "CALL_CREATE_REJECTED"),
        );
      }

      let terminal;
      try {
        terminal = await port.waitForResult(created.id, {
          timeoutMs: 8 * 60 * 1000,
        });
      } catch {
        return unknownResult(vendor, created.id, "RESULT_UNAVAILABLE");
      }

      const recipient = terminal.recipients[0];
      return classifyTerminalCall({
        vendorId: vendor.id,
        vendorName: vendor.name,
        callId: terminal.id,
        status: terminal.status,
        taskCompleted: terminal.taskCompleted,
        completionConfidence: terminal.completionConfidence,
        summary: terminal.summary,
        evidence: terminal.evidence,
        failureCode: terminal.failureCode,
        recipientStatus: recipient?.status,
        structuredResult: recipient?.structuredResult,
      });
    },
  );

  return rankVendorResults(await Promise.all(calls));
}
