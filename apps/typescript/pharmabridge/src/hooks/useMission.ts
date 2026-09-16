"use client";
// Browser-side mission orchestrator: parallel dispatch with a concurrency cap, polling, early stop
// once enough facilities confirm, and manual retries. The server stays stateless. A call whose outcome
// CALL-E never confirmed is kept as "unknown" and halts queued live dispatch.
import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_PHASES, FINAL_PHASES, applyCall, markUnknown, newSlot, submissionOutcome, type CallPlan, type Slot } from "@/lib/mission";
import type { BloodRequest, CallView, Facility, Medication, Routing } from "@/lib/types";
import { newMissionId } from "@/lib/ui";

export interface MissionSettings {
  concurrency: number;
  stopAfter: number;
  routing: Routing;
  operatorCode: string;
  locale: string;
  /** The operator confirmed they may have an AI agent call the selected facilities' listed numbers. */
  directConsent: boolean;
}

export type Need = { kind: "pharmacy"; medication: Medication } | { kind: "blood_bank"; blood: BloodRequest };

export type MissionStatus = "idle" | "running" | "draining" | "complete";

export interface Mission {
  id: string;
  status: MissionStatus;
  startedAt: number | null;
  finishedAt: number | null;
  settings: MissionSettings;
  need: Need | null;
  slots: Slot[];
  stopReason: string | null;
}

interface CreateResponse {
  call?: CallView;
  accessToken?: unknown;
  recordKey?: unknown;
  plan?: CallPlan;
  mode?: "simulation" | "live";
  dialTarget?: string;
  error?: { code?: string; message?: string };
}

export const DEFAULT_SETTINGS: MissionSettings = {
  concurrency: 3,
  stopAfter: 1,
  routing: "simulation",
  operatorCode: "",
  locale: "",
  directConsent: false,
};

const LOST = "Lost contact with this call. It may still be running; check Call records or the CALL-E dashboard before calling again.";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function emptyMission(): Mission {
  return { id: newMissionId(), status: "idle", startedAt: null, finishedAt: null, settings: DEFAULT_SETTINGS, need: null, slots: [], stopReason: null };
}

function halt(mission: Mission, reason: string | null) {
  if (!reason) return;
  mission.status = "draining";
  mission.stopReason = reason;
}

