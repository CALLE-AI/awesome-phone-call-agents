import type { JsonSchema } from "../../calle/types.js";
import { formatSlot } from "../../services/booking.service.js";

export interface QualifyPromptContext {
  businessName: string;
  timezone: string;
  contactName: string;
  rawInquiry: string;
  nextOpenSlot: { startsAt: Date; endsAt: Date; serviceType: string } | null;
}

export function buildQualifyTask(ctx: QualifyPromptContext): { task: string; resultSchema: JsonSchema } {
  const slotOffer =
    ctx.nextOpenSlot === null
      ? `There are no open slots right now; if they are interested, tell them they will be added to the waitlist and called when something opens. `
      : `If they are interested and it suits them, offer the next available slot: ${formatSlot(ctx.nextOpenSlot, ctx.timezone)}, and ask if they want to book it. `;
  const task =
    `You are calling on behalf of ${ctx.businessName} to follow up with ${ctx.contactName}, who recently sent this inquiry: "${ctx.rawInquiry}". ` +
    `Ask (1) what they need help with / the reason for their visit, and (2) how soon they are hoping to come in. ` +
    slotOffer +
    `Be brief and polite. Do not give medical, legal, or financial advice. ` +
    `If you reach voicemail, leave a short callback message and report interested as unknown.`;

  const resultSchema: JsonSchema = {
    type: "object",
    required: ["interested"],
    additionalProperties: false,
    properties: {
      interested: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description: "Whether the lead is genuinely interested in booking a service.",
      },
      reason_for_visit: { type: "string", description: "What they need, in their words. Empty if unknown." },
      preferred_timeframe: { type: "string", description: "How soon they want to come in. Empty if unknown." },
      wants_offered_slot: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description: "Whether they accepted the specific offered slot, if one was offered.",
      },
    },
  };
  return { task, resultSchema };
}
