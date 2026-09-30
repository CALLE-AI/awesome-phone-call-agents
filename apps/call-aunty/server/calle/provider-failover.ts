import type {
  CalleAdapter,
  FailoverAttempt,
  PlaceCallCommand,
  ProviderCallResult,
} from "./adapter";
import { classifyRetryError } from "./retry-policy";
import type { CallFailureCode } from "./types";

export type PhoneProviderId = "call-e" | "backup-phone-api" | "tertiary-phone-api" | (string & {});

export type PhoneProviderSlot = {
  id: PhoneProviderId;
  adapter: CalleAdapter;
};

export type ProviderCircuitState = "closed" | "open" | "half_open";

export type FailoverPolicy = {
  /** Open the circuit after this many consecutive unaccepted dials. Default 2. */
  openAfterConsecutiveFailures?: number;
  /** Milliseconds a provider stays open before a half-open probe. Default 30_000. */
  cooldownMs?: number;
  now?: () => number;
};

export type ProviderHealthSnapshot = {
  id: PhoneProviderId;
  circuit: ProviderCircuitState;
  consecutiveFailures: number;
  acceptedCalls: number;
  lastFailureCode: CallFailureCode | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
};

export type FailoverCalleAdapterOpts = {
  providers: PhoneProviderSlot[];
  policy?: FailoverPolicy;
};

type HealthRecord = {
  consecutiveFailures: number;
  acceptedCalls: number;
  openedAt: number | null;
  lastFailureCode: CallFailureCode | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
};

function unavailableResult(workflowId: string, providerId: PhoneProviderId): ProviderCallResult {
  return {
    providerCallId: `failed_${workflowId}`,
    status: "failed",
    structuredResult: null,
    failureCode: "provider_unavailable",
    phoneProviderId: providerId,
  };
}

/** True when a phone API accepted the dial — never fail over after this. */
export function wasCallAccepted(result: ProviderCallResult): boolean {
  if (!result.providerCallId) return false;
  if (result.providerCallId.startsWith("failed_")) return false;
  if (
    (result.status === "failed" || result.status === "unknown") &&
    (result.failureCode === "provider_unavailable" || result.failureCode === "timeout")
  ) {
    return false;
  }
  return true;
}

/** Provider outage / transport failure only. Policy and recipient outcomes stay put. */
export function isFailoverEligible(result: ProviderCallResult): boolean {
  if (wasCallAccepted(result)) return false;
  const errorClass = classifyRetryError({
    status: result.status,
    failureCode: result.failureCode,
  });
  return errorClass === "retryable_transport" || errorClass === "temporary_provider";
}

export function defaultFailoverPolicy(policy?: FailoverPolicy): Required<Omit<FailoverPolicy, "now">> & {
  now: () => number;
} {
  return {
    openAfterConsecutiveFailures: policy?.openAfterConsecutiveFailures ?? 2,
    cooldownMs: policy?.cooldownMs ?? 30_000,
    now: policy?.now ?? Date.now,
  };
}

function withProvider(
  result: ProviderCallResult,
  providerId: PhoneProviderId,
  attempts: FailoverAttempt[],
): ProviderCallResult {
  return {
    ...result,
    phoneProviderId: result.phoneProviderId ?? providerId,
    failoverAttempts: attempts,
  };
}

function emptyHealth(): HealthRecord {
  return {
    consecutiveFailures: 0,
    acceptedCalls: 0,
    openedAt: null,
    lastFailureCode: null,
    lastFailureAt: null,
    lastSuccessAt: null,
  };
}

/**
 * Ordered phone-API failover with a per-provider circuit breaker.
 * Tries the next provider only when the previous one never accepted the call
 * (outage / timeout). A persisted run_id is sticky so status and cancel never
 * place a second live dial. Open circuits are skipped until cooldown, then
 * probed half-open.
 */
export class FailoverCalleAdapter implements CalleAdapter {
  private readonly providers: PhoneProviderSlot[];
  private readonly policy: ReturnType<typeof defaultFailoverPolicy>;
  private readonly ownerByCallId = new Map<string, PhoneProviderId>();
  private readonly acceptedByIdempotency = new Map<string, ProviderCallResult>();
  private readonly health = new Map<PhoneProviderId, HealthRecord>();

  constructor(opts: FailoverCalleAdapterOpts) {
    if (opts.providers.length === 0) {
      throw new Error("FailoverCalleAdapter requires at least one phone provider.");
    }
    this.providers = opts.providers;
    this.policy = defaultFailoverPolicy(opts.policy);
    for (const slot of opts.providers) {
      this.health.set(slot.id, emptyHealth());
    }
  }

  private slot(id: PhoneProviderId): PhoneProviderSlot | undefined {
    return this.providers.find((slot) => slot.id === id);
  }

  private record(id: PhoneProviderId): HealthRecord {
    const existing = this.health.get(id);
    if (existing) return existing;
    const created = emptyHealth();
    this.health.set(id, created);
    return created;
  }

  circuitState(id: PhoneProviderId): ProviderCircuitState {
    const record = this.record(id);
    if (record.openedAt === null) return "closed";
    if (this.policy.now() - record.openedAt >= this.policy.cooldownMs) return "half_open";
    return "open";
  }

