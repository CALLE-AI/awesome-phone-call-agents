"use client";
// Runs one follow-up call (hold, transfer, or prescriber request) and polls it to a terminal state.
// A submission CALL-E never confirmed, or a call we lose contact with, ends as "unknown", never "not placed".
import { useCallback, useRef, useState } from "react";
import { derivePhase, submissionOutcome, withLiveTurns, type CallPlan, type SlotPhase } from "@/lib/mission";
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

interface CreateResponse {
  call?: CallView;
  accessToken?: unknown;
  plan?: CallPlan;
  mode?: FollowUpState["mode"];
  dialTarget?: string;
  error?: { code?: string; message?: string };
}

const IDLE: FollowUpState = { phase: "idle", call: null, events: [], plan: null, mode: null, dialTarget: null, error: null };
const MAX_WAIT_MS = 12 * 60 * 1000;
const MAX_POLL_FAILURES = 8;
const LOST = "Lost contact with this call. It may still be running; check Call records or the CALL-E dashboard before calling again.";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const callHeaders = (accessToken: string) => ({ "x-pharmabridge-call-token": accessToken });

export function useFollowUpCall(pollMs: number) {
  const [state, setState] = useState<FollowUpState>(IDLE);
  const token = useRef(0);

  const run = useCallback(
    async (body: Record<string, unknown>) => {
      const mine = ++token.current;
      setState({ ...IDLE, phase: "launching" });
      let res: Response | null = null;
      let json: CreateResponse | null = null;
      try {
        res = await fetch("/api/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        json = (await res.json().catch(() => null)) as CreateResponse | null;
      } catch {
        res = null;
      }
      if (token.current !== mine) return;
      const accessToken = typeof json?.accessToken === "string" ? json.accessToken : "";
      if (!res?.ok || !json?.call?.id || !accessToken) {
        const message = json?.error?.message ?? (res ? `Request failed (${res.status})` : "No response from the PharmaBridge server.");
        // A success without a usable call, or anything but a definite refusal, may still have dialed.
        const unknown = Boolean(res?.ok) || submissionOutcome(res ? res.status : null, json?.error?.code) === "unknown";
        setState({ ...IDLE, phase: unknown ? "unknown" : "error", error: message });
        return;
      }

      let call: CallView = json.call;
      let events: CallEventView[] = [];
      setState({ phase: derivePhase(call, events), call, events, plan: json.plan ?? null, mode: json.mode ?? null, dialTarget: json.dialTarget ?? null, error: null });

      const startedAt = Date.now();
      let failures = 0;
      while (token.current === mine && !TERMINAL_STATUSES.includes(call.status)) {
        if (Date.now() - startedAt > MAX_WAIT_MS) {
          setState((s) => ({ ...s, phase: "unknown", error: `Timed out waiting for the result. ${LOST}` }));
          return;
        }
        await sleep(pollMs);
        try {
          const [callRes, eventsRes] = await Promise.all([
            fetch(`/api/calls/${call.id}`, { cache: "no-store", headers: callHeaders(accessToken) }),
            fetch(`/api/calls/${call.id}/events`, { cache: "no-store", headers: callHeaders(accessToken) }),
          ]);
          if (!callRes.ok) throw new Error(`HTTP ${callRes.status}`);
          call = (await callRes.json()).call;
          if (eventsRes.ok) events = (await eventsRes.json()).events ?? events;
          failures = 0;
        } catch {
          if (++failures >= MAX_POLL_FAILURES) {
            if (token.current === mine) setState((s) => ({ ...s, phase: "unknown", error: LOST }));
            return;
          }
          continue;
        }
        if (token.current !== mine) return;
        const snapshot = withLiveTurns(call, events);
        const eventSnapshot = events;
        setState((s) => ({ ...s, call: snapshot, events: eventSnapshot, phase: derivePhase(snapshot, eventSnapshot) }));
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
