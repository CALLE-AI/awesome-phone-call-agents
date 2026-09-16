import type { SmsAdapter, SmsRequest, SmsResult } from "./contracts";

export class PreviewSmsAdapter implements SmsAdapter {
  async send(request: SmsRequest): Promise<SmsResult> {
    void request;
    return { status: "previewed" };
  }
}
