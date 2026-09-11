// Batch "compare across N places" — the power feature. Runs the SAME verified-goal
// against several recipients (CALL-E `recipients[]`) and reconciles into a ranking.
//
// The honesty thesis carries into the batch: a place is only ELIGIBLE to be
// recommended when its gating fact AND its comparison value are both *verified*
// (grounded in what that callee actually said). An unverified price never wins.

import { assertE164 } from "./phone";
import { verifyOutcome, type VerifyOptions } from "./verify";
import type { CalleLike, VerifiedOutcome, CreateCallInput } from "./types";

export interface BatchRecipient {
  id: string;
  label: string;
  phone: string;
}

export interface BatchItemResult {
  recipient: BatchRecipient;
  outcome: VerifiedOutcome;
}

export interface RankSpec {
  /** Field that must be verified AND equal `gateEquals` for a place to qualify. */
  gateKey?: string;
  gateEquals?: string;
  /** Verified field to order qualifying places by. */
  compareKey?: string;
  kind?: "price" | "number";
  direction?: "asc" | "desc";
  /** Human sentence describing the ranking, for the UI. */
  describe: string;
}

export interface BatchOutcome {
  items: BatchItemResult[];
  rankedBy: string;
  /** The field the ranking compared on (e.g. "price"), so a UI can surface it per place. */
  rankKey?: string;
  /** Recipient id of the recommended pick, or null when none can be confirmed. */
  bestId: string | null;
  reason: string;
}

export interface VerifiedBatchRequest {
  task: string;
  recipients: BatchRecipient[];
  resultSchema?: Record<string, unknown>;
  requestedKeys: string[];
  rank: RankSpec;
  verify?: VerifyOptions;
}

export async function runVerifiedBatch(
  client: CalleLike,
  req: VerifiedBatchRequest,
): Promise<BatchOutcome> {
  req.recipients.forEach((r) => assertE164(r.phone));

  const items: BatchItemResult[] = [];
  for (const recipient of req.recipients) {
    const input: CreateCallInput = { task: req.task, phone: recipient.phone };
    if (req.resultSchema !== undefined) input.resultSchema = req.resultSchema;
    input.idempotencyKey = `batch-${recipient.id}`;
    const result = await client.calls.createAndWait(input);
    items.push({ recipient, outcome: verifyOutcome(result, req.requestedKeys, req.verify) });
  }

  const { bestId, reason } = reconcile(items, req.rank);
  return { items, rankedBy: req.rank.describe, ...(req.rank.compareKey ? { rankKey: req.rank.compareKey } : {}), bestId, reason };
}

function verifiedValue(item: BatchItemResult, key: string): string | null {
  const f = item.outcome.fields.find((x) => x.key === key);
  return f && f.status === "verified" ? String(f.value) : null;
}

function reconcile(items: BatchItemResult[], rank: RankSpec): { bestId: string | null; reason: string } {
  const eligible = items.filter((item) => {
    if (rank.gateKey) {
      const v = verifiedValue(item, rank.gateKey);
      if (v === null) return false; // gate not verified
      if (rank.gateEquals && v.toLowerCase() !== rank.gateEquals.toLowerCase()) return false;
    }
    if (rank.compareKey && verifiedValue(item, rank.compareKey) === null) return false; // compare value not verified
    return true;
  });

  if (eligible.length === 0) {
    return { bestId: null, reason: "No place could be confirmed to meet what you asked — call them yourself to be sure." };
  }

  if (!rank.compareKey) {
    const only = eligible[0]!;
    return { bestId: only.recipient.id, reason: `${only.recipient.label} — confirmed.` };
  }

  const dir = rank.direction ?? "asc";
  const sorted = [...eligible].sort((a, b) => {
    const av = parseComparable(verifiedValue(a, rank.compareKey!)!);
    const bv = parseComparable(verifiedValue(b, rank.compareKey!)!);
    return dir === "asc" ? av - bv : bv - av;
  });
  const best = sorted[0]!;
  const bestVal = verifiedValue(best, rank.compareKey)!;
  return {
    bestId: best.recipient.id,
    reason: `${best.recipient.label} — ${bestVal}, confirmed on the call (the only choices ranked are ones we could verify).`,
  };
}

/** Pull the first number out of a string like "$4.20" or "about 40" → 4.2 / 40. */
export function parseComparable(s: string): number {
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : Number.POSITIVE_INFINITY;
}
