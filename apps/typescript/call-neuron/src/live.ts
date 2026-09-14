import { callMcp, toolNames, type McpReply, type PendingLogin } from "./api";
import type { Recipient } from "./campaign";

export type OfferBrief = {
  organization: string;
  offer: string;
  details: string;
  callbackPhone: string;
  escalation: string;
};

export type CallEConnection = {
  accessToken: string;
  sessionId: string;
};

export type ReviewedPlan = {
  planId: string;
  confirmToken: string;
  expiresAt: string;
  instruction: string;
};

export type CallRun = {
  runId: string;
  status: string;
  summary: string;
  transcript: string;
  attemptedAt: string;
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function structured(reply: McpReply) {
  const result = reply.body?.result;
  if (!object(result) || !object(result.structuredContent)) {
    throw new Error("CALL-E returned no structured result.");
  }
  return result.structuredContent;
}

function required(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (typeof field !== "string" || !field) throw new Error(`CALL-E omitted ${key}.`);
  return field;
}

export function buildCallInstruction(recipient: Recipient, offer: OfferBrief, voicemail: boolean) {
  const voicemailRule = voicemail
    ? `If nobody answers, leave only: "Hello. This is an automated assistant calling for ${offer.organization}. Please call us back at ${offer.callbackPhone}. Thank you." Do not mention the student or scholarship.`
    : "If nobody answers, do not leave a voicemail.";
  return [
    `Call only ${recipient.phone} in Malaysia, in English, one time.`,
    "Use a warm, respectful, patient tone. Sound like a helpful education coordinator, never abrupt, demanding, overly casual, or sales-like. Respond promptly with short natural sentences, avoid filler and long pauses, and let the recipient finish speaking before replying.",
    `Begin politely: "Hello, my name is CallNeuron. I am an automated assistant calling on behalf of ${offer.organization}. I am calling to share an education-support opportunity and to see whether you would like a human staff member to explain it." Then state that CALL-E will process and transcribe the call and ask, "Would it be alright to continue?"`,
    `Before mentioning the student or offer, confirm you are speaking with ${recipient.recipientName}. If identity or permission is not confirmed, disclose nothing further and end politely.`,
    `After confirmation, explain the approved opportunity clearly: ${offer.offer} ${offer.details}`,
    "Pause for questions. Answer only from the approved opportunity details. If the answer is not in the brief, say politely that a human staff member will explain it and ask what detail they would like the staff member to cover.",
    "Ask clearly: \"Would you be interested in speaking with a staff member about this opportunity?\" Accept interested, not interested, or needs more information without pressure.",
    `If interested, respond warmly: "Thank you for your interest. A human staff member from ${offer.organization} will contact you shortly to guide you through the details." Then ask for a preferred callback time and whether there is anything specific they would like the staff member to explain.`,
    "If they need more information, ask for the main question they want answered, confirm that it has been noted, and say a human staff member will follow up shortly. If they are not interested or opt out, thank them, acknowledge the choice without persuasion, and end politely.",
    `Do not decide eligibility, promise an award, change terms, collect grades, finances, identity documents, payment, or application evidence. Escalate to staff for: ${offer.escalation}.`,
    voicemailRule,
    "Do not retry, schedule another call, or call any other number. This instruction is complete and ready_to_run after operator confirmation.",
  ].join(" ");
}

export async function initializeCallE(accessToken: string): Promise<CallEConnection> {
  const initialized = await callMcp(accessToken, "initialize");
  await callMcp(accessToken, "notifications/initialized", { mcpSessionId: initialized.sessionId });
  const tools = await callMcp(accessToken, "tools/list", { mcpSessionId: initialized.sessionId });
  const names = toolNames(tools);
  for (const requiredTool of ["plan_call", "run_call", "get_call_run"]) {
    if (!names.includes(requiredTool)) throw new Error(`CALL-E is missing ${requiredTool}.`);
  }
  return { accessToken, sessionId: initialized.sessionId };
}

export async function createReviewedPlan(
  connection: CallEConnection,
  recipient: Recipient,
  offer: OfferBrief,
  voicemail: boolean
): Promise<ReviewedPlan> {
  if (recipient.status !== "eligible") throw new Error("Blocked recipients cannot enter CALL-E planning.");
  if (!/^\+[1-9]\d{7,14}$/u.test(recipient.phone)) throw new Error("The selected phone is not valid E.164.");
  const instruction = buildCallInstruction(recipient, offer, voicemail);
  const reply = await callMcp(connection.accessToken, "tools/call", {
    mcpSessionId: connection.sessionId,
    params: {
      name: "plan_call",
      arguments: {
        to_phones: [recipient.phone],
        region: "MY",
        language: "English",
        goal: instruction,
        user_input: instruction,
        ttl_seconds: 86_400,
      },
    },
  });
  const result = structured(reply);
  if (result.ready_to_run !== true) {
    throw new Error("CALL-E needs clarification. Edit the reviewed brief before trying again; no call was started.");
  }
  return {
    planId: required(result, "plan_id"),
    confirmToken: required(result, "confirm_token"),
    expiresAt: typeof result.confirm_expires_at === "string" ? result.confirm_expires_at : "Short-lived confirmation",
    instruction,
  };
}

export async function startReviewedCall(connection: CallEConnection, plan: ReviewedPlan): Promise<CallRun> {
  const reply = await callMcp(connection.accessToken, "tools/call", {
    mcpSessionId: connection.sessionId,
    params: {
      name: "run_call",
      arguments: { plan_id: plan.planId, confirm_token: plan.confirmToken, ttl_seconds: 86_400 },
    },
  });
  const result = structured(reply);
  return {
    runId: required(result, "run_id"),
    status: typeof result.status === "string" ? result.status : "QUEUED",
    summary: "CALL-E accepted the one-recipient call.",
    transcript: "",
    attemptedAt: new Date().toISOString(),
  };
}

export async function refreshCallRun(connection: CallEConnection, run: CallRun): Promise<CallRun> {
  const reply = await callMcp(connection.accessToken, "tools/call", {
    mcpSessionId: connection.sessionId,
    params: { name: "get_call_run", arguments: { run_id: run.runId, limit: 50 } },
  });
  const result = structured(reply);
  return {
    runId: required(result, "run_id"),
    status: typeof result.status === "string" ? result.status : "UNKNOWN",
    summary: typeof result.post_summary === "string" ? result.post_summary : run.summary,
    transcript: typeof result.transcript === "string" ? result.transcript : run.transcript,
    attemptedAt: run.attemptedAt,
  };
}

export type LiveLogin = PendingLogin;
