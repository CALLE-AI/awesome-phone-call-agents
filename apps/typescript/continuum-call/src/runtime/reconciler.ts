import type { IntentDispatcher } from "./dispatcher.js";
import type { MissionRuntime } from "./mission-runtime.js";

export type ReconcileResult = {
  mission_id: string;
  attempted: string[];
  recovered: string[];
  failed: Array<{ call_intent_id: string; reason: string }>;
};

/**
 * Reconciler: resume stuck dispatching/ambiguous intents with the SAME
 * frozen payload + idempotency key. Shared by auto-resume and manual Resume.
 */
export class MissionReconciler {
  constructor(
    private readonly runtime: MissionRuntime,
    private readonly dispatcher: IntentDispatcher,
  ) {}

  listStuck(missionId: string) {
    return this.runtime.listStuckIntents(missionId);
  }

  async reconcileMission(missionId: string): Promise<ReconcileResult> {
    const stuck = this.listStuck(missionId);
    const result: ReconcileResult = {
      mission_id: missionId,
      attempted: [],
      recovered: [],
      failed: [],
    };

    this.runtime.events.append({
      mission_id: missionId,
      event_type: "reconcile_started",
      actor: "system",
      redacted_payload: { stuck_count: stuck.length },
    });

    for (const intent of stuck) {
      result.attempted.push(intent.call_intent_id);
      try {
        const res = await this.dispatcher.recover(intent.call_intent_id);
        if (res.ok) {
          result.recovered.push(intent.call_intent_id);
          this.runtime.events.append({
            mission_id: missionId,
            event_type: "reconcile_recovered",
            actor: "system",
            call_intent_id: intent.call_intent_id,
            provider_run_id: res.intent.provider_run_id ?? undefined,
            redacted_payload: { reused: res.reused },
          });
        } else {
          result.failed.push({
            call_intent_id: intent.call_intent_id,
            reason: res.reason,
          });
          this.runtime.events.append({
            mission_id: missionId,
            event_type: "reconcile_failed",
            actor: "system",
            call_intent_id: intent.call_intent_id,
            redacted_payload: { reason: res.reason, kind: res.kind },
          });
        }
      } catch (e) {
        result.failed.push({
          call_intent_id: intent.call_intent_id,
          reason: String((e as Error).message || e),
        });
      }
    }

    this.runtime.flushStore?.(missionId);
    return result;
  }

  async reconcileIntent(
    missionId: string,
    callIntentId: string,
  ): Promise<ReconcileResult> {
    const intent = this.runtime.getIntent(callIntentId);
    if (!intent) throw new Error("unknown intent");
    if (this.runtime.missionIdForIntent(callIntentId) !== missionId) {
      throw new Error("intent not in mission");
    }
    const result: ReconcileResult = {
      mission_id: missionId,
      attempted: [callIntentId],
      recovered: [],
      failed: [],
    };
    this.runtime.events.append({
      mission_id: missionId,
      event_type: "reconcile_started",
      actor: "operator",
      call_intent_id: callIntentId,
      redacted_payload: { stuck_count: 1, mode: "single" },
    });
    try {
      const res = await this.dispatcher.recover(callIntentId);
      if (res.ok) {
        result.recovered.push(callIntentId);
        this.runtime.events.append({
          mission_id: missionId,
          event_type: "reconcile_recovered",
          actor: "operator",
          call_intent_id: callIntentId,
          provider_run_id: res.intent.provider_run_id ?? undefined,
          redacted_payload: { reused: res.reused },
        });
      } else {
        result.failed.push({ call_intent_id: callIntentId, reason: res.reason });
      }
    } catch (e) {
      result.failed.push({
        call_intent_id: callIntentId,
        reason: String((e as Error).message || e),
      });
    }
    this.runtime.flushStore?.(missionId);
    return result;
  }
}
