import { useCallback, useEffect, useRef, useState } from "react";

import { MobileCalleApi, type AppCall } from "@/lib/calle-v4/api";
import { isTerminal } from "@/lib/calle-v4/status";
import { describeNetworkError, nextPollFailureState } from "@/shared/http-json";
import { startPolling } from "@/shared/poll";

export function useCalleCall(api: MobileCalleApi, id?: string) {
  const [call, setCall] = useState<AppCall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const callRef = useRef<AppCall | null>(null);
  const pollFailures = useRef(0);

  const refresh = useCallback(async () => {
    if (!id) return false;
    try {
      const next = await api.get(id);
      callRef.current = next;
      pollFailures.current = 0;
      setCall(next);
      setError(null);
      return true;
    } catch (caught) {
      const next = nextPollFailureState(pollFailures.current, caught);
      pollFailures.current = next.consecutiveFailures;
      const message = describeNetworkError(caught, "Fetch failed");
      setError(message);
      if (next.fatal && !callRef.current) {
        setCall(null);
      }
      return false;
    }
  }, [api, id]);

  useEffect(() => {
    if (!id) return;
    pollFailures.current = 0;
    const poll = startPolling({
      intervalMs: 3000,
      immediate: true,
      tick: async () => {
        const ok = await refresh();
        const current = callRef.current;
        if (current && isTerminal(current.status)) return "stop";
        return ok ? "continue" : "backoff";
      },
    });
    return () => poll.stop();
  }, [id, refresh]);

  return { call, error, refresh };
}
