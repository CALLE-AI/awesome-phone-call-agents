import { useCallback, useEffect, useRef, useState } from "react";

export type SimulationPhase = 0 | 1 | 2 | 3;

export function useSimulation() {
  const [phase, setPhase] = useState<SimulationPhase>(0);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    setPhase(0);
  }, [clearTimers]);

  const run = useCallback(() => {
    clearTimers();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setPhase(3);
      return;
    }
    setPhase(1);
    timers.current = [
      window.setTimeout(() => setPhase(2), 520),
      window.setTimeout(() => setPhase(3), 1040),
    ];
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  return { phase, run, reset } as const;
}
