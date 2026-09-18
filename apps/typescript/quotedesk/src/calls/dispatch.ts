// Dispatch: one CALL-E call task with ALL distributors as recipients
// (the idiomatic multi-recipient use), or a dry-run preview that touches
// no network.
//
// Safety posture:
//  - dry-run is the DEFAULT; live dispatch requires the explicit --live flag
//  - the idempotency key derives from (rfqId + distributor ids), never from
//    the attempt, so a retried command cannot double-dial
//  - CALL-E exposes no client cancellation: a created call runs to
//    completion. We dispatch exactly one wave and never over-dispatch.
//  - the returned call id is persisted to the ledger IMMEDIATELY: there is
//    no list-calls endpoint, so a lost id is unrecoverable.

import { createHash } from 'node:crypto';
import type { Distributor, RequestedSpec } from '../types.js';
import { buildRecipientResultSchema, buildResultSchema, buildTaskText } from './buildTask.js';

export interface DispatchPlan {
  task: string;
  recipients: { distributorId: string; maskedPhone: string; phoneEnv: string }[];
  recipientResultSchema: Record<string, unknown>;
  resultSchema: Record<string, unknown>;
  idempotencyKey: string;
  region: string;
}

export function idempotencyKey(rfqId: string, distributors: Distributor[]): string {
  const material = `${rfqId}:${distributors.map((d) => d.id).sort().join(',')}`;
  return `quotedesk-${createHash('sha256').update(material).digest('hex').slice(0, 24)}`;
}

export function buildDispatchPlan(
  spec: RequestedSpec,
  distributors: Distributor[],
  companyName: string,
): DispatchPlan {
  return {
    task: buildTaskText(spec, companyName),
    recipients: distributors.map((d) => ({
      distributorId: d.id,
      maskedPhone: d.maskedPhone,
      phoneEnv: d.phoneEnv,
    })),
    recipientResultSchema: buildRecipientResultSchema(),
    resultSchema: buildResultSchema(),
    idempotencyKey: idempotencyKey(spec.rfqId, distributors),
    region: 'IN',
  };
}

/** Resolve a distributor's real E.164 number from the environment.
 * Numbers are never stored in fixtures or code. Fail-closed: a missing
 * variable aborts BEFORE any call is created, never mid-wave. */
export function resolvePhones(distributors: Distributor[]): Map<string, string> {
  const resolved = new Map<string, string>();
  const missing: string[] = [];
  for (const d of distributors) {
    const value = process.env[d.phoneEnv];
    if (!value || !/^\+\d{8,15}$/.test(value)) {
      missing.push(`${d.id} (${d.phoneEnv})`);
    } else {
      resolved.set(d.id, value);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Live mode needs an E.164 number in the environment for every distributor. Missing or invalid: ${missing.join(', ')}. No call was created.`,
    );
  }
  return resolved;
}

export interface LiveDispatchDeps {
  // Matches @call-e/calle CalleClient.calls; injected so tests never
  // construct a real client.
  create: (
    input: {
      task: string;
      recipients: { phones: string[]; region?: string }[];
      recipientResultSchema: Record<string, unknown>;
      resultSchema: Record<string, unknown>;
      metadata: Record<string, unknown>;
    },
    options: { idempotencyKey: string },
  ) => Promise<{ id: string }>;
}

export async function dispatchLive(
  plan: DispatchPlan,
  phones: Map<string, string>,
  deps: LiveDispatchDeps,
  onCallCreated: (callId: string) => void,
): Promise<string> {
  const call = await deps.create(
    {
      task: plan.task,
      recipients: plan.recipients.map((r) => ({
        phones: [phones.get(r.distributorId)!],
        region: plan.region,
      })),
      recipientResultSchema: plan.recipientResultSchema,
      resultSchema: plan.resultSchema,
      metadata: {
        app: 'quotedesk',
        // distributor order mirrors recipients order so reconcile can map
        // recipients[i] back to a distributor without storing numbers
        distributor_order: plan.recipients.map((r) => r.distributorId).join(','),
      },
    },
    { idempotencyKey: plan.idempotencyKey },
  );
  // Persist immediately — there is no GET /v1/calls list endpoint.
  onCallCreated(call.id);
  return call.id;
}
