import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MobileCalleClient, type MobileCallRequest, type MobileCallTask } from "@/shared/calleClient";
import { describeNetworkError, nextPollFailureState } from "@/shared/http-json";
import { startPolling } from "@/shared/poll";

export type CalleCallUiStatus = "idle" | "creating" | "queued" | "in_progress" | "polling" | "completed" | "failed";

export type CalleCallState = {
  status: CalleCallUiStatus;
  callId?: string;
  data?: MobileCallTask;
  error?: string;
};

function uiStatusFromCall(data: MobileCallTask): CalleCallUiStatus {
  if (data.status === "completed") return "completed";
  if (data.status === "failed" || data.status === "canceled") return "failed";
  if (data.status === "queued") return "queued";
  if (data.status === "in_progress") return "in_progress";
  return "polling";
}

function shouldKeepPolling(status: CalleCallUiStatus): boolean {
  return status === "polling" || status === "queued" || status === "in_progress";
}

export function useCalleCall(baseUrl: string) {
  const client = useMemo(() => new MobileCalleClient(baseUrl), [baseUrl]);
  const [state, setState] = useState<CalleCallState>({ status: "idle" });
  const startInFlight = useRef(false);
  const pollFailures = useRef(0);
  const callId = state.callId;
  const polling = !!callId && shouldKeepPolling(state.status);

  const start = useCallback(
    async (input: Omit<MobileCallRequest, "idempotencyKey"> & { idempotencyKey?: string }) => {
      if (startInFlight.current) return;
      startInFlight.current = true;
      pollFailures.current = 0;
      setState({ status: "creating" });
      try {
        const data = await client.createCall({
          ...input,
          idempotencyKey:
            input.idempotencyKey ?? `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        });
        const status = uiStatusFromCall(data);
        setState({ status: status === "completed" || status === "failed" ? status : "polling", callId: data.id, data });
      } catch (error) {
        setState({
          status: "failed",
          error: describeNetworkError(error, "CALL-E request failed"),
        });
      } finally {
        startInFlight.current = false;
      }
    },
    [client],
  );

  useEffect(() => {
    if (!polling || !callId) return;
    const poll = startPolling({
      intervalMs: 2500,
      tick: async () => {
        try {
          const data = await client.getCall(callId);
          pollFailures.current = 0;
          const status = uiStatusFromCall(data);
          if (status === "completed" || status === "failed") {
            setState({ status, callId, data });
            return "stop";
          }
          setState((current) => ({ ...current, status, data, error: undefined }));
          return "continue";
        } catch (error) {
          const next = nextPollFailureState(pollFailures.current, error);
          pollFailures.current = next.consecutiveFailures;
          const message = describeNetworkError(error, "Polling failed");
          if (!next.fatal) {
            setState((current) => ({ ...current, error: message }));
            return "backoff";
          }
          setState((current) => ({
            ...current,
            status: "failed",
            error: message,
          }));
          return "stop";
        }
      },
    });
    return () => poll.stop();
  }, [callId, client, polling]);

  return { state, start };
}