export function useMission() {
  const ref = useRef<Mission>(emptyMission());
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const launch = useCallback(
    async (slot: Slot) => {
      const mission = ref.current;
      const missionId = mission.id;
      const need = mission.need;
      if (!need) return;
      slot.phase = "launching";
      slot.launchedAt = Date.now();
      slot.error = null;
      let res: Response | null = null;
      let json: CreateResponse | null = null;
      try {
        res = await fetch("/api/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: need.kind === "pharmacy" ? "inquiry" : "blood_inquiry",
            missionId,
            attempt: slot.attempt,
            routing: mission.settings.routing,
            testLineIndex: slot.order,
            seed: slot.order + (slot.attempt - 1) * 4,
            locale: mission.settings.locale || undefined,
            operatorCode: mission.settings.operatorCode || undefined,
            directConsent: mission.settings.directConsent,
            facility: slot.facility,
            ...(need.kind === "pharmacy" ? { medication: need.medication } : { blood: need.blood }),
          }),
        });
        json = (await res.json().catch(() => null)) as CreateResponse | null;
      } catch {
        res = null;
      }
      if (ref.current.id !== missionId) return;

      const accessToken = typeof json?.accessToken === "string" ? json.accessToken : null;
      if (res?.ok && json?.call?.id && accessToken) {
        slot.callId = json.call.id;
        slot.accessToken = accessToken;
        slot.recordKey = typeof json.recordKey === "string" ? json.recordKey : null;
        slot.plan = json.plan ?? null;
        slot.mode = json.mode ?? null;
        slot.dialTarget = json.dialTarget ?? null;
        slot.lastPolledAt = Date.now();
        applyCall(slot, json.call, []);
      } else {
        const message = json?.error?.message ?? (res ? `Request failed (${res.status})` : "No response from the PharmaBridge server.");
        if (typeof json?.recordKey === "string") slot.recordKey = json.recordKey;
        // A success without a usable call, or anything but a definite refusal, may still have dialed.
        if (res?.ok || submissionOutcome(res ? res.status : null, json?.error?.code) === "unknown") {
          halt(mission, markUnknown(mission.slots, slot, message, mission.settings.routing !== "simulation"));
        } else {
          slot.phase = "error";
          slot.error = message;
          slot.finishedAt = Date.now();
        }
      }
      bump();
    },
    [bump],
  );

  const poll = useCallback(
    async (slot: Slot) => {
      const missionId = ref.current.id;
      const callId = slot.callId;
      const accessToken = slot.accessToken;
      if (!callId || !accessToken) return;
      try {
        const headers = { "x-pharmabridge-call-token": accessToken };
        const [callRes, eventsRes] = await Promise.all([
          fetch(`/api/calls/${callId}`, { cache: "no-store", headers }),
          fetch(`/api/calls/${callId}/events`, { cache: "no-store", headers }),
        ]);
        if (ref.current.id !== missionId || slot.callId !== callId) return;
        if (!callRes.ok) throw new Error(`HTTP ${callRes.status}`);
        const { call } = await callRes.json();
        const events = eventsRes.ok ? ((await eventsRes.json()).events ?? slot.events) : slot.events;
        slot.pollErrors = 0;
        applyCall(slot, call, events);
      } catch {
        const mission = ref.current;
        if (mission.id !== missionId || slot.callId !== callId) return;
        slot.pollErrors++;
        if (slot.pollErrors >= 8) halt(mission, markUnknown(mission.slots, slot, LOST, mission.settings.routing !== "simulation"));
      }
      bump();
    },
    [bump],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      const m = ref.current;
      if (m.status !== "running" && m.status !== "draining") return;
      const now = Date.now();
      const noun = m.need?.kind === "blood_bank" ? ["blood bank", "blood banks"] : ["pharmacy", "pharmacies"];

      // 1. Early stop: once enough facilities confirm, cancel calls that have not been dialed yet.
      const confirmed = m.slots.filter((s) => s.assessment?.tier === "confirmed").length;
      if (m.status === "running" && confirmed >= m.settings.stopAfter) {
        const cancelled = m.slots.filter((s) => s.phase === "queued" && !s.manual);
        for (const s of cancelled) {
          s.phase = "skipped";
          s.finishedAt = now;
        }
        m.status = "draining";
        m.stopReason =
          `Target reached: ${plural(confirmed, noun[0], noun[1])} confirmed.` +
          (cancelled.length ? ` ${plural(cancelled.length, "queued call was", "queued calls were")} cancelled before dialing.` : "");
      }

      // 2. Launch up to the concurrency cap.
      let capacity = m.settings.concurrency - m.slots.filter((s) => ACTIVE_PHASES.includes(s.phase)).length;
      for (const slot of m.slots) {
        if (capacity <= 0) break;
        if (slot.phase !== "queued" || (m.status === "draining" && !slot.manual)) continue;
        capacity--;
        void launch(slot);
      }

      // 3. Poll in-flight calls. Live calls poll gently to respect CALL-E rate limits.
      const interval = m.settings.routing === "simulation" ? 1100 : 3500;
      for (const slot of m.slots) {
        if (!slot.callId || !ACTIVE_PHASES.includes(slot.phase) || now - slot.lastPolledAt < interval) continue;
        slot.lastPolledAt = now;
        void poll(slot);
      }

      // 4. Completion.
      if (m.slots.length && m.slots.every((s) => FINAL_PHASES.includes(s.phase))) {
        m.status = "complete";
        m.finishedAt ??= now;
      }
      bump();
    }, 500);
    return () => window.clearInterval(timer);
  }, [launch, poll, bump]);

  const start = useCallback(
    (need: Need, facilities: Facility[], settings: MissionSettings): string => {
      const id = newMissionId();
      ref.current = {
        id,
        status: "running",
        startedAt: Date.now(),
        finishedAt: null,
        settings,
        need,
        slots: facilities.map((f, i) => newSlot(f, i)),
        stopReason: null,
      };
      bump();
      return id;
    },
    [bump],
  );

  const stop = useCallback(() => {
    const m = ref.current;
    if (m.status !== "running") return;
    const cancelled = m.slots.filter((s) => s.phase === "queued");
    for (const s of cancelled) {
      s.phase = "skipped";
      s.finishedAt = Date.now();
    }
    m.status = "draining";
    m.stopReason =
      "Stopped by operator." +
      (cancelled.length ? ` ${plural(cancelled.length, "queued call", "queued calls")} cancelled before dialing.` : "") +
      " Calls already in flight finish normally.";
    bump();
  }, [bump]);

  const retry = useCallback(
    (key: string) => {
      const m = ref.current;
      const slot = m.slots.find((s) => s.key === key);
      const unknown = slot?.phase === "unknown";
      if (!slot || (!unknown && slot.attempt >= 5)) return;
      // Resubmitting an unknown outcome keeps its attempt number, and so its idempotency key: CALL-E
      // returns the original call instead of dialing a second time.
      Object.assign(slot, { ...newSlot(slot.facility, slot.order), attempt: unknown ? slot.attempt : slot.attempt + 1, manual: true });
      if (m.status === "complete") {
        m.status = "draining";
        m.finishedAt = null;
      }
      bump();
    },
    [bump],
  );

  const reset = useCallback(() => {
    ref.current = emptyMission();
    bump();
  }, [bump]);

  return { mission: ref.current, start, stop, retry, reset };
}
