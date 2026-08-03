/**
 * Drill service — coordinates store, claims, and orchestration.
 */

import { ConfigError, resolveMode, validateCreateBody } from "./config.js";
import { isValidE164, maskPhone } from "./masking.js";
import { runDrill, previewPlan } from "./orchestrator.js";
import { createProvider } from "./provider/index.js";
import {
  launchSideEffectsBlocked,
  maxCallsForDrill,
  transitionToArmed,
  transitionToPreview,
  cancelBoundaryMessage,
  applyTerminalStatus,
  redactContacts,
  isInFlightDrillStatus,
} from "./state-machine.js";
import type { DrillStore, LaunchClaimStore } from "./store.js";
import type { CreateDrillBody, DrillContact, DrillRecord, LaunchBody, PreviewAckBody } from "./types.js";
import { isTerminalDrillStatus } from "./types.js";
import type { CallePort } from "./calle.js";

export interface DrillServiceDeps {
  store: DrillStore;
  claims: LaunchClaimStore;
}

interface OrchestrationSlot {
  abort: AbortController;
  activeCallId: string | null;
  provider: CallePort | null;
}

const orchestrationSlots = new Map<string, OrchestrationSlot>();
const launchInflight = new Map<string, { promise: Promise<DrillRecord>; idempotencyKey: string }>();

function defaultLaunchIdempotencyKey(drillId: string): string {
  return `drill-signal-launch-${drillId}`;
}

function assertLaunchBodyLocked(drill: DrillRecord, body: LaunchBody): void {
  if (body.mode !== undefined && body.mode !== drill.mode) {
    throw new ConfigError("Launch cannot change mode. Create a new drill and re-preview.");
  }
  if (body.simulationPreset !== undefined && body.simulationPreset !== drill.simulationPreset) {
    throw new ConfigError("Launch cannot change simulation preset. Create a new drill and re-preview.");
  }
}

function assertPreviewAttestations(drill: DrillRecord): void {
  if (!drill.consent.operatorConfirmedDrillPurpose || !drill.consent.maxCallsDisclosed) {
    throw new ConfigError("Preview consent attestations are required before launch.");
  }
  if (drill.mode === "live" && !drill.consent.liveSideEffectAcknowledged) {
    throw new ConfigError("Live side-effect acknowledgment is required before launch.");
  }
}

export function createDrill(deps: DrillServiceDeps, body: CreateDrillBody): DrillRecord {
  validateCreateBody(body);
  if (!isValidE164(body.primaryPhone)) {
    throw new ConfigError("Primary phone must be E.164 format, e.g. +15550100001.");
  }
  let backup: DrillContact | null = null;
  if (body.backupPhone?.trim()) {
    if (!isValidE164(body.backupPhone)) {
      throw new ConfigError("Backup phone must be E.164 format.");
    }
    backup = {
      role: "backup",
      label: body.backupLabel!.trim(),
      phone: body.backupPhone.trim(),
      phoneMasked: maskPhone(body.backupPhone),
      consented: Boolean(body.backupConsented),
    };
  }
  const mode = resolveMode(body.mode, "simulation");
  const primary: DrillContact = {
    role: "primary",
    label: body.primaryLabel.trim(),
    phone: body.primaryPhone.trim(),
    phoneMasked: maskPhone(body.primaryPhone),
    consented: body.primaryConsented,
  };
  const consent = {
    primaryAttested: body.primaryConsented,
    backupAttested: backup?.consented ?? false,
    operatorConfirmedDrillPurpose: false,
    maxCallsDisclosed: false,
    liveSideEffectAcknowledged: false,
    launchConfirmed: false,
  };
  const draft: Omit<DrillRecord, "id" | "createdAt" | "updatedAt"> = {
    scenario: "production_outage",
    status: "draft",
    mode,
    primary,
    backup,
    maxCalls: 1,
    consent,
    callsPlaced: 0,
    launchClaim: null,
    simulationPreset: body.simulationPreset ?? "primary-success",
    events: [{ at: new Date().toISOString(), level: "info", message: "Drill created." }],
    attempts: [],
    report: null,
    cancelRequested: false,
    cancelBoundary: null,
    activeProviderCallId: null,
    activeProviderCallRole: null,
    reconciliationRequired: false,
    reconciliationReason: null,
  };
  const withMax = { ...draft, maxCalls: maxCallsForDrill({ backup, consent } as DrillRecord) };
  return deps.store.save(transitionToPreview(deps.store.create(withMax)));
}

