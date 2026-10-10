/**
 * Shown while a task's data is being fetched on the server.
 *
 * The shapes match what replaces them — a status pill, a title, a progress
 * list, a result card — so the page does not reflow when the real content
 * lands. A spinner would say "wait"; this says what is coming.
 */
export default function TaskLoading() {
  return (
    <div className="task-body" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading this task</span>

      <div className="skeleton" style={{ width: 104, height: 28, borderRadius: 999 }} />
      <div className="skeleton skeleton-title" style={{ width: '70%', height: 30 }} />

      <section className="card" aria-hidden>
        <div className="skeleton skeleton-line" style={{ width: '30%' }} />
        <div className="skeleton skeleton-line" style={{ width: '85%' }} />
        <div className="skeleton skeleton-line" style={{ width: '72%' }} />
        <div className="skeleton skeleton-line" />
      </section>

      <section className="card" aria-hidden>
        <div className="skeleton skeleton-line" style={{ width: '25%' }} />
        <div className="skeleton skeleton-line" style={{ width: '60%', height: 22 }} />
        <div className="skeleton skeleton-line" style={{ width: '90%' }} />
        <div className="skeleton skeleton-line" />
      </section>
    </div>
  );
}
