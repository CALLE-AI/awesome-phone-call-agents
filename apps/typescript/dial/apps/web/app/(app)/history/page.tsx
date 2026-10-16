import Link from 'next/link';
import { groupTasksByDay, taskSummaryLine } from '@dial/schemas';
import { getTasks } from '@/lib/session';
import { DomainIcon } from '@/components/domain-icon';
import { ClockIcon } from '@/components/icons';

const TONE: Record<string, { bg: string; fg: string }> = {
  completed: { bg: 'var(--color-success-soft)', fg: 'var(--color-success)' },
  partially_completed: { bg: 'var(--color-warning-soft)', fg: 'var(--color-warning)' },
  failed: { bg: 'var(--color-danger-soft)', fg: 'var(--color-danger)' },
  canceled: { bg: 'var(--color-surface-muted)', fg: 'var(--color-text-secondary)' },
};

/**
 * Everything Dial has worked on, under the day it happened.
 *
 * This was a flat run of cards with a full timestamp on each. Forty of those
 * is a wall: every row carried the same shape of information, so nothing stood
 * out and finding last Tuesday's task meant reading dates one at a time.
 * Grouping does the reading for you, and the time on each row shrinks to the
 * only part that is not already in the heading above it.
 */
export default async function HistoryPage() {
  const data = await getTasks();
  const tasks = data?.tasks ?? [];
  const groups = groupTasksByDay(tasks);

  return (
    <div className="task-body">
      <header className="page-header" style={{ margin: 0 }}>
        <h1 className="page-title">Your tasks</h1>
        <p className="page-subtitle">
          Everything Dial has worked on, on any device you are signed in to.
        </p>
      </header>

      {tasks.length === 0 ? (
        <div className="empty-state">
          <ClockIcon size={28} />
          <p style={{ margin: '12px 0 16px' }}>No tasks yet.</p>
          <Link className="button" data-variant="primary" href="/">
            Start one
          </Link>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="history-group">
            <h2 className="history-day">
              {group.label}
              <span className="history-day-count">
                {group.tasks.length} task{group.tasks.length === 1 ? '' : 's'}
              </span>
            </h2>

            <ul className="history-list">
              {group.tasks.map((task) => {
                const tone = TONE[task.state] ?? {
                  bg: 'var(--color-info-soft)',
                  fg: 'var(--color-info)',
                };
                return (
                  <li key={task.id}>
                    <Link href={`/tasks/${task.id}`} className="card history-row">
                      <span className="history-icon" aria-hidden>
                        <DomainIcon domain={task.domain} />
                      </span>

                      <span className="history-body">
                        <span className="history-name">{task.instruction}</span>
                        <span className="history-meta">{taskSummaryLine(task)}</span>
                        {task.headline && task.headline !== task.instruction ? (
                          <span className="history-headline">{task.headline}</span>
                        ) : null}
                      </span>

                      <span className="history-side">
                        <span className="status-pill" style={{ background: tone.bg, color: tone.fg }}>
                          {task.stateLabel}
                        </span>
                        {/* The day is already the heading above; only the clock time adds anything. */}
                        <time className="history-time" dateTime={task.createdAt}>
                          {new Date(task.createdAt).toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </time>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
