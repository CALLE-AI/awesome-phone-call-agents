/**
 * Runner: ties config + CALL-E + attestation logic + audit chain together.
 * Exposes a dry-run preview (no call) and an execute path.
 */
import type { AttestationRequest, AuditRecord } from "./types.js";
import { isE164, maskPhone } from "./util.js";
import { buildAttestationTask, deriveIdempotencyKey, utcDay } from "./attest.js";
import { placeAttestationCall } from "./calle.js";
import { toAuditPayload } from "./attest.js";
import { AuditChain } from "./audit.js";
import type { AppConfig } from "./config.js";

export interface Preview {
  vendorName: string;
  vendorPhoneMasked: string;
  framework: string;
  requestedBy: string;
  referenceId: string | null;
  idempotencyKey: string;
  mode: "live" | "demo";
  taskPreview: string;
  willPlaceRealCall: boolean;
}

export interface RunResult {
  record: AuditRecord;
  chainIntact: boolean;
}

/** Validate a request; throws with a clear message on bad input. */
export function validateRequest(req: AttestationRequest): void {
  if (!req.vendorName?.trim()) throw new Error("vendorName is required");
  if (!req.requestedBy?.trim()) throw new Error("requestedBy is required");
  if (!isE164(req.vendorPhone)) {
    throw new Error(`vendorPhone must be E.164 (e.g. +14155550123), got: ${maskPhone(req.vendorPhone)}`);
  }
}

/** Dry-run preview. Places NO call. Always safe to show a user first. */
export function preview(req: AttestationRequest, config: AppConfig): Preview {
  validateRequest(req);
  const key = deriveIdempotencyKey(req, utcDay());
  return {
    vendorName: req.vendorName,
    vendorPhoneMasked: maskPhone(req.vendorPhone),
    framework: req.framework,
    requestedBy: req.requestedBy,
    referenceId: req.referenceId ?? null,
    idempotencyKey: key,
    mode: config.demo ? "demo" : "live",
    taskPreview: buildAttestationTask(req),
    willPlaceRealCall: !config.demo,
  };
}

/**
 * Execute the attestation: place (or simulate) the call, classify fail-closed,
 * seal a hash-chained audit record, and return it.
 */
export async function run(
  req: AttestationRequest,
  config: AppConfig,
  opts: { fixtureScenario?: string } = {},
): Promise<RunResult> {
  validateRequest(req);
  const mode: "live" | "demo" = config.demo ? "demo" : "live";
  const key = deriveIdempotencyKey(req, utcDay());

  const call = await placeAttestationCall(req, {
    demo: config.demo,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    idempotencyKey: key,
    ...(opts.fixtureScenario ? { fixtureScenario: opts.fixtureScenario } : {}),
  });

  const payload = toAuditPayload(req, call, mode);
  const chain = new AuditChain(config.auditFile);
  const record = chain.append(payload);
  const { intact } = chain.verify();
  return { record, chainIntact: intact };
}
