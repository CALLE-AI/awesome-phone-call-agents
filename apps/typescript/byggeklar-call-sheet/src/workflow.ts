import { createHash } from "node:crypto";

export const SUPPORTED_REGIONS = new Set([
  "US", "SG", "MY", "IN", "AE", "AU", "CA", "GB", "VN", "DE", "JP", "FR", "MX", "BR",
  "ID", "PH", "KE", "NL", "PL", "BD", "NG", "OM", "TH", "NA", "CM", "MZ", "SA", "FI",
  "UA", "LK", "BW", "PK", "TR", "HN",
]);

export interface SupplierRequest {
  request_id: string;
  project_name: string;
  supplier_name: string;
  phone: string;
  region: string;
  locale: string;
  consent_note: string;
  material: string;
  requested_delivery_date: string;
  questions: string[];
  calling_window: string;
}

export interface Preview {
  request: SupplierRequest;
  maskedPhone: string;
  task: string;
  resultSchema: Record<string, unknown>;
  receipt: string;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length < 2) throw new Error(`${name} is required`);
  return value.trim();
}

export function validateRequest(value: unknown): SupplierRequest {
  if (!value || typeof value !== "object") throw new Error("request must be an object");
  const v = value as Record<string, unknown>;
  const phone = requiredText(v.phone, "phone");
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("phone must use E.164 format");
  const region = requiredText(v.region, "region").toUpperCase();
  if (!SUPPORTED_REGIONS.has(region)) throw new Error(`region ${region} is not currently supported by CALL-E`);
  if (!Array.isArray(v.questions) || v.questions.length < 1 || v.questions.length > 6) {
    throw new Error("questions must contain 1 to 6 items");
  }
  const questions = v.questions.map((q, i) => requiredText(q, `questions[${i}]`));
  const consent = requiredText(v.consent_note, "consent_note");
  if (!/consent|authori[sz]ed|permission/i.test(consent)) {
    throw new Error("consent_note must record permission or authorization for the call");
  }
  return {
    request_id: requiredText(v.request_id, "request_id"),
    project_name: requiredText(v.project_name, "project_name"),
    supplier_name: requiredText(v.supplier_name, "supplier_name"),
    phone,
    region,
    locale: requiredText(v.locale, "locale"),
    consent_note: consent,
    material: requiredText(v.material, "material"),
    requested_delivery_date: requiredText(v.requested_delivery_date, "requested_delivery_date"),
    questions,
    calling_window: requiredText(v.calling_window, "calling_window"),
  };
}

export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}${"*".repeat(Math.max(4, phone.length - 5))}${phone.slice(-2)}`;
}

export function buildPreview(request: SupplierRequest): Preview {
  const task = [
    `Call ${request.supplier_name} at ${request.phone}.`,
    `Immediately disclose that you are an automated assistant calling for ${request.project_name}.`,
    `Purpose: verify supplier readiness for ${request.material}, requested for ${request.requested_delivery_date}.`,
    `Ask only these questions: ${request.questions.map((q, i) => `${i + 1}) ${q}`).join(" ")}`,
    "Read back the factual answers once. Do not negotiate, place an order, accept a substitute, agree to fees, disclose unrelated project data, or create any commitment.",
    "If the recipient refuses an automated call, record the refusal and end politely. If an answer is unclear, mark it unknown rather than guessing.",
  ].join("\n");
  const resultSchema = {
    type: "object",
    additionalProperties: false,
    required: ["supplier_reached", "full_quantity_available", "delivery_date", "quote_valid_until", "excluded_fees", "substitution_required", "human_review_required"],
    properties: {
      supplier_reached: { type: "string", enum: ["yes", "no", "refused", "unknown"] },
      full_quantity_available: { type: "string", enum: ["yes", "no", "partial", "unknown"] },
      delivery_date: { type: ["string", "null"] },
      quote_valid_until: { type: ["string", "null"] },
      excluded_fees: { type: "array", items: { type: "string" } },
      substitution_required: { type: ["string", "null"] },
      human_review_required: { type: "boolean" },
    },
  };
  const receipt = createHash("sha256").update(JSON.stringify({ request, task, resultSchema })).digest("hex");
  return { request, maskedPhone: maskPhone(request.phone), task, resultSchema, receipt };
}

export function renderPreview(preview: Preview): string {
  return [
    "BYGGEKLAR CALL SHEET — NO CALL PLACED",
    `Project      ${preview.request.project_name}`,
    `Supplier     ${preview.request.supplier_name}`,
    `Destination  ${preview.maskedPhone} (${preview.request.region}, ${preview.request.locale})`,
    `Window       ${preview.request.calling_window}`,
    "",
    "The call may collect facts only. Ordering, negotiation, substitutions and fees remain human decisions.",
    "",
    preview.task,
    "",
    `Approval receipt: ${preview.receipt}`,
  ].join("\n");
}

export const DEMO_RESULT = {
  status: "completed",
  taskCompleted: true,
  completionConfidence: { score: 0.93, label: "high" },
  structuredResult: {
    supplier_reached: "yes",
    full_quantity_available: "partial",
    delivery_date: "2026-09-03",
    quote_valid_until: "2026-08-28",
    excluded_fees: ["unloading"],
    substitution_required: "12 lengths would be substituted with 50 x 150 mm",
    human_review_required: true,
  },
  evidence: [
    "The supplier said 36 of 48 lengths are available in the specified size.",
    "The supplier offered a dimensional substitution for the remaining 12 lengths.",
    "The supplier said unloading is excluded and delivery would be 3 September.",
  ],
};
