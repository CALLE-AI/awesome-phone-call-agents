import Link from 'next/link';

/** A page that is not there, said without a status code. */
export default function NotFound() {
  return (
    <div className="task-body">
      <header className="page-header">
        <h1 className="page-title">That page is not here</h1>
        <p className="page-subtitle">
          The link may be old, or the task may have been deleted.
        </p>
      </header>

      <div className="button-row">
        <Link className="button" data-variant="primary" href="/">
          Start a task
        </Link>
        <Link className="button" href="/history">
          Your tasks
        </Link>
      </div>
    </div>
  );
}
