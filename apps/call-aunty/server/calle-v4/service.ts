import type { CalleCall, CreateCallInput, Provider } from "./types";
import type { CallRepository } from "./repository";
import { validateSchema, DEFAULT_RESULT_SCHEMA, DEFAULT_RECIPIENT_RESULT_SCHEMA } from "./schema";
import { requestKey, stableKey } from "./idempotency";
import { consentGranted, enforcePolicy, regionFromMetadata } from "./policy";
import type { CalleV4Config } from "./config";
import { safeMetadata } from "./redact";

export class CallService {
  constructor(
    private readonly provider: Provider,
    private readonly repo: CallRepository,
    private readonly config?: Pick<CalleV4Config, "allowedRegions">,
  ) {}

  async create(
    userId: string,
    input: Omit<CreateCallInput, "idempotencyKey">,
  ): Promise<CalleCall> {
    if (!input.task?.trim()) {
      throw new Error("Task is required");
    }
    const resultSchema = input.resultSchema ?? DEFAULT_RESULT_SCHEMA;
    const recipientResultSchema = input.recipientResultSchema ?? DEFAULT_RECIPIENT_RESULT_SCHEMA;
    validateSchema(resultSchema);
    validateSchema(recipientResultSchema);

    const phones = (input.recipients ?? []).flatMap((recipient) => recipient.phones);
    const normalized = enforcePolicy(input.task, phones, undefined, {
      consent: consentGranted(input.metadata),
      region: regionFromMetadata(input.metadata),
      allowedRegions: this.config?.allowedRegions,
    });
    const recipients = [{ phones: normalized, metadata: input.recipients?.[0]?.metadata }];
    const metadata = safeMetadata(input.metadata ?? {});
    const clientRequestId = input.metadata?.client_request_id ?? randomId();
    const key = requestKey(userId, clientRequestId);
    const requestHash = stableKey([input.task, normalized.join(","), clientRequestId]);

    const existing = await this.repo.getIdempotency(key);
    if (existing) {
      const cached = await this.repo.getCall(existing.callId);
      if (cached) return cached;
    }

    const call = await this.provider.createCall({
      ...input,
      recipients,
      resultSchema,
      recipientResultSchema,
      metadata: { ...metadata, client_request_id: clientRequestId },
      idempotencyKey: key,
    });
    await this.repo.putCall(call, userId);
    await this.repo.putIdempotency(key, call.id, requestHash);
    return call;
  }

  async refresh(id: string): Promise<CalleCall> {
    const call = await this.provider.getCall(id);
    await this.repo.putCall(call);
    return call;
  }

  async getLocal(id: string): Promise<CalleCall | null> {
    return this.repo.getCall(id);
  }

  async list(userId?: string): Promise<CalleCall[]> {
    return this.repo.listCalls(userId);
  }

  async events(id: string) {
    return this.repo.listEvents(id);
  }

  async reconcile(id: string) {
    const remote = await this.provider.getCall(id);
    const local = await this.repo.getCall(id);
    await this.repo.putCall(remote);
    return {
      remote,
      local,
      changed: !local || local.status !== remote.status,
    };
  }
}

function randomId(): string {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
