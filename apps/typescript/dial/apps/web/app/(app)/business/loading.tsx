/**
 * Shown while your businesses loads on the server.
 *
 * The shapes match what replaces them, so the page does not jump when the real
 * content lands. Every route here does two or three sequential fetches before
 * it can render, which is long enough to look broken without this.
 */
export default function BusinessLoading() {
  return (
    <div className="task-body" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading your businesses</span>

      <div className="skeleton skeleton-title" style={{ width: '36%', height: 30 }} />
      <div className="skeleton skeleton-line" style={{ width: '55%' }} />

      <section className="card" aria-hidden>
        <div className="skeleton skeleton-line" style={{ width: '30%' }} />
        <div className="skeleton skeleton-line" style={{ width: '75%' }} />
        <div className="skeleton skeleton-line" style={{ width: '58%' }} />
      </section>
      <section className="card" aria-hidden>
        <div className="skeleton skeleton-line" style={{ width: '34%' }} />
        <div className="skeleton skeleton-line" style={{ width: '68%' }} />
        <div className="skeleton skeleton-line" style={{ width: '62%' }} />
      </section>
    </div>
  );
}
