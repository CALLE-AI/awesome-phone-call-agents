import { CalleAPIError, CalleClient, type Call, type CreateCallInput } from "@call-e/calle";
import { matchSupportedDestination, maskPhoneNumber, validatePhoneNumber } from "./security.ts";
import { discoveryResultSchema, RECIPIENT_RESULT_SCHEMA } from "./result-schema.ts";
import { interestThemes } from "../intent/profile.ts";
import type { BrainGoal, IntentProfile, SundialCallRecord, WebSessionContext } from "../types.ts";

export interface LiveCallContext {
  company?: string;
  useCase?: string;
  companySize?: string;
  declaredCta?: SundialCallRecord["declaredCta"];
  declaredInterest?: string[];
  intent?: IntentProfile;
  productName?: string;
  agentIdentity?: string;
  tonePersona?: string;
  playbookNotes?: string;
  openingScript?: string;
  closingScript?: string;
  activeGoals?: BrainGoal[];
}

/** Used when Brain openingScript is missing or empty. Never names a customer. */
export const GENERIC_OPENING_SCRIPT =
  "Hi there, thanks for picking up! This is an automated assistant calling you back because you requested a call. Before we get started, just a quick heads-up that this call may be recorded for quality. What can we help you with today?";

export const GENERIC_CLOSING_SCRIPT =
  "Thanks so much for your time today. We'll take what you shared and look at a plan that fits — glad we could help, and I hope this makes the work a bit easier from here.";

export function resolveOpeningScript(openingScript?: string): string {
  const trimmed = openingScript?.trim();
  return trimmed || GENERIC_OPENING_SCRIPT;
}

export function resolveClosingScript(closingScript?: string): string {
  const trimmed = closingScript?.trim();
  return trimmed || GENERIC_CLOSING_SCRIPT;
}

export const OFFICIAL_CALLE_ORIGIN = "https://api.heycall-e.com";

export function regionFromE164(phone: string): { region: string; locale: string } {
  const destination = matchSupportedDestination(phone);
  if (!destination) {
    throw new Error("Unsupported destination country. Use a supported E.164 number.");
  }
  return { region: destination.region, locale: destination.locale };
}

