import type { JsonSchema } from "../../calle/types.js";
import { formatSlot } from "../../services/booking.service.js";

export interface ConfirmPromptContext {
  businessName: string;
  timezone: string;
  contactName: string;
  appointmentSlot: { startsAt: Date; endsAt: Date; serviceType: string };
  alternativeSlots: { id: string; startsAt: Date; endsAt: Date; serviceType: string }[];
}

export function buildConfirmTask(ctx: ConfirmPromptContext): { task: string; resultSchema: JsonSchema } {
  const when = formatSlot(ctx.appointmentSlot, ctx.timezone);
  const alternatives = ctx.alternativeSlots
    .map((slot, index) => `option_${index + 1} = ${formatSlot(slot, ctx.timezone)}`)
    .join("; ");
  const task =
    `You are calling on behalf of ${ctx.businessName} to reach ${ctx.contactName} about their upcoming appointment: ${when}. ` +
    `Ask them to confirm they will attend. ` +
    (alternatives.length > 0
      ? `If they cannot make it, offer these alternative times and ask if one works: ${alternatives}. `
      : `If they cannot make it, note that they wish to cancel or reschedule. `) +
    `Be brief, polite, and do not give medical, legal, or financial advice. ` +
    `If you reach voicemail, leave a short message asking them to call ${ctx.businessName} back, and report the outcome as unknown.`;

  const resultSchema: JsonSchema = {
    type: "object",
    required: ["will_attend", "reached_voicemail"],
    additionalProperties: false,
    properties: {
      will_attend: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description: "Whether the contact confirmed they will attend the original appointment.",
      },
      wants_reschedule: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description: "If not attending, whether they want to move to another time.",
      },
      chosen_alternative: {
        type: "string",
        description: "Which offered alternative they picked, as option_1 / option_2 / etc. Empty if none.",
      },
      reached_voicemail: { type: "string", enum: ["yes", "no"] },
    },
  };
  return { task, resultSchema };
}
