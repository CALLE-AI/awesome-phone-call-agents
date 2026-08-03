import type { JsonSchema } from "../../calle/types.js";
import { formatSlot } from "../../services/booking.service.js";

export interface BackfillPromptContext {
  businessName: string;
  timezone: string;
  contactName: string;
  openSlot: { startsAt: Date; endsAt: Date; serviceType: string };
}

export function buildBackfillTask(ctx: BackfillPromptContext): { task: string; resultSchema: JsonSchema } {
  const when = formatSlot(ctx.openSlot, ctx.timezone);
  const task =
    `You are calling on behalf of ${ctx.businessName} to reach ${ctx.contactName}, who is on the waitlist. ` +
    `An appointment slot has just opened up: ${when}. ` +
    `Ask if they would like to take this slot. If they say yes, confirm it is now booked for them. ` +
    `If they decline or are unsure, thank them and let them know they will stay on the waitlist. ` +
    `Be brief and polite. Do not give medical, legal, or financial advice. ` +
    `If you reach voicemail, do NOT book anything; leave a short message and report accepted as no.`;

  const resultSchema: JsonSchema = {
    type: "object",
    required: ["accepted"],
    additionalProperties: false,
    properties: {
      accepted: {
        type: "string",
        enum: ["yes", "no"],
        description: "Whether the contact accepted the offered slot. Voicemail or uncertainty counts as no.",
      },
      reason: { type: "string", description: "Brief reason if they declined. Empty otherwise." },
    },
  };
  return { task, resultSchema };
}
