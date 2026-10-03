/**
 * T7.4 post-call receipt caller.
 *
 * Builds captured, retired and committed texts from structured result data,
 * then calls `deliverPostCallTelegram`. Never invents counts.
 *
 * A run with no result still sends a receipt. A null or invalid structured
 * result yields empty lists, which reveal no extraction failure and ask for
 * nothing.
 *
 * T7.3 owns analysis delivery. After a pattern report is stored, call
 * `deliverPatternTelegram` with the validated prose. This file does not.
 *
 * Pin with:
 * `deno test --allow-read supabase/functions/_shared/receipt.ts supabase/functions/_shared/receipt_tests.ts`
 */
import {
  capturedTextsFromStructured,
  deliverPostCallTelegram,
  retiredItemIdsFromStructured,
  type DeliverResult,
  type DeliverTelegramDeps,
} from "./deliver-telegram.ts";

export type ResolveRetiredText = (itemId: string) => Promise<string | null>;

export type PostCallReceiptInput = {
  userId: string;
  callRunId: string;
  structured: unknown;
  resolveRetiredText?: ResolveRetiredText;
};

/**
 * Extract commitment item ids from a CALL-E structured_result shaped object.
 * A commitment names an item id and an evidence offset.
 */
function committedItemIdsFromStructured(structured: unknown): string[] {
  if (
    structured === null ||
    typeof structured !== "object" ||
    Array.isArray(structured)
  ) {
    return [];
  }
  const commitments = (structured as { commitments?: unknown }).commitments;
  if (!Array.isArray(commitments)) return [];
  const ids: string[] = [];
  for (const item of commitments) {
    if (
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as { item_id?: unknown }).item_id === "string"
    ) {
      ids.push((item as { item_id: string }).item_id);
    }
  }
  return ids;
}

export async function deliverIngestionReceipt(
  input: PostCallReceiptInput,
  deps: DeliverTelegramDeps,
): Promise<DeliverResult> {
  const capturedTexts = capturedTextsFromStructured(input.structured);
  const retiredIds = retiredItemIdsFromStructured(input.structured);
  const committedIds = committedItemIdsFromStructured(input.structured);
  const retiredTexts: string[] = [];
  const committedTexts: string[] = [];
  if (input.resolveRetiredText) {
    for (const itemId of retiredIds) {
      const text = await input.resolveRetiredText(itemId);
      if (typeof text === "string" && text !== "") retiredTexts.push(text);
    }
    for (const itemId of committedIds) {
      const text = await input.resolveRetiredText(itemId);
      if (typeof text === "string" && text !== "") committedTexts.push(text);
    }
  }
  return deliverPostCallTelegram(
    {
      userId: input.userId,
      callRunId: input.callRunId,
      capturedTexts,
      retiredTexts,
      committedTexts,
    },
    deps,
  );
}