export function acknowledgePreview(deps: DrillServiceDeps, id: string, body: PreviewAckBody): DrillRecord {
  const drill = deps.store.get(id);
  if (!drill) throw new ConfigError("Drill not found.");
  const liveAckRequired = drill.mode === "live";
  if (liveAckRequired && !body.liveSideEffectAcknowledged) {
    throw new ConfigError("Live side-effect acknowledgment is required for live mode.");
  }
  const updated = transitionToArmed({
    ...drill,
    consent: {
      ...drill.consent,
      operatorConfirmedDrillPurpose: body.operatorConfirmedDrillPurpose,
      maxCallsDisclosed: body.maxCallsDisclosed,
      liveSideEffectAcknowledged: liveAckRequired ? Boolean(body.liveSideEffectAcknowledged) : drill.consent.liveSideEffectAcknowledged,
    },
  });
  return deps.store.save(updated);
}

/**
 * If a process dies mid-call, the durable checkpoint remains but no orchestration
 * slot is live. Materialize an honest terminal reconciliation-required state and
 * never auto-retry the provider call.
 */
function materializeOrphanedActiveCall(deps: DrillServiceDeps, drill: DrillRecord): DrillRecord {
  if (orchestrationSlots.has(drill.id)) {
    return drill;
  }

  if (drill.activeProviderCallId !== null && !isTerminalDrillStatus(drill.status)) {
    const healed: DrillRecord = {
      ...drill,
      reconciliationRequired: true,
      reconciliationReason: drill.reconciliationReason ?? "interrupted",
      events: [
        ...drill.events,
        {
          at: new Date().toISOString(),
          level: "warn",
          message: "Reconcile the retained provider call ID with CALL-E before placing any new call.",
          detail: `providerCallId=${drill.activeProviderCallId}`,
        },
        {
          at: new Date().toISOString(),
          level: "warn",
          message: "Process interruption left an accepted provider call without a finished evaluation.",
          detail: `reason=interrupted`,
        },
      ],
    };
    return deps.store.save(applyTerminalStatus(healed, "ambiguous"));
  }

  // In-flight without a checkpointed provider ID: stop without inventing a call or retrying.
  if (isInFlightDrillStatus(drill.status) && drill.activeProviderCallId === null && !orchestrationSlots.has(drill.id)) {
    const healed: DrillRecord = {
      ...drill,
      reconciliationRequired: drill.reconciliationRequired,
      events: [
        ...drill.events,
        {
          at: new Date().toISOString(),
          level: "warn",
          message: "Drill left in-flight after process interruption with no accepted provider call ID.",
        },
      ],
    };
    return deps.store.save(applyTerminalStatus(healed, "failed"));
  }

  return drill;
}

export function getDrill(deps: DrillServiceDeps, id: string): DrillRecord | null {
  const drill = deps.store.get(id);
  if (!drill) {
    return null;
  }
  return materializeOrphanedActiveCall(deps, drill);
}

export function getPreview(deps: DrillServiceDeps, id: string): { drill: DrillRecord; plan: string[] } {
  const drill = deps.store.get(id);
  if (!drill) throw new ConfigError("Drill not found.");
  return { drill, plan: previewPlan(drill) };
}

async function executeLaunch(
  deps: DrillServiceDeps,
  id: string,
  body: LaunchBody,
  idempotencyKey: string,
  options?: { fakeBaseUrl?: string },
): Promise<DrillRecord> {
  const drill = deps.store.get(id);
  if (!drill) throw new ConfigError("Drill not found.");

  assertLaunchBodyLocked(drill, body);

  const existingKey = drill.launchClaim?.idempotencyKey ?? deps.claims.getClaim(id);
  if (existingKey === idempotencyKey && launchSideEffectsBlocked(drill)) {
    return drill;
  }

  if (launchSideEffectsBlocked(drill)) {
    if (existingKey === idempotencyKey) {
      return drill;
    }
    throw new ConfigError("Drill cannot be launched again — it already has a launch claim, attempts, or terminal state.");
  }

  if (drill.status !== "armed") {
    throw new ConfigError("Drill must be armed via Safety Preview before launch.");
  }

  assertPreviewAttestations(drill);

  if (!body.launchConfirmed) {
    throw new ConfigError("Explicit launch confirmation is required.");
  }

  const claimResult = deps.claims.tryClaim(id, idempotencyKey);
  if (claimResult === "conflict") {
    throw new ConfigError("Duplicate launch blocked by idempotency claim.");
  }
  if (claimResult === "replay") {
    const current = deps.store.get(id);
    if (current) {
      return current;
    }
  }

  const refreshed = deps.store.get(id);
  if (!refreshed || refreshed.status !== "armed") {
    throw new ConfigError("Drill must be armed via Safety Preview before launch.");
  }
  if (launchSideEffectsBlocked(refreshed) && refreshed.launchClaim?.idempotencyKey === idempotencyKey) {
    return refreshed;
  }

  const abort = new AbortController();
  const slot: OrchestrationSlot = { abort, activeCallId: null, provider: null };
  orchestrationSlots.set(id, slot);

  let prepared = deps.store.save({
    ...refreshed,
    consent: { ...refreshed.consent, launchConfirmed: true },
    launchClaim: { idempotencyKey, claimedAt: new Date().toISOString(), claimedBy: "operator" },
  });

  try {
    const embeddedFake =
      prepared.mode === "fake-server" &&
      (!process.env.CALLE_BASE_URL || process.env.CALLE_BASE_URL === "http://127.0.0.1:0")
        ? options?.fakeBaseUrl
        : undefined;

    const port = await createProvider({
      mode: prepared.mode,
      simulationPreset: prepared.simulationPreset,
      baseUrl: prepared.mode === "fake-server" ? process.env.CALLE_BASE_URL : process.env.CALLE_BASE_URL,
      embeddedFakeBaseUrl: embeddedFake,
    });
    slot.provider = port;

    const finished = await runDrill(prepared, {
      port,
      onUpdate: (update) => {
        prepared = deps.store.save(update);
      },
      onActiveCall: (callId) => {
        slot.activeCallId = callId;
      },
      context: {
        signal: abort.signal,
        isCancelled: () => {
          const latest = deps.store.get(id);
          return latest?.cancelRequested === true;
        },
      },
    });
    return deps.store.save(finished);
  } finally {
    orchestrationSlots.delete(id);
  }
}

