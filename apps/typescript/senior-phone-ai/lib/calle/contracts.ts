export interface OutboundCallIntent {
  readonly destinationE164: string;
  readonly purpose: string;
  readonly idempotencyKey: string;
}

export interface OutboundCallPreview {
  readonly status: "previewed";
  readonly idempotencyKey: string;
}

export interface OutboundCallAdapter {
  plan(intent: OutboundCallIntent): Promise<OutboundCallPreview>;
}
