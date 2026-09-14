import { z } from "zod";
import type { CalleCallSnapshot } from "./status";
import { redactPhoneNumbers } from "../safety/phone";

export const followupEvidence = z.object({
  decision: z.enum(["requested", "not_requested", "declined", "unclear"]),
  public_information: z.enum(["yes", "no", "unclear"]),
  unambiguous: z.enum(["yes", "no", "unclear"]),
  request_quote: z.string().max(600),
  consent_question_quote: z.string().max(600),
  consent_quote: z.string().max(600),
}).strict();
export type FollowupEvidence = z.infer<typeof followupEvidence>;

export const summaryEvidence = z.object({
  decision: z.enum(["requested", "not_requested", "declined", "unclear"]),
  summary_quote: z.string().max(240),
  consent_question_quote: z.string().max(600),
  consent_quote: z.string().max(600),
}).strict();
export type SummaryEvidence = z.infer<typeof summaryEvidence>;

export function assertFollowupDestination(value: unknown, expected: string): void {
  const recipient = z.object({ recipients: z.tuple([z.object({ phones: z.tuple([z.literal(expected)]) })]) });
  if (!recipient.safeParse(value).success) throw new Error("Call recipient does not match the registered SMS destination");
}

export const CALLE_FOLLOWUP_SCHEMA = {
  type: "object", additionalProperties: false, required: ["post_call_search", "post_call_summary"],
  properties: { post_call_summary: {
    type: "object", additionalProperties: false,
    required: ["decision", "summary_quote", "consent_question_quote", "consent_quote"],
    properties: {
      decision: { type: "string", enum: ["requested", "not_requested", "declined", "unclear"], description: "Requested only when the customer explicitly agrees to an SMS summary after hearing the recap. Any later refusal wins." },
      summary_quote: { type: "string", description: "Exact complete assistant turn recapping the conversation, at most 240 characters. Prefer under 100 characters. No secrets, private details, medical/legal/financial advice or unverified facts. Empty if unavailable." },
      consent_question_quote: { type: "string", description: "Exact complete assistant turn immediately before consent, asking to text the summary to this same number after the call." },
      consent_quote: { type: "string", description: "Exact complete customer turn answering the summary SMS question. Empty if unavailable." },
    },
  }, post_call_search: {
    type: "object", additionalProperties: false,
    required: ["decision", "public_information", "unambiguous", "request_quote", "consent_question_quote", "consent_quote"],
    properties: {
      decision: { type: "string", enum: ["requested", "not_requested", "declined", "unclear"], description: "Use requested only for one clear customer request to search AFTER the call with explicit SMS permission to the same called number. Any later refusal or withdrawal wins. Never infer consent from assistant speech." },
      public_information: { type: "string", enum: ["yes", "no", "unclear"], description: "Yes only for ordinary public information. No for personal/private information, account access, medical/legal/financial advice, emergencies, booking, purchasing, or contacting another person." },
      unambiguous: { type: "string", enum: ["yes", "no", "unclear"], description: "Yes only when the complete request quote contains enough topic, place and time context to search without guessing. Ask the caller to restate a complete request if needed." },
      request_quote: { type: "string", description: "Exact complete customer turn containing the final single search request and relevant location/time. Empty if unavailable. No paraphrase." },
      consent_question_quote: { type: "string", description: "Exact complete assistant turn immediately before consent, explicitly asking permission to text/SMS the search results to this same number after the call. Empty if unavailable." },
      consent_quote: { type: "string", description: "Exact complete customer turn answering that question. Use the final decision; empty when unavailable." },
    },
  } },
} as const;

