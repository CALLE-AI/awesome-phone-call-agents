import type { CallService } from "./service";
import type { CalleCall, CreateCallInput } from "./types";

export type BatchItem = Omit<CreateCallInput, "idempotencyKey"> & { clientRequestId: string };

export async function createBatch(
  service: CallService,
  userId: string,
  items: BatchItem[],
): Promise<CalleCall[]> {
  const out: CalleCall[] = [];
  for (const item of items) {
    out.push(
      await service.create(userId, {
        ...item,
        metadata: { ...(item.metadata ?? {}), client_request_id: item.clientRequestId },
      }),
    );
  }
  return out;
}
