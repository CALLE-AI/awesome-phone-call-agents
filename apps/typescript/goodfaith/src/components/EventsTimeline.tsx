// File: src/components/EventsTimeline.tsx
import type { CallEvent } from "@/lib/calle-types";

export function EventsTimeline({ events }: { events: CallEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-paper-500">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
        Connecting to the call task…
      </p>
    );
  }
  return (
    <ol className="space-y-1.5 font-mono text-xs">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3">
          <span className="tnum shrink-0 text-paper-500">{new Date(e.created_at).toLocaleTimeString()}</span>
          <span className="text-accent">{e.type}</span>
          {e.data?.recipient ? <span className="text-paper-300">{String(e.data.recipient)}</span> : null}
        </li>
      ))}
    </ol>
  );
}
