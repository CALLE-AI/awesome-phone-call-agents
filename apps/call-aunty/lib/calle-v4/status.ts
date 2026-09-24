export const TERMINAL = new Set(["completed", "failed", "canceled"]);
export const ACTIVE = new Set(["queued", "in_progress"]);

export function label(status: string): string {
  return (
    (
      {
        queued: "Queued",
        in_progress: "Calling…",
        completed: "Completed",
        failed: "Failed",
        canceled: "Canceled",
      } as Record<string, string>
    )[status] ?? "Unknown"
  );
}

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}
