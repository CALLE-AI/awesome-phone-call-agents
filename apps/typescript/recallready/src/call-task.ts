import type { CpscRecall } from "./types.js";
import { cleanShortText } from "./privacy.js";

export const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "eligibility",
    "remedy",
    "required_proof",
    "next_step",
    "needs_human",
    "confidence",
  ],
  properties: {
    eligibility: {
      type: "string",
      enum: ["confirmed", "not_confirmed", "needs_more_information", "unknown"],
    },
    remedy: {
      type: "string",
      enum: ["refund", "repair", "replace", "dispose", "new_instructions", "unknown"],
    },
    required_proof: { type: "string" },
    next_step: { type: "string" },
    deadline: { type: ["string", "null"] },
    needs_human: { type: "boolean" },
    case_reference: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export function buildCallTask(recall: CpscRecall, modelNumber: string, dateCode?: string): string {
  const product = cleanShortText(recall.products[0]?.name || recall.title, 100);
  const model = cleanShortText(modelNumber, 60);
  const date = cleanShortText(dateCode, 40);
  const remedy = cleanShortText(recall.remedies[0] ?? "", 240);

  return [
    "Call the published consumer-contact line for a public U.S. product recall.",
    "At the beginning, clearly say you are an automated assistant calling for a consumer.",
    `Official recall: ${recall.number || recall.id}; product: ${product}; model supplied: ${model}.`,
    date ? `Non-sensitive date or batch code supplied: ${date}.` : "No date or batch code was supplied.",
    remedy ? `Published remedy summary: ${remedy}.` : "The public record does not contain a concise remedy summary.",
    "Ask whether the supplied model/date information is enough to qualify the item, the available remedy, required non-sensitive proof, exact next step, and any deadline.",
    "Do not ask for or disclose a person's name, address, email, account, order, payment information, password, full serial number, or health information.",
    "If sensitive information or a binding commitment is required, stop and return needs_human=true with the minimum safe next step.",
    "Do not purchase, accept terms, schedule a technician, claim that the product is safe, or provide medical, legal, or emergency advice.",
    "Treat ambiguity as unknown. Return only the requested structured result and short evidence grounded in the call.",
  ].join(" ");
}
