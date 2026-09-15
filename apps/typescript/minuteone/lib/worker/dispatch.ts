import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { leads } from "../db/schema";
import { loadBusinessConfig } from "../config/load";
import type { BusinessConfig } from "../config/schema";
import { buildCallTask } from "../call/task-builder";
import { getCallProvider } from "../call";
import type { CallResult } from "../call/provider";
import { scoreAnswers } from "../lead/score";
import type { LeadAnswer, LeadOutcome, NextAction } from "../lead/schema";
import { isWithinBusinessHours } from "./hours";

const MAX_RETRIES = 1;

/**
 * The single shared dispatch core. Called by the local setInterval poller in dev, and by the
 * Netlify scheduled function in the deployed instance — same logic either way.
 */
export async function dispatchLead(leadId: string): Promise<void> {
  // Atomically claim the lead: the UPDATE's WHERE clause re-checks status='pending' in the same
  // statement as the write, so two overlapping ticks (local poller + a slow-running previous
  // tick, or concurrent invocations) can't both claim and dispatch the same lead — only the one
  // whose UPDATE actually matches a row proceeds. A separate SELECT-then-UPDATE would leave a
  // race window where both readers see "pending" before either writes "in_progress".
  const [lead] = await db
    .update(leads)
    .set({ status: "in_progress", updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.status, "pending")))
    .returning();
  if (!lead) return;

  if (!lead.consent) {
    await db
      .update(leads)
      .set({ status: "failed", summary: "Missing consent — never dispatched.", updatedAt: new Date() })
      .where(eq(leads.id, leadId));
    return;
  }

  const config = await loadBusinessConfig();
  if (!isWithinBusinessHours(config.businessHours)) {
    // Release the claim back to "pending" so the next poll/sweep tick can pick it up.
    await db.update(leads).set({ status: "pending", updatedAt: new Date() }).where(eq(leads.id, leadId));
    return;
  }

  const provider = getCallProvider();
  const { task, resultSchema } = buildCallTask(config, lead.name);

  let result: CallResult;
  try {
    result = await provider.placeCall({ phone: lead.phone, task, resultSchema });
  } catch (err) {
    // A thrown error (network/auth/MCP failure) must not leave the lead stuck in "in_progress"
    // forever — the poller only ever re-selects "pending" leads.
    const message = err instanceof Error ? err.message : String(err);
    result = { connectionStatus: "failed", structuredResult: null, evidence: [message], callId: "error", durationS: 0 };
  }

  const mapped = mapResult(config, result);

  const shouldRetry =
    (result.connectionStatus === "no_answer" || result.connectionStatus === "voicemail") &&
    lead.retryCount < MAX_RETRIES;

  if (shouldRetry) {
    await db
      .update(leads)
      .set({ status: "pending", retryCount: lead.retryCount + 1, updatedAt: new Date() })
      .where(eq(leads.id, leadId));
    return;
  }

  await db
    .update(leads)
    .set({
      status: "done",
      outcome: mapped.outcome,
      nextAction: mapped.nextAction,
      answers: mapped.answers,
      score: mapped.score,
      summary: mapped.summary,
      callId: result.callId,
      durationS: result.durationS,
      transcriptRef: result.transcriptRef,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));
}

interface MappedResult {
  outcome: LeadOutcome;
  nextAction: NextAction;
  answers: LeadAnswer[];
  score: number;
  summary: string;
}

function mapResult(config: BusinessConfig, result: CallResult): MappedResult {
  if (result.connectionStatus !== "completed") {
    const outcome: LeadOutcome =
      result.connectionStatus === "wrong_number"
        ? "wrong_number"
        : result.connectionStatus === "declined"
          ? "declined"
          : "no_answer"; // voicemail and failed both collapse here
    return { outcome, nextAction: "drop", answers: [], score: 0, summary: result.evidence.join(" ") };
  }

  const structured = result.structuredResult ?? {};

  if (structured.declined_conversation === true) {
    return { outcome: "declined", nextAction: "drop", answers: [], score: 0, summary: result.evidence.join(" ") };
  }
  if (structured.reached_person === false) {
    return { outcome: "no_answer", nextAction: "drop", answers: [], score: 0, summary: result.evidence.join(" ") };
  }

  const { answers, score } = scoreAnswers(config, structured);
  const summary = result.evidence.join(" ");

  if (structured.wants_callback_later === true) {
    return { outcome: "callback_requested", nextAction: "nurture", answers, score, summary };
  }

  const qualified = score >= config.qualifyingScore;
  return {
    outcome: qualified ? "qualified" : "not_qualified",
    nextAction: qualified ? "book_meeting" : "nurture",
    answers,
    score,
    summary,
  };
}
