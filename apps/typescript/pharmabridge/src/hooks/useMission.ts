"use client";
// Browser-side mission orchestrator: parallel dispatch with a concurrency cap, polling, early stop
// once enough facilities confirm, and manual retries. The server stays stateless.
import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_PHASES, FINAL_PHASES, applyCall, newSlot, type Slot } from "@/lib/mission";
import type { BloodRequest, Facility, Medication, Routing } from "@/lib/types";
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

export const DEFAULT_SETTINGS: MissionSettings = {
  concurrency: 3,
  stopAfter: 1,
  routing: "simulation",
  operatorCode: "",
  locale: "",
  directConsent: false,
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function emptyMission(): Mission {
  return { id: newMissionId(), status: "idle", startedAt: null, finishedAt: null, settings: DEFAULT_SETTINGS, need: null, slots: [], stopReason: null };
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
      try {
        const res = await fetch("/api/calls", {
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
        const json = await res.json();
        if (ref.current.id !== missionId) return;
        if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
        slot.callId = json.call.id;
        slot.accessToken = typeof json.accessToken === "string" ? json.accessToken : null;
        if (!slot.accessToken) throw new Error("The server did not issue a scoped token for this call.");
        slot.recordKey = typeof json.recordKey === "string" ? json.recordKey : null;
        slot.plan = json.plan;
        slot.mode = json.mode;
        slot.dialTarget = json.dialTarget;
        slot.lastPolledAt = Date.now();
        applyCall(slot, json.call, []);
      } catch (error) {
        if (ref.current.id !== missionId) return;
        slot.phase = "error";
        slot.error = error instanceof Error ? error.message : String(error);
        slot.finishedAt = Date.now();
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
        slot.pollErrors++;
        if (slot.pollErrors >= 8) {
          slot.phase = "error";
          slot.error = "Lost contact with this call. Check the CALL-E dashboard for its final state.";
          slot.finishedAt = Date.now();
        }
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
    (need: Need, facilities: Facility[], settings: MissionSettings) => {
      ref.current = {
        id: newMissionId(),
        status: "running",
        startedAt: Date.now(),
        finishedAt: null,
        settings,
        need,
        slots: facilities.map((f, i) => newSlot(f, i)),
        stopReason: null,
      };
      bump();
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
      if (!slot || slot.attempt >= 5) return;
      Object.assign(slot, { ...newSlot(slot.facility, slot.order), attempt: slot.attempt + 1, manual: true });
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
