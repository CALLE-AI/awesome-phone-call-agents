import type { W3CTraceContext } from "@muster/contracts";

interface TwilioSyntheticRequest {
  readonly requestUrl: string;
  readonly callbackHandle?: string;
  readonly twilioSignature: string;
  readonly form: Readonly<Record<string, string>>;
  readonly traceContext: W3CTraceContext;
}

interface TwilioSyntheticResponse {
  readonly statusCode: number;
  readonly contentType: "application/xml" | "text/plain";
  readonly body: string;
}

interface TwilioSyntheticEndpoint {
  handleVoice(input: TwilioSyntheticRequest): Promise<TwilioSyntheticResponse>;
  handleCanary(input: TwilioSyntheticRequest): Promise<TwilioSyntheticResponse>;
  handleStatus(input: TwilioSyntheticRequest): Promise<TwilioSyntheticResponse>;
}

export class TwilioSimulatorController {
  public constructor(private readonly endpoint: TwilioSyntheticEndpoint) {}

  public async voice(request: TwilioSyntheticRequest): Promise<TwilioSyntheticResponse> {
    return await this.endpoint.handleVoice(request);
  }

  public async canary(request: TwilioSyntheticRequest): Promise<TwilioSyntheticResponse> {
    return await this.endpoint.handleCanary(request);
  }

  public async status(request: TwilioSyntheticRequest): Promise<TwilioSyntheticResponse> {
    return await this.endpoint.handleStatus(request);
  }
}