export function addPostCallSearchInstructions(task: string, preview = false): string {
  const instructions = task.replace("Do not promise callbacks, SMS, bookings, purchases or recurring calls.", "Do not promise callbacks, bookings, purchases or recurring calls.") +
    "\nEVERY CALL SUMMARY: Before ending every ordinary conversation, speak one brief factual recap in its own turn (prefer under 100 characters, maximum 240). Include only what was actually discussed, without secrets, private details or medical/legal/financial advice. Pause for the customer to acknowledge or correct the recap; if corrected, restate it and wait again. Then ask in a separate turn: May I text this summary to this same number after our call? Wait for explicit agreement. If the customer declines, do not send. If they requested a search, explain that verified results may be included in the same follow-up. Never promise an SMS for an unanswered call or voicemail. Respect later withdrawal of any SMS permission." +
    "\nPOST-CALL SEARCH: You cannot search live during this call. If the customer wants current public information, collect ONE specific request including place and date when relevant; have them restate the complete request. Read it back and ask: May I text the search results to this same number after our call? Wait for a clear yes. Only then say: I will look that up after our call and text you the results if I can verify them. Explain that no text is sent if the search fails. Respect any later withdrawal. Do not invent consent or substitute a different destination. Never collect secrets or account details, provide medical/legal/financial advice, handle emergencies, or promise bookings, purchases, recurring messages or contact with third parties.";
  if (!preview) return instructions;
  return instructions
    .replace("May I text this summary to this same number after our call?", "May I prepare an SMS summary for this same number after our call?")
    .replace("May I text the search results to this same number after our call?", "May I prepare an SMS with the search results for this same number after our call?")
    .replace("I will look that up after our call and text you the results if I can verify them.", "I will look that up after our call and prepare the SMS if I can verify the results.");

}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
const unsafe = /\b(password|credential|secret|token|account number|diagnos\w*|medication|emergency|legal advice|financial advice|investment|buy|purchase|book|transfer money)\b/i;

