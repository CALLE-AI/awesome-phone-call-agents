import type { OutboundCallAdapter, OutboundCallIntent, OutboundCallPreview } from "./contracts";

export class PreviewOutboundCallAdapter implements OutboundCallAdapter {
  async plan(intent: OutboundCallIntent): Promise<OutboundCallPreview> {
    return { status: "previewed", idempotencyKey: intent.idempotencyKey };
  }
}
