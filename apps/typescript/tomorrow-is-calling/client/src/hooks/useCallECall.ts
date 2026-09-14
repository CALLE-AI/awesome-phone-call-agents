import { useCallback, useEffect, useState } from "react";
import { createCall, getCall, type CallEResponse } from "../services/callEApi";
import type { PrototypeCallState } from "../types/call";
import type { TransportRequest } from "../types/transport";

const TERMINAL = new Set(["completed", "failed", "canceled"]);

function mapStatus(status: CallEResponse["status"]): PrototypeCallState {
  switch (status) {
    case "queued":
      return "dialing";
    case "in_progress":
      return "conversation";
    case "completed":
      return "complete";
    case "canceled":
      return "cancelled";
    case "failed":
    default:
      return "failed";
  }
}

export function useCallECall(request: TransportRequest) {
  const [state, setState] = useState<PrototypeCallState>("preparing");
  const [callId, setCallId] = useState<string>();
  const [result, setResult] = useState<CallEResponse>();
  const [error, setError] = useState<string>();
  const [duration, setDuration] = useState(0);

  const begin = useCallback(async () => {
    setState("preparing");
    setError(undefined);
    setResult(undefined);
    setDuration(0);
    try {
      const created = await createCall(request);
      setCallId(created.id);
      setResult(created);
      setState(mapStatus(created.status));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start CALL-E call.");
      setState("failed");
    }
  }, [request]);

  useEffect(() => {
    void begin();
  }, [begin]);

  useEffect(() => {
    if (!callId || !result || TERMINAL.has(result.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getCall(callId);
        setResult(next);
        setState(mapStatus(next.status));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to refresh CALL-E status.");
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [callId, result]);

  useEffect(() => {
    if (state !== "conversation") return;
    const timer = window.setInterval(() => setDuration((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [state]);

  return {
    state,
    duration,
    callId,
    result,
    error,
    retry: begin,
  };
}
