export type PollTickResult = "continue" | "stop" | "backoff";

export type PollController = {
  stop: () => void;
};

/**
 * Sequential polling: the next tick is scheduled only after the previous
 * tick finishes, so overlapping network requests cannot pile up.
 */
export function startPolling(options: {
  intervalMs: number;
  maxIntervalMs?: number;
  immediate?: boolean;
  tick: () => Promise<PollTickResult>;
}): PollController {
  const intervalMs = Math.max(0, options.intervalMs);
  const maxIntervalMs = Math.max(intervalMs, options.maxIntervalMs ?? intervalMs * 4);
  let stopped = false;
  let delay = intervalMs;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, ms);
  };

  const run = async () => {
    if (stopped) return;
    try {
      const result = await options.tick();
      if (stopped || result === "stop") {
        stopped = true;
        return;
      }
      delay = result === "backoff" ? Math.min(Math.max(delay, intervalMs) * 2, maxIntervalMs) : intervalMs;
      schedule(delay);
    } catch {
      if (stopped) return;
      delay = Math.min(Math.max(delay, intervalMs) * 2, maxIntervalMs);
      schedule(delay);
    }
  };

  if (options.immediate) {
    void run();
  } else {
    schedule(intervalMs);
  }

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