export async function launchDrill(
  deps: DrillServiceDeps,
  id: string,
  body: LaunchBody,
  _options?: { fakeBaseUrl?: string },
): Promise<DrillRecord> {
  const idempotencyKey = body.idempotencyKey ?? defaultLaunchIdempotencyKey(id);

  const inflight = launchInflight.get(id);
  if (inflight) {
    if (inflight.idempotencyKey === idempotencyKey) {
      return inflight.promise;
    }
    throw new ConfigError("Drill launch already in progress with a different idempotency key.");
  }

  let resolveDone!: (value: DrillRecord) => void;
  let rejectDone!: (reason: unknown) => void;
  const launchPromise = new Promise<DrillRecord>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  launchInflight.set(id, { promise: launchPromise, idempotencyKey });

  void (async () => {
    try {
      const result = await executeLaunch(deps, id, body, idempotencyKey, _options);
      resolveDone(result);
    } catch (error) {
      rejectDone(error);
    } finally {
      launchInflight.delete(id);
    }
  })();

  return launchPromise;
}

export function cancelDrill(deps: DrillServiceDeps, id: string): DrillRecord {
  const drill = deps.store.get(id);
  if (!drill) throw new ConfigError("Drill not found.");
  if (isTerminalDrillStatus(drill.status)) {
    return drill;
  }

  const slot = orchestrationSlots.get(id);
  const activeCallId = slot?.activeCallId ?? drill.activeProviderCallId ?? null;
  const boundary = cancelBoundaryMessage(drill.callsPlaced, activeCallId);

  if (slot) {
    slot.abort.abort();
    if (activeCallId && slot.provider?.cancelCall) {
      void slot.provider.cancelCall(activeCallId).catch(() => undefined);
    }
  }

  const retainRecon = activeCallId !== null;
  const cancelled = applyTerminalStatus(
    {
      ...drill,
      cancelRequested: true,
      cancelBoundary: boundary,
      activeProviderCallId: activeCallId ?? drill.activeProviderCallId,
      activeProviderCallRole: drill.activeProviderCallRole,
      reconciliationRequired: retainRecon ? true : drill.reconciliationRequired,
      reconciliationReason: retainRecon
        ? (drill.reconciliationReason ?? "cancelled_with_active_call")
        : drill.reconciliationReason,
      events: [
        ...drill.events,
        { at: new Date().toISOString(), level: "warn", message: "Cancel requested.", detail: boundary },
        ...(retainRecon
          ? [
              {
                at: new Date().toISOString(),
                level: "warn" as const,
                message: "Reconcile the retained provider call ID with CALL-E before placing any new call.",
                detail: `providerCallId=${activeCallId}`,
              },
            ]
          : []),
      ],
    },
    slot ? drill.status : "cancelled",
  );

  if (!slot) {
    return deps.store.save(redactContacts({ ...cancelled, status: "cancelled" }));
  }
  return deps.store.save(cancelled);
}

export function publicDrillView(drill: DrillRecord): DrillRecord {
  // Always strip full phones from public/status responses; keep recon fields honest.
  const masked: DrillRecord = {
    ...drill,
    primary: { ...drill.primary, phone: undefined },
    backup: drill.backup ? { ...drill.backup, phone: undefined } : null,
  };
  return masked;
}

/** Test helper — reset module-level orchestration state. */
export function resetServiceStateForTests(): void {
  orchestrationSlots.clear();
  launchInflight.clear();
}
