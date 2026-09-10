export type DeliveryStatus = "previewed" | "queued" | "sent" | "failed";

export interface SmsRequest {
  readonly destinationE164: string;
  readonly message: string;
}

export interface SmsResult {
  readonly status: DeliveryStatus;
  readonly providerMessageId?: string;
}

export interface SmsAdapter {
  send(request: SmsRequest): Promise<SmsResult>;
}
