/**
 * Shown while your tasks loads on the server.
 *
 * The shapes match what replaces them, so the page does not jump when the real
 * content lands. Every route here does two or three sequential fetches before
 * it can render, which is long enough to look broken without this.
 */
export default function HistoryLoading() {
  return (
    <div className="task-body" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading your tasks</span>

      <div className="skeleton skeleton-title" style={{ width: '40%', height: 30 }} />
      <div className="skeleton skeleton-line" style={{ width: '55%' }} />

      <section className="card" aria-hidden>
        <div className="skeleton skeleton-line" style={{ width: '35%' }} />
        <div className="skeleton skeleton-line" style={{ width: '80%' }} />
        <div className="skeleton skeleton-line" style={{ width: '60%' }} />
      </section>
      <section className="card" aria-hidden>
        <div className="skeleton skeleton-line" style={{ width: '30%' }} />
        <div className="skeleton skeleton-line" style={{ width: '72%' }} />
        <div className="skeleton skeleton-line" style={{ width: '55%' }} />
      </section>
      <section className="card" aria-hidden>
        <div className="skeleton skeleton-line" style={{ width: '38%' }} />
        <div className="skeleton skeleton-line" style={{ width: '85%' }} />
        <div className="skeleton skeleton-line" style={{ width: '50%' }} />
      </section>
    </div>
  );
}
