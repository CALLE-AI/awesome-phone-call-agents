import { householdsToQueue } from "@/lib/mock-households";
import type { QueueTone } from "@/lib/queue-types";

export type { QueueTone } from "@/lib/queue-types";

export type DemoQueueItem = {
  id: string;
  tone: QueueTone;
};

export type ChwQueueRecord = {
  name: string;
  meta: string;
  urgency: string;
  nextAction: string;
};

export const DEMO_QUEUE: DemoQueueItem[] = householdsToQueue();

export function getChwQueueRecord(
  records: readonly ChwQueueRecord[] | undefined,
  item: { id: string },
  index?: number,
): ChwQueueRecord {
  const resolvedIndex = index ?? DEMO_QUEUE.findIndex((row) => row.id === item.id);
  const record = resolvedIndex >= 0 ? records?.[resolvedIndex] : undefined;
  if (record?.name.trim()) return record;
  return {
    name: item.id,
    meta: "",
    urgency: "",
    nextAction: "",
  };
}
