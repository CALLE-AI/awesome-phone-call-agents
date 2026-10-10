'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * What a person sees when something breaks.
 *
 * There was no boundary at all, so any thrown error handed the user Next's
 * default screen -- in production, a blank page reading "Application error".
 * For a product whose whole argument is that it tells you what actually
 * happened, an unexplained white screen is the worst failure it has.
 *
 * The message says what is known and what to do. The technical detail goes to
 * the console for whoever is debugging, not onto the page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is how this maps to a server log line. Useful in a support
    // conversation; meaningless on screen.
    console.error('Dial hit an unexpected error', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="task-body" role="alert">
      <header className="page-header">
        <h1 className="page-title">Something went wrong</h1>
        <p className="page-subtitle">
          Dial ran into a problem displaying this page. Nothing you have already asked for has been
          lost — any task that was running is still running.
        </p>
      </header>

      <div className="button-row">
        <button className="button" data-variant="primary" onClick={() => reset()}>
          Try again
        </button>
        <Link className="button" href="/">
          Start something new
        </Link>
      </div>

      {error.digest ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          If you report this, quote <code>{error.digest}</code>.
        </p>
      ) : null}
    </div>
  );
}
