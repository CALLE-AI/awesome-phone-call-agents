import { z } from "zod";

export const previewInputSchema = z.object({
  companyId: z.string().uuid(),
  memberId: z.string().uuid(),
  mode: z.enum(["deposit", "catchup", "ask"]),
});

export const confirmInputSchema = z.object({
  previewId: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export const supportedCalleRegions = new Set(["US", "SG", "MY", "IN", "AE", "AU", "CA", "GB", "VN", "DE", "JP", "FR", "MX", "BR", "ID", "PH", "KE"]);

export const modeConfig = {
  deposit: { purpose: "Capture what changed and convert only supported statements into typed company memory.", duration: "About 4 minutes", questions: ["What changed since your last update?", "Is each point a fact, idea, assumption, proposal, decision, question or task?", "What evidence supports it?", "Who needs to hear, approve or own the next action?"] },
  catchup: { purpose: "Brief this member on the smallest relevant unseen company delta and record their response.", duration: "About 3 minutes", questions: ["Which unseen decisions or blockers do you acknowledge?", "Which claim needs correction or stronger evidence?", "Do you dispute, defer or supersede anything?"] },
  ask: { purpose: "Carry one unresolved company question to the teammate most able to answer it.", duration: "About 2 minutes", questions: ["What is your answer to the unresolved question?", "What evidence, constraint or uncertainty should the team retain?"] },
} as const;

export type CallMode = keyof typeof modeConfig;

export const memoryResultValidator = z.object({
  outcome: z.enum(["complete", "partial", "no_usable_evidence", "unknown"]),
  memory_items: z.array(z.object({
    type: z.enum(["fact", "idea", "assumption", "decision", "question", "task", "conflict"]),
    title: z.string().min(2).max(180), body: z.string().min(2).max(4000),
    status: z.enum(["open", "proposed", "accepted", "answered", "resolved", "dismissed"]),
    confidence: z.enum(["high", "medium", "low", "unknown"]),
    source_excerpt: z.string().trim().min(8).max(800), audience: z.array(z.string().max(80)).max(30),
  })).max(30),
  unresolved_questions: z.array(z.string().trim().min(2).max(500)).max(20),
});

export const recipientResultSchema = {
  type: "object", additionalProperties: false, required: ["outcome", "memory_items", "unresolved_questions"],
  properties: {
    outcome: { type: "string", enum: ["complete", "partial", "no_usable_evidence", "unknown"] },
    memory_items: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false, required: ["type", "title", "body", "status", "confidence", "source_excerpt", "audience"], properties: {
      type: { type: "string", enum: ["fact", "idea", "assumption", "decision", "question", "task", "conflict"] },
      title: { type: "string" }, body: { type: "string" },
      status: { type: "string", enum: ["open", "proposed", "accepted", "answered", "resolved", "dismissed"] },
      confidence: { type: "string", enum: ["high", "medium", "low", "unknown"] },
      source_excerpt: { type: "string", minLength: 8 }, audience: { type: "array", items: { type: "string" } },
    } } },
    unresolved_questions: { type: "array", items: { type: "string", minLength: 2 } },
  },
};

export function buildTask(input: { companyName: string; memberName: string; mode: CallMode; briefing?: string }) {
  const config = modeConfig[input.mode];
  return [
    "You are AsyncFounders, an AI callback interviewer for a verified member of a private company workspace.",
    "At the start, identify yourself as an AI and confirm the person is willing to continue.",
    "Do not make commitments, purchases, schedules, promises, or external actions.",
    "Never invent another teammate's belief. Preserve uncertainty and disagreement.",
    "Do not promote brainstorming into a decision or assign a task without an explicit owner.",
    `Company: ${input.companyName}`, `Member: ${input.memberName}`, `Purpose: ${config.purpose}`,
    input.briefing ? `Approved context:\n${input.briefing}` : "Approved context: No additional company details are required for this call.",
    "Ask only these approved questions:", ...config.questions.map((question, index) => `${index + 1}. ${question}`),
    "Return only evidence-supported memory. Put unknowns into unresolved_questions.",
  ].join("\n");
}

export async function fingerprint(value: object) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function maskPhone(phone: string | null, lastFour: string | null) { return phone ? `${phone.slice(0, 3)} •••••• ${phone.slice(-4)}` : `•••• ${lastFour ?? "—"}`; }
export function confidenceNumber(value: string) { return value === "high" ? 0.9 : value === "medium" ? 0.7 : value === "low" ? 0.4 : 0.25; }
