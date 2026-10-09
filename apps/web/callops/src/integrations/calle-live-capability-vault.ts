import { CalleLiveAdapterError } from './calle-live-errors';
import type {
  CalleConfirmToken,
  CallePlanCapabilityVault,
  CallePlanId,
  CalleRunId,
} from './calle-live-types';

interface HeldCapability {
  readonly planId: CallePlanId;
  readonly confirmToken: CalleConfirmToken;
}

function nonEmptyOpaqueString(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CalleLiveAdapterError('An opaque CALL-E capability has an invalid type.', code);
  }
  return value;
}

export function asCallePlanId(value: unknown): CallePlanId {
  return nonEmptyOpaqueString(value, 'INVALID_PLAN_ID') as CallePlanId;
}

export function asCalleConfirmToken(value: unknown): CalleConfirmToken {
  return nonEmptyOpaqueString(value, 'INVALID_CONFIRM_TOKEN') as CalleConfirmToken;
}

export function asCalleRunId(value: unknown): CalleRunId {
  return nonEmptyOpaqueString(value, 'INVALID_RUN_ID') as CalleRunId;
}

export class InMemoryCallePlanCapabilityVault implements CallePlanCapabilityVault {
  private readonly capabilities = new Map<string, HeldCapability>();

  public store(planFingerprint: string, capability: HeldCapability): void {
    if (this.capabilities.has(planFingerprint)) {
      throw new CalleLiveAdapterError(
        'A capability already exists for this reviewed plan.',
        'CAPABILITY_ALREADY_PRESENT',
      );
    }
    this.capabilities.set(planFingerprint, capability);
  }

  public take(planFingerprint: string): HeldCapability | null {
    const capability = this.capabilities.get(planFingerprint) ?? null;
    this.capabilities.delete(planFingerprint);
    return capability;
  }

  public has(planFingerprint: string): boolean {
    return this.capabilities.has(planFingerprint);
  }

  public delete(planFingerprint: string): void {
    this.capabilities.delete(planFingerprint);
  }

  public clear(): void {
    this.capabilities.clear();
  }
}

export class CalleOneShotRunGate {
  private consumed = false;

  public constructor(private readonly planFingerprint: string) {}

  public state(): 'WAITING' | 'CONSUMED' {
    return this.consumed ? 'CONSUMED' : 'WAITING';
  }

  public consume(expectedPlanFingerprint: string): void {
    if (this.consumed) {
      throw new CalleLiveAdapterError('The one-shot run gate is already consumed.', 'RUN_GATE_CONSUMED');
    }
    if (expectedPlanFingerprint !== this.planFingerprint) {
      throw new CalleLiveAdapterError('The run gate does not match the reviewed plan.', 'RUN_GATE_MISMATCH');
    }
    this.consumed = true;
  }
}
