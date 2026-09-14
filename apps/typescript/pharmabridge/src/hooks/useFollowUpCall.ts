"use client";
// Runs one follow-up call (hold request or prescriber redirect) and polls it to a terminal state.
import { useCallback, useRef, useState } from "react";
import { derivePhase, type CallPlan, type SlotPhase } from "@/lib/mission";
import { TERMINAL_STATUSES, type CallEventView, type CallView } from "@/lib/types";

export interface FollowUpState {
  phase: SlotPhase | "idle";
  call: CallView | null;
  events: CallEventView[];
  plan: CallPlan | null;
  mode: "simulation" | "live" | null;
  dialTarget: string | null;
  error: string | null;
}

const IDLE: FollowUpState = { phase: "idle", call: null, events: [], plan: null, mode: null, dialTarget: null, error: null };
const MAX_WAIT_MS = 12 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const callHeaders = (accessToken: string) => ({ "x-pharmabridge-call-token": accessToken });

export function useFollowUpCall(pollMs: number) {
  const [state, setState] = useState<FollowUpState>(IDLE);
  const token = useRef(0);

  const run = useCallback(
    async (body: Record<string, unknown>) => {
      const mine = ++token.current;
      setState({ ...IDLE, phase: "launching" });
      try {
        const res = await fetch("/api/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
        const accessToken = typeof json.accessToken === "string" ? json.accessToken : "";
        if (!accessToken) throw new Error("The server did not issue a scoped token for this call.");
        let call: CallView = json.call;
        let events: CallEventView[] = [];
        setState({ phase: derivePhase(call, events), call, events, plan: json.plan, mode: json.mode, dialTarget: json.dialTarget, error: null });

        const startedAt = Date.now();
        while (token.current === mine && !TERMINAL_STATUSES.includes(call.status)) {
          if (Date.now() - startedAt > MAX_WAIT_MS) throw new Error("Timed out waiting for the call result.");
          await sleep(pollMs);
          const [callRes, eventsRes] = await Promise.all([
            fetch(`/api/calls/${call.id}`, { cache: "no-store", headers: callHeaders(accessToken) }),
            fetch(`/api/calls/${call.id}/events`, { cache: "no-store", headers: callHeaders(accessToken) }),
          ]);
          if (!callRes.ok) throw new Error(`Call status request failed (${callRes.status}).`);
          call = (await callRes.json()).call;
          if (eventsRes.ok) events = (await eventsRes.json()).events ?? events;
          if (token.current !== mine) return;
          const snapshot = call;
          const eventSnapshot = events;
          setState((s) => ({ ...s, call: snapshot, events: eventSnapshot, phase: derivePhase(snapshot, eventSnapshot) }));
        }
      } catch (error) {
        if (token.current === mine) setState((s) => ({ ...s, phase: "error", error: error instanceof Error ? error.message : String(error) }));
      }
    },
    [pollMs],
  );

  const reset = useCallback(() => {
    token.current++;
    setState(IDLE);
  }, []);

  return { ...state, run, reset };
}