  /**
   * Preserve configured phone-API order, skipping fully open circuits.
   * Half-open providers stay in place so the primary can recover first.
   * If every circuit is open, probe in original order.
   */
  providersForPlace(): PhoneProviderSlot[] {
    const available = this.providers.filter((slot) => this.circuitState(slot.id) !== "open");
    return available.length > 0 ? available : [...this.providers];
  }

  private markSuccess(id: PhoneProviderId) {
    const record = this.record(id);
    record.consecutiveFailures = 0;
    record.acceptedCalls += 1;
    record.openedAt = null;
    record.lastFailureCode = null;
    record.lastSuccessAt = new Date(this.policy.now()).toISOString();
  }

  private markFailure(id: PhoneProviderId, failureCode: CallFailureCode | null) {
    const record = this.record(id);
    record.consecutiveFailures += 1;
    record.lastFailureCode = failureCode;
    record.lastFailureAt = new Date(this.policy.now()).toISOString();
    if (record.consecutiveFailures >= this.policy.openAfterConsecutiveFailures) {
      record.openedAt = this.policy.now();
    }
  }

  private remember(result: ProviderCallResult, providerId: PhoneProviderId, idempotencyKey?: string) {
    if (!wasCallAccepted(result)) return;
    this.ownerByCallId.set(result.providerCallId, providerId);
    if (idempotencyKey) {
      this.acceptedByIdempotency.set(idempotencyKey, result);
    }
  }

  getHealthSnapshot(): ProviderHealthSnapshot[] {
    return this.providers.map((slot) => {
      const record = this.record(slot.id);
      return {
        id: slot.id,
        circuit: this.circuitState(slot.id),
        consecutiveFailures: record.consecutiveFailures,
        acceptedCalls: record.acceptedCalls,
        lastFailureCode: record.lastFailureCode,
        lastFailureAt: record.lastFailureAt,
        lastSuccessAt: record.lastSuccessAt,
      };
    });
  }

  async placeFollowUpCall(command: PlaceCallCommand): Promise<ProviderCallResult> {
    const cached = this.acceptedByIdempotency.get(command.idempotencyKey);
    if (cached) return cached;

    const attempts: FailoverAttempt[] = [];
    const ordered = this.providersForPlace();

    for (const slot of ordered) {
      let result: ProviderCallResult;
      try {
        result = await slot.adapter.placeFollowUpCall(command);
      } catch {
        result = unavailableResult(command.workflowId, slot.id);
      }

      const accepted = wasCallAccepted(result);
      attempts.push({
        providerId: slot.id,
        accepted,
        status: result.status,
        failureCode: result.failureCode,
        providerCallId: result.providerCallId ?? null,
      });

      const tagged = withProvider(result, slot.id, attempts);
      if (accepted) {
        this.markSuccess(slot.id);
        this.remember(tagged, slot.id, command.idempotencyKey);
        return tagged;
      }

      this.markFailure(slot.id, result.failureCode);

      if (!isFailoverEligible(result)) {
        return tagged;
      }
    }

    const last = attempts[attempts.length - 1];
    return {
      providerCallId: last?.providerCallId ?? `failed_${command.workflowId}`,
      status: "failed",
      structuredResult: null,
      failureCode: (last?.failureCode ?? "provider_unavailable") as CallFailureCode,
      phoneProviderId: last?.providerId,
      failoverAttempts: attempts,
    };
  }

  async getStatus(providerCallId: string): Promise<ProviderCallResult> {
    const ownerId = this.ownerByCallId.get(providerCallId);
    const ordered = ownerId
      ? [
          this.slot(ownerId),
          ...this.providers.filter((slot) => slot.id !== ownerId),
        ].filter((slot): slot is PhoneProviderSlot => Boolean(slot))
      : this.providers;

    for (const slot of ordered) {
      try {
        const result = await slot.adapter.getStatus(providerCallId);
        if (result.failureCode === "provider_unavailable" && slot.id !== ownerId) continue;
        const tagged = withProvider(result, slot.id, []);
        this.remember(tagged, slot.id);
        return tagged;
      } catch {
        if (slot.id === ownerId) {
          return unavailableResult(providerCallId, slot.id);
        }
      }
    }

    return unavailableResult(providerCallId, ownerId ?? this.providers[0].id);
  }

  async cancel(providerCallId: string): Promise<ProviderCallResult> {
    if (!providerCallId?.trim()) {
      return unavailableResult("unknown", this.providers[0].id);
    }
    const ownerId = this.ownerByCallId.get(providerCallId);
    const slot = (ownerId && this.slot(ownerId)) || this.providers[0];
    try {
      const result = await slot.adapter.cancel(providerCallId);
      return withProvider(result, slot.id, []);
    } catch {
      return {
        ...unavailableResult(providerCallId, slot.id),
        providerCallId,
        failureCode: "provider_unavailable",
      };
    }
  }

  debugSnapshot() {
    return {
      providerIds: this.providers.map((slot) => slot.id),
      acceptedCalls: this.acceptedByIdempotency.size,
      stickyCallIds: [...this.ownerByCallId.entries()],
      health: this.getHealthSnapshot(),
    };
  }
}

export function createFailoverCalleAdapter(opts: FailoverCalleAdapterOpts): FailoverCalleAdapter {
  return new FailoverCalleAdapter(opts);
}
