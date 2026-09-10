import type { AuditEvent } from "@muster/domain";

export type AuditEventAppendResult = Readonly<{
  outcome: "appended" | "replayed";
  event: AuditEvent;
}>;

export interface AuditEventRepository {
  append(event: AuditEvent): Promise<AuditEventAppendResult>;
}
