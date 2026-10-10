'use client';

import { useEffect, useState } from 'react';
import { elapsedWorkingMs, formatDuration } from '@dial/schemas';

/**
 * How long Dial has worked on this task.
 *
 * Not "time since created": a task can wait an hour for the user to answer a
 * question, and none of that is Dial working. The server banks the working
 * periods, and this only has to tick the one that is still open — so a task
 * that finished shows a settled total, and one asked to do more resumes from
 * where it stopped rather than starting again.
 */
export function TaskTimer({
  activeMs,
  activeSince,
  running,
}: {
  activeMs: number;
  activeSince: string | null;
  running: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!activeSince) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeSince]);

  const elapsed = elapsedWorkingMs({ activeMs, activeSince }, now);

  // Nothing to show before the work has started. A "0:00" that sits still
  // reads as broken.
  if (elapsed <= 0 && !activeSince) return null;

  return (
    <span
      className="task-timer"
      data-running={running || undefined}
      // Announced once when it settles, not on every tick.
      aria-live={running ? 'off' : 'polite'}
      title={running ? 'Time Dial has spent on this task' : 'Total time Dial spent on this task'}
    >
      <ClockGlyph />
      <span className="task-timer-value">{formatDuration(elapsed)}</span>
      <span className="visually-hidden">
        {running ? 'elapsed working time' : 'total working time'}
      </span>
    </span>
  );
}

/** Small enough to sit inside the pill row without competing with it. */
function ClockGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}
