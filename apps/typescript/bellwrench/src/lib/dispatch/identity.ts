import { createHash } from "node:crypto";

import { buildVendorCallTask, vendorResultSchema } from "./task";
import type { DispatchRequest, Vendor } from "./types";

const RESULT_SCHEMA_VERSION = "vendor-result-v2";

export function providerIdempotencyKey(
  request: DispatchRequest,
  vendor: Vendor,
): string {
  const payload = JSON.stringify({
    version: RESULT_SCHEMA_VERSION,
    dispatchId: request.dispatchId,
    task: buildVendorCallTask(request.workOrder, vendor),
    phone: vendor.phone,
    schema: vendorResultSchema,
  });
  const digest = createHash("sha256").update(payload).digest("hex").slice(0, 32);
  return `bellwrench:${request.dispatchId}:${digest}`;
}
