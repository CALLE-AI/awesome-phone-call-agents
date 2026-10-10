/**
 * Shown while your saved numbers loads on the server.
 *
 * The shapes match what replaces them, so the page does not jump when the real
 * content lands. Every route here does two or three sequential fetches before
 * it can render, which is long enough to look broken without this.
 */
export default function ContactsLoading() {
  return (
    <div className="task-body" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading your contacts</span>

      <div className="skeleton skeleton-title" style={{ width: '32%', height: 30 }} />
      <div className="skeleton skeleton-line" style={{ width: '55%' }} />

      <section className="card" aria-hidden>
        <div className="skeleton skeleton-line" style={{ width: '28%' }} />
        <div className="skeleton skeleton-line" style={{ width: '90%' }} />
        <div className="skeleton skeleton-line" style={{ width: '65%' }} />
      </section>
      <section className="card" aria-hidden>
        <div className="skeleton skeleton-line" style={{ width: '30%' }} />
        <div className="skeleton skeleton-line" style={{ width: '70%' }} />
        <div className="skeleton skeleton-line" style={{ width: '45%' }} />
      </section>
    </div>
  );
}
