/**
 * The three-question wellness check-in script and the structured result CALL-E
 * should return. Refined against real calls (see the linked full app in the
 * README) to always move forward rather than loop on an ambiguous or negative
 * answer.
 */

export const WELLNESS_TASK =
  "This is a wellness check-in call. " +
  "Ask the following 3 questions, in this order, slowly and in a clear, friendly tone. " +
  '1. "How are you feeling today?" ' +
  '2. "Have you been eating properly?" ' +
  '3. "Is there anything you\'re worried about, or anything you need?" ' +
  "For each question, once you get an answer (whether it's good or bad), move on to the next question. " +
  "Do not repeat the same question or leave long silences. " +
  "Once the third question is answered, say a brief kind word, wrap up the conversation politely, and end the call. " +
  "Never give medical advice or a diagnosis, under any circumstances.";

export const WELLNESS_RESULT_SCHEMA = {
  type: "object",
  required: ["answered", "condition_summary", "meal_status", "concerns_reported"],
  properties: {
    answered: { type: "boolean", description: "Whether the person answered the call." },
    condition_summary: {
      type: "string",
      description: "One-line summary of their answer about how they're feeling.",
    },
    meal_status: {
      type: "string",
      enum: ["good", "somewhat_concerning", "unknown"],
      description: "Rough assessment of whether they're eating properly.",
    },
    concerns_reported: {
      type: "boolean",
      description: "Whether they reported any concern or thing they need.",
    },
    concerns_detail: {
      type: "string",
      description: "Details of the reported concern, if any.",
    },
  },
} as const;
