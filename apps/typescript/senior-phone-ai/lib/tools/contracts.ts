export type DeliveryStatus = "previewed" | "queued" | "sent" | "failed" | "unknown";

export interface SmsRequest {
  readonly destinationE164: string;
  readonly idempotencyKey: string;
  readonly message: string;
}

export interface SmsResult {
  readonly status: DeliveryStatus;
  readonly providerMessageId?: string;
}

export interface SmsAdapter {
  send(request: SmsRequest): Promise<SmsResult>;
}

export interface SmsDeliveryEvent {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly providerMessageId: string;
  readonly status: "sent" | "failed";
}

export interface SmsDeliveryVerifier {
  verify(rawBody: string, headers: Readonly<Record<string, string>>): SmsDeliveryEvent;
}