export function safeCalleBaseUrl(raw = process.env.CALLE_BASE_URL || OFFICIAL_CALLE_ORIGIN): string {
  const url = new URL(raw);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const official = url.protocol === "https:" && url.origin === OFFICIAL_CALLE_ORIGIN;
  if ((!loopback && !official) || url.username || url.password || url.search || url.hash) {
    throw new Error("CALL-E base URL must be https://api.heycall-e.com or a loopback test server.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("The CALL-E base URL must not contain a path.");
  }
  return url.origin;
}

export function buildLiveCallTask(
  phoneNumber: string,
  session: WebSessionContext,
  contactName?: string,
  contactEmail?: string,
  ctx: LiveCallContext = {}
): string {
  const { region, locale } = regionFromE164(phoneNumber);
  const who = contactName || "the person who submitted the form";
  const themes =
    interestThemes(ctx.declaredInterest || []).join(", ") ||
    (session.landingUrl ? `page ${session.landingUrl.split("?")[0]}` : "general CRM interest");
  const company = ctx.company || "their company";
  const product = ctx.productName?.trim();
  const opening = resolveOpeningScript(ctx.openingScript);
  const closing = resolveClosingScript(ctx.closingScript);
  const role = ctx.agentIdentity ? `\nRole: ${ctx.agentIdentity}` : "";
  const tone = ctx.tonePersona ? `\nTone: ${ctx.tonePersona}` : "";
  const playbook = ctx.playbookNotes?.trim() ? `\nPlaybook: ${ctx.playbookNotes.trim()}` : "";
  const goalSubject = product ? `${product} discovery` : "discovery";
  return `
Call ${phoneNumber} in English (${locale}); destination region ${region}.
The recipient just submitted a website form and consented to be contacted at this number now.

GOAL: Have a welcoming, unhurried ${goalSubject} conversation. Be a good host: grateful they picked up, curious about their world. Learn what they need. Do not book a calendar slot. Do not make this feel like a screening or evaluation call.

IDENTITY: This is an automated assistant. Do not pose as a human sales rep. Open with: "${opening}"${role}${tone}${playbook}

SILENT OBJECTIVES — never say these aloud, never ask them as questions:
- Whether they are a qualified lead or need a human rep.
- Internal intent score, clickstream, or that this call is to evaluate them.
- Whether they want a human follow-up. Do not ask. Do not confirm. Do not promise a rep will reach out.
If they themselves ask for a person, say you will pass the note along. Only then.

CONTEXT for your questions only. Never recite tracking or page-hit counts. Do not say you watched them browse.
- Recipient name if provided: ${who}
- Company if provided: ${company}
- Identify the lead by email internally; do not read the email aloud unless asked: ${contactEmail || "not provided"}
- Declared interest themes: ${themes}
- Optional use case they typed: ${ctx.useCase || "not provided"}
- Optional company size they typed: ${ctx.companySize || "not provided"}
- Internal intent level (do not mention the score): ${ctx.intent?.level || "unknown"}

${collectSection(ctx)}

EXTRACT (silent, never say aloud): Fill the result schema from what they actually said. primary_pain should name the pain in their words, never a call-status summary.

CLOSE: When you are done, speak this wrap-up and then end. Do not hang up on a bare bye. Do not ask if they want a human. Do not promise a person will call. Close with: "${closing}"
`.trim();
}

function collectSection(ctx: LiveCallContext): string {
  const goals = (ctx.activeGoals || []).filter((goal) => goal.enabled !== false);
  if (goals.length === 0) {
    return `COLLECT conversationally, one question at a time:
1. Why they are interested now and the use case.
2. Team or user count, current tool.
3. Pain points and urgency / timeline.
4. Buying role and decision process.
5. Competitors or alternatives.
6. Questions or objections.`;
  }

  const lines = goals.map((goal, index) => {
    const trigger = goal.naturalTrigger ? ` Natural trigger: ${goal.naturalTrigger}.` : "";
    const example = goal.exampleAsk ? ` Example ask: "${goal.exampleAsk}"` : "";
    const guidance = goal.guidance ? ` ${goal.guidance}` : "";
    return `${index + 1}. ${goal.label} [${goal.priority}] (field: ${goal.targetField}).${guidance}${trigger}${example}`;
  });

  return `COLLECT conversationally, one question at a time. Listen first; do not recite clickstream; seek context before asking. Active discovery goals (opportunistic, not a rigid script):
${lines.join("\n")}
Also cover buying role and objections if they come up naturally. Do not ask whether they want a human.`;
}

function questionList(details: Record<string, unknown>): string[] {
  const raw = details.questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function sanitizeCalleText(text: string): string {
  return text.replace(/\+[1-9]\d{6,14}/g, (match) => maskPhoneNumber(match));
}

export function publicCalleError(err: unknown): string {
  if (err instanceof CalleAPIError) {
    const questions = questionList(err.details);
    const detail = questions.length > 0 ? questions.join(" ") : err.message;
    const cleaned = sanitizeCalleText(detail).trim();

    if (err.code === "call_not_ready") {
      return `CALL-E needs a clarification before it will dial: ${cleaned || "answer the language/region question in the call task."}`;
    }
    if (err.code === "unsupported_region" || err.code === "unsupported_language") {
      return `CALL-E cannot place this call (${err.code}). ${cleaned}`.trim();
    }
    if (err.code === "invalid_phone" || err.code === "invalid_recipient") {
      return "CALL-E rejected the phone number. Use E.164, for example +6555501010.";
    }
    if (err.code === "insufficient_balance") {
      return "CALL-E rejected the call because the account has insufficient balance.";
    }
    return sanitizeCalleText(
      `CALL-E rejected the call (${err.status} ${err.code}). ${cleaned}`.trim()
    );
  }
  if (err instanceof Error) {
    if (/fetch failed/i.test(err.message) || /ENOTFOUND|ECONNREFUSED|certificate/i.test(err.message)) {
      return "Could not reach CALL-E. Confirm CALLE_LIVE, the API key, and network access to api.heycall-e.com.";
    }
    return sanitizeCalleText(err.message);
  }
  return "Failed to dispatch CALL-E call.";
}

export function liveCalleCreateInput(
  phoneNumber: string,
  session: WebSessionContext,
  contactName?: string,
  contactEmail?: string,
  ctx: LiveCallContext = {}
): CreateCallInput {
  const { region, locale } = regionFromE164(phoneNumber);
  return {
    task: buildLiveCallTask(phoneNumber, session, contactName, contactEmail, ctx),
    recipients: [{ phones: [phoneNumber], region, locale }],
    resultSchema: discoveryResultSchema(ctx.activeGoals || []),
    recipientResultSchema: RECIPIENT_RESULT_SCHEMA,
    metadata: { source: "sundials" }
  };
}

export async function dispatchLiveCalleCall(
  phoneNumber: string,
  session: WebSessionContext,
  contactName?: string,
  contactEmail?: string,
  idempotencyKey?: string,
  ctx: LiveCallContext = {}
): Promise<{ success: boolean; calleId?: string; error?: string }> {
  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) {
    return { success: false, error: "CALLE_API_KEY not configured. Running in fixture dry-run mode." };
  }
  const phoneCheck = validatePhoneNumber(phoneNumber);
  if (!phoneCheck.valid) {
    return { success: false, error: phoneCheck.error || "Invalid phone number." };
  }

  try {
    const client = new CalleClient({
      apiKey,
      baseUrl: safeCalleBaseUrl()
    });
    const call = await client.calls.create(
      liveCalleCreateInput(phoneNumber, session, contactName, contactEmail, ctx),
      idempotencyKey ? { idempotencyKey } : undefined
    );
    return { success: true, calleId: call.id };
  } catch (err: unknown) {
    return { success: false, error: publicCalleError(err) };
  }
}

export async function fetchLiveCalleCall(calleCallId: string): Promise<Call | null> {
  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new CalleClient({
      apiKey,
      baseUrl: safeCalleBaseUrl()
    });
    return await client.calls.get(calleCallId);
  } catch {
    return null;
  }
}
