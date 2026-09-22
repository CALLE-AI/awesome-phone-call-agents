import {
  DEMO_QUEUE,
  type ChwQueueRecord,
  type DemoQueueItem,
  type QueueTone,
} from "./demo-queue";

/** @deprecated Use `demo-queue` for production screens. */
export { DEMO_QUEUE as CHW_DEMO_QUEUE, type QueueTone as ChwQueueTone };

/**
 * Legacy mobile fixtures historically showed the raw queue id when a localized row
 * was missing. Keep that behavior isolated here while current CHW screens use the
 * safer localized-copy fallback in `demo-queue`.
 */
export function getChwQueueRecord(
  records: readonly ChwQueueRecord[] | undefined,
  item: Pick<DemoQueueItem, "id">,
  index?: number,
): ChwQueueRecord {
  const resolvedIndex = index ?? DEMO_QUEUE.findIndex((row) => row.id === item.id);
  const record = resolvedIndex >= 0 ? records?.[resolvedIndex] : undefined;
  if (record?.name.trim()) return record;
  return { name: item.id, meta: "", urgency: "", nextAction: "" };
}
