import { getBusinessTemplate, type CallingHours } from '@dial/schemas';
import { sanitizeExternalText } from '@dial/domain';

/**
 * The brief CALL-E's agent works from on a business call.
 *
 * Same shape and same discipline as the consumer planner: Dial owns the goal,
 * the boundaries and the structured result; CALL-E holds the conversation.
 * Every value interpolated from stored business/contact/run data passes
 * through sanitizeExternalText first -- a customer note or a business name is
 * untrusted data, never instruction.
 */

export interface BusinessBriefInput {
  businessName: string;
  workflowName: string;
  template: string;
  /** The owner's own extra instructions (custom jobs). Untrusted. */
  goal: string | null;
  recipientName: string;
  context: Record<string, string>;
  locale: string;
  callingHours: CallingHours;
}

export function buildBusinessBrief(input: BusinessBriefInput): string {
  const template = getBusinessTemplate(input.template);
  const businessName = sanitizeExternalText(input.businessName, 120);
  const recipientName = sanitizeExternalText(input.recipientName, 120);

  const lines: string[] = [];
  lines.push('You are an AI assistant placing a phone call on behalf of a business. Be brief, polite and natural.');
  lines.push(
    'Identify yourself as an AI assistant calling on behalf of the business at the start of the call. Never claim to be a human.',
  );

  lines.push('', 'WHO YOU ARE CALLING');
  lines.push(`${recipientName}.`);

  lines.push('', 'WHY');
  if (template) {
    for (const line of template.goalLines({
      businessName,
      contactName: recipientName,
      context: input.context,
    })) {
      lines.push(line);
    }
  } else {
    lines.push(`Call ${recipientName} on behalf of ${businessName}.`);
  }
  if (input.goal && input.goal.trim()) {
    lines.push(`Additional instructions from the business: ${sanitizeExternalText(input.goal, 1000)}`);
  }

  lines.push(
    '',
    'HOW TO ASK',
    '- One question at a time. Wait for the answer before asking the next.',
    '- Never ask the same question twice, even in different words. If they have answered it, that answer stands.',
    '- If a reply is unclear, record it as "unknown" in the structured result. Do not rephrase and ask again.',
    '- When you have everything you were asked to find out, thank them and end the call.',
  );

  lines.push('', 'WHAT YOU MUST NOT DO');
  lines.push('- Do not agree to any payment, deposit, or card details.');
  lines.push('- Do not invent an answer. If they will not say, record that they would not say.');
  lines.push('- Do not argue, pressure, or call back repeatedly.');
  lines.push(
    '- If they ask to be contacted some other way, or not at all, record that faithfully in the structured result and end the call politely.',
  );
  lines.push(
    `- Calls are permitted between ${input.callingHours.startHour}:00 and ${input.callingHours.endHour}:00 in their local time. Keep the call short.`,
  );

  lines.push(
    '',
    'RECORDING THE ANSWER',
    'Fill in the structured result honestly, using "unknown" or the least-specific valid value wherever the business did not clearly answer. Do not turn a vague reply into a definite outcome.',
  );
  if (input.locale && input.locale !== 'en') {
    lines.push(`Speak ${input.locale} with the recipient unless they prefer another language.`);
  }

  return lines.join('\n');
}
