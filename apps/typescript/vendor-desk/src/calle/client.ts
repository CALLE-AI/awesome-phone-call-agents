import { config } from "../config";
import { VendorTask } from "../types";
import { buildVendorTaskPrompt, VENDOR_QUOTE_RESULT_SCHEMA } from "./agentPrompt";

interface CreateCallResponse {
  id: string;
  status: string;
}

/** Masks a phone number for safe logging, e.g. +15551234567 -> +1555***4567 */
function maskPhone(phone: string): string {
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 4)}***${phone.slice(-4)}`;
}

export async function dispatchVendorCall(
  jobId: string,
  task: VendorTask
): Promise<CreateCallResponse> {
  if (config.dryRun) {
    // Default safety path: simulate a call instead of placing a real one.
    // No network request is made to CALL-E and no phone rings.
    console.log(
      `[DRY RUN] Would call ${maskPhone(task.phoneNumber)} for "${task.item}" ` +
        `(job ${jobId}). Set CALLE_DRY_RUN=false to place a real call.`
    );
    return { id: `dryrun_${jobId}`, status: "simulated" };
  }

  const body = {
    // No `recipient` object — CALL-E's real API 422s with extra_forbidden if
    // you send one. The phone number lives in the task prompt instead.
    task: buildVendorTaskPrompt(task),
    result_schema: VENDOR_QUOTE_RESULT_SCHEMA,
    metadata: {
      job_id: jobId,
      vendor_name: task.vendorName,
      item: task.item,
    },
    webhook_url: config.webhook.url,
  };

  const res = await fetch(`${config.calle.baseUrl}/v1/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.calle.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `vendordesk_${jobId}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `CALL-E call creation failed (${res.status}): ${errText || res.statusText}`
    );
  }

  return (await res.json()) as CreateCallResponse;
}

export async function getCallStatus(calleCallId: string) {
  const res = await fetch(`${config.calle.baseUrl}/v1/calls/${calleCallId}`, {
    headers: { Authorization: `Bearer ${config.calle.apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch call ${calleCallId}: ${res.status}`);
  }

  return res.json();
}
