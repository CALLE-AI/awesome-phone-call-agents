import { useEffect, useState } from "react";
import type {
  PrototypeCallInterruption,
  PrototypeCallRecord,
  PrototypeCallState,
} from "../types/call";

const TRANSITIONS: Partial<
  Record<PrototypeCallState, { next: PrototypeCallState; delay: number }>
> = {
  preparing: { next: "dialing", delay: 750 },
  dialing: { next: "ringing", delay: 1_100 },
  ringing: { next: "connected", delay: 1_450 },
  connected: { next: "conversation", delay: 850 },
  processing: { next: "complete", delay: 1_400 },
};

export function useMockCall() {
  const [state, setState] = useState<PrototypeCallState>("preparing");
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const transition = TRANSITIONS[state];
    if (!transition) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setTimeout(
      () => setState(transition.next),
      reducedMotion ? 150 : transition.delay,
    );
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (state !== "connected" && state !== "conversation") return;
    const interval = window.setInterval(
      () => setDuration((value) => value + 1),
      1_000,
    );
    return () => window.clearInterval(interval);
  }, [state]);

  const completeConversation = () => setState("processing");
  const cancel = () => setState("cancelled");
  const retry = () => {
    setDuration(0);
    setState("preparing");
  };
  const interrupt = (reason: PrototypeCallInterruption) => setState(reason);
  const record: PrototypeCallRecord = {
    status: state,
    completionReason:
      state === "complete" ? "prototype-conversation-complete" : undefined,
  };

  return {
    state,
    duration,
    record,
    completeConversation,
    cancel,
    retry,
    interrupt,
  };
}