/** Send the recap the customer actually heard, never an unreviewed provider summary. */
export function verifiedCallSummary(call: CalleCallSnapshot, allowPreview = false): string | undefined {
  const evidence = call.postCallSummary;
  if (call.status !== "completed" || !evidence || evidence.decision !== "requested") return;
  const summary = evidence.summary_quote.trim();
  if (!summary || unsafe.test(summary) || redactPhoneNumbers(summary) !== summary) return;
  if (!allowPreview && /\bpreview\b/i.test(evidence.consent_question_quote)) return;
  const turns = call.transcript;
  const recapIndex = turns.findIndex((turn) => turn.speaker === "assistant" && normalize(turn.text) === normalize(summary));
  const consentIndex = turns.findIndex((turn, index) => index > recapIndex + 1 && turn.speaker === "caller"
    && normalize(turn.text) === normalize(evidence.consent_quote)
    && turns[index - 1]?.speaker === "assistant"
    && normalize(turns[index - 1]!.text) === normalize(evidence.consent_question_quote));
  if (recapIndex < 0 || consentIndex < 0) return;
  const attempt = (id: string) => id.slice(0, id.lastIndexOf("-"));
  if (attempt(turns[recapIndex]!.id) !== attempt(turns[consentIndex]!.id)
    || attempt(turns[consentIndex - 1]!.id) !== attempt(turns[consentIndex]!.id)) return;
  if (!/\b(text|sms)\b/i.test(evidence.consent_question_quote)
    || !/\b(summary|recap)\b/i.test(evidence.consent_question_quote)
    || !/\b(same|this) number\b/i.test(evidence.consent_question_quote)
    || !/\bafter\b/i.test(evidence.consent_question_quote)) return;
  if (!/^(yes|yeah|yep|sure|okay|ok|please do)\b/i.test(evidence.consent_quote.trim())
    || /\b(no|not|don't|do not|stop|cancel|but|unless|only if)\b/i.test(evidence.consent_quote)) return;
  if (turns.slice(consentIndex + 1).some((turn) => turn.speaker === "caller"
    && /\b(no|don't|do not|stop|cancel|unsubscribe|changed my mind)\b/i.test(turn.text))) return;
  return summary;
}

export function verifiedSearchRequest(call: CalleCallSnapshot, allowPreview = false): string | undefined {
  const evidence = call.postCallSearch;
  if (call.status !== "completed" || !evidence || evidence.decision !== "requested"
    || evidence.public_information !== "yes" || evidence.unambiguous !== "yes") return;
  const query = evidence.request_quote.trim();
  if (query.length < 5 || query.length > 600 || unsafe.test(query) || redactPhoneNumbers(query) !== query) return;
  if (!allowPreview && /\bpreview\b/i.test(evidence.consent_question_quote)) return;
  const turns = call.transcript;
  const requestIndex = turns.findIndex((turn) => turn.speaker === "caller" && normalize(turn.text) === normalize(query));
  const consentIndex = turns.findIndex((turn, index) => index > requestIndex && turn.speaker === "caller"
    && normalize(turn.text) === normalize(evidence.consent_quote)
    && turns[index - 1]?.speaker === "assistant"
    && normalize(turns[index - 1]!.text) === normalize(evidence.consent_question_quote));
  if (requestIndex < 0 || consentIndex <= requestIndex) return;
  const attempt = (id: string) => id.slice(0, id.lastIndexOf("-"));
  if (attempt(turns[requestIndex]!.id) !== attempt(turns[consentIndex]!.id)
    || attempt(turns[consentIndex - 1]!.id) !== attempt(turns[consentIndex]!.id)) return;
  if (!/\b(text|sms)\b/i.test(evidence.consent_question_quote)
    || !/\b(results?|information|answer)\b/i.test(evidence.consent_question_quote)
    || !/\b(same|this) number\b/i.test(evidence.consent_question_quote)
    || !/\bafter\b/i.test(evidence.consent_question_quote)) return;
  if (!/^(yes|yeah|yep|sure|okay|ok|please do)\b/i.test(evidence.consent_quote.trim())
    || /\b(no|not|don't|do not|stop|cancel|but|unless|only if)\b/i.test(evidence.consent_quote)) return;
  // Conservative withdrawal guard: any subsequent refusal requires human review.
  if (turns.slice(consentIndex + 1).some((turn) => turn.speaker === "caller"
    && /\b(no|don't|do not|stop|cancel|unsubscribe|changed my mind)\b/i.test(turn.text))) return;
  return query;
}

/**
 * CALL-E can occasionally split a preview consent question across adjacent turns
 * and omit the exact request quote. Recover only an operator preview: the
 * customer still has to answer the combined SMS question affirmatively, and the
 * bounded provider summary must say that the request was confirmed.
 */
export function verifiedPreviewSearchRequest(call: CalleCallSnapshot): string | undefined {
  const evidence = call.postCallSearch;
  if (call.status !== "completed" || !evidence || evidence.decision !== "requested"
    || evidence.public_information !== "yes" || !call.summary) return;
  const consent = evidence.consent_quote.trim();
  if (!/^(yes|yeah|yep|sure|okay|ok|please do)\b/i.test(consent)
    || /\b(no|not|don't|do not|stop|cancel|but|unless|only if)\b/i.test(consent)) return;
  const turns = call.transcript;
  const consentIndex = turns.findIndex((turn) => turn.speaker === "caller" && normalize(turn.text) === normalize(consent));
  if (consentIndex < 1) return;
  const attempt = (id: string) => id.slice(0, id.lastIndexOf("-"));
  const consentAttempt = attempt(turns[consentIndex]!.id);
  const precedingAssistantTurns = turns.slice(Math.max(0, consentIndex - 3), consentIndex)
    .filter((turn) => turn.speaker === "assistant" && attempt(turn.id) === consentAttempt);
  const combinedQuestion = precedingAssistantTurns.map((turn) => turn.text).join(" ");
  if (!/\b(text|sms)\b/i.test(combinedQuestion)
    || !/\b(search results?|information|answer)\b/i.test(combinedQuestion)
    || !/\b(same|this) number\b/i.test(combinedQuestion)
    || !/\bafter\b/i.test(combinedQuestion)) return;
  if (turns.slice(consentIndex + 1).some((turn) => turn.speaker === "caller"
    && /\b(no|don't|do not|stop|cancel|unsubscribe|changed my mind)\b/i.test(turn.text))) return;
  const confirmed = call.summary.match(/\bconfirmed (?:an?\s+)?(.{5,400}?)\s+and agreed to\b/i)?.[1]?.trim();
  if (!confirmed || !/\b(search|request|find|restaurant|news|information)\b/i.test(confirmed)) return;
  const query = `Find ${confirmed.replace(/\b(?:restaurant-)?search request\b/i, "restaurant").replace(/\s+/g, " ")}`;
  if (query.length > 600 || unsafe.test(query) || redactPhoneNumbers(query) !== query) return;
  return query;
}
