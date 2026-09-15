import { ApprovalGateError } from '../domain/errors';
import type { SupportCase } from '../domain/models';

export {
  classifyCallePlanResponse,
  destroyCallePlanOpaqueValues,
  sanitizeCallePlanText,
} from './calle-plan-response';
export type {
  CallePlanContractResult,
  JsonValueType,
  SanitizedCallePlanObservation,
} from './calle-plan-response';

export const CALLE_PLAN_ONLY_MISSION_ID = 'CALLOPS-CALLE-PLAN-ONLY-SYNTHETIC-001';
export const CALLE_PLAN_TOOL_NAME = 'plan_call';
export const CALLE_PLAN_INPUT_SCHEMA_SHA256 =
  '918AAC4C4C8BBACFDEB7C61C1A308E098ABF7E99BFA5056D750F97A705478824';

export interface CalleSyntheticFixture {
  readonly organization: string;
  readonly caseReference: string;
  readonly product: string;
  readonly goal: string;
  readonly allowedInformation: readonly string[];
  readonly forbiddenInformation: readonly string[];
}

export interface CallePlanPayload {
  readonly to_phones: null;
  readonly goal: string;
}

export interface CallePlanOnlyTransport {
  invokePlanCall(payload: CallePlanPayload): Promise<unknown>;
}

export const CALLE_SYNTHETIC_FIXTURE: Readonly<CalleSyntheticFixture> = Object.freeze({
  organization: 'Northstar Repairs Demo',
  caseReference: 'DEMO-SAV-2026-0042',
  product: 'Demo Laptop Backpack',
  goal: 'Determine the current replacement status and the estimated shipping timeframe.',
  allowedInformation: Object.freeze([
    'Synthetic case reference',
    'Synthetic product name',
    'Requested replacement status',
    'Requested estimated shipping timeframe',
  ]),
  forbiddenInformation: Object.freeze([
    'Payment details',
    'Authentication secrets',
    'Real personal information',
    'Contract acceptance',
    'Address modification',
    'Purchase or financial commitment',
  ]),
});

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function buildCallePlanPayload(): CallePlanPayload {
  const fixture = CALLE_SYNTHETIC_FIXTURE;
  return Object.freeze({
    to_phones: null,
    goal: [
      'Planning only. Do not place a call, send an SMS, schedule an action, or make an external commitment.',
      `Organization: ${fixture.organization}`,
      `Synthetic case reference: ${fixture.caseReference}`,
      `Synthetic product: ${fixture.product}`,
      `Goal: ${fixture.goal}`,
      `Allowed information: ${fixture.allowedInformation.join('; ')}.`,
      `Forbidden information: ${fixture.forbiddenInformation.join('; ')}.`,
    ].join('\n'),
  });
}

export function assertCalleSyntheticCase(supportCase: SupportCase): void {
  const fixture = CALLE_SYNTHETIC_FIXTURE;
  const expectedContext = `Synthetic product: ${fixture.product}.`;
  if (
    supportCase.organization !== fixture.organization ||
    supportCase.syntheticReference !== fixture.caseReference ||
    supportCase.context !== expectedContext ||
    supportCase.desiredOutcome !== fixture.goal ||
    !sameStrings(supportCase.authorizedInformation, fixture.allowedInformation) ||
    !sameStrings(supportCase.forbiddenInformation, fixture.forbiddenInformation)
  ) {
    throw new ApprovalGateError(
      'CALL-E planning accepts only the exact approved synthetic fixture.',
      'CALLE_SYNTHETIC_FIXTURE_MISMATCH',
    );
  }
}

export function canonicalizeCalleJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON refuses non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeCalleJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeCalleJson(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError(`Canonical JSON refuses values of type ${typeof value}.`);
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function canonicalCallePlanPayload(payload: CallePlanPayload): string {
  return canonicalizeCalleJson(payload);
}

export function fingerprintCallePlanPayload(payload = buildCallePlanPayload()): Promise<string> {
  return sha256(canonicalCallePlanPayload(payload));
}

export function fingerprintCalleJson(value: unknown): Promise<string> {
  return sha256(canonicalizeCalleJson(value));
}
