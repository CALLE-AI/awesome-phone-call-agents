// File: src/components/ModeBadge.tsx
export function ModeBadge({ mode }: { mode: "mock" | "live" }) {
  const isMock = mode === "mock";
  return (
    <span
      className={`badge uppercase ${
        isMock
          ? "border border-ink-600 bg-ink-800 text-paper-300"
          : "border border-accent/50 bg-accent/15 text-accent-soft"
      }`}
      title={
        isMock
          ? "No real calls are placed. Results come from fixtures, badged MOCK."
          : "Real outbound calls are enabled."
      }
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${isMock ? "bg-paper-400" : "animate-pulse-dot bg-accent"}`}
      />
      {isMock ? "Mock mode" : "Live mode"}
    </span>
  );
}
