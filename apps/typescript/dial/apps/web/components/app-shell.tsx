'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { proxied } from '@/lib/api';
import {
  groupTasksByDay,
  taskSummaryLine,
  type SessionUser,
  type TaskSummary,
} from '@dial/schemas';
import {
  BrandMark,
  PlusIcon,
  SearchIcon,
  ContactsIcon,
  ClockIcon,
  PhoneIcon,
  CardIcon,
  KeyIcon,
  UserIcon,
  BriefcaseIcon,
  TrashIcon,
} from './icons';

/**
 * The application shell, laid out to match the supplied screenshot: a
 * borderless sidebar on the page-tinted background, a near-black pill for the
 * primary action, plain-text navigation with line icons, and the content in a
 * white rounded panel floating on the tint.
 */

const LIVE_STATES = new Set([
  'created',
  'interpreting',
  'researching',
  'candidates_ready',
  'planning_calls',
  'calling',
  'collecting_results',
  'comparing',
]);

export function AppShell({
  user,
  recents,
  children,
}: {
  user: SessionUser;
  recents: TaskSummary[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const isCurrent = (href: string) => (pathname === href ? 'page' : undefined);

  /** Which row is asking to be confirmed. Only ever one at a time. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Rows already deleted on the server.
   *
   * `recents` comes from the server component, and router.refresh() takes a
   * moment to bring a new one back. Without this the task stays in the list
   * until that lands, so a successful delete looks like it did nothing and
   * invites a second click.
   */
  const [deleted, setDeleted] = useState<string[]>([]);
  const visibleRecents = recents.filter((task) => !deleted.includes(task.id));

  async function removeTask(task: TaskSummary) {
    setBusy(true);
    setError(null);
    try {
      await proxied.deleteTask(task.id);
      setDeleted((prev) => [...prev, task.id]);
      setConfirming(null);
      // Reading the task that was just deleted would 404 on the next render.
      if (pathname === `/tasks/${task.id}`) router.push('/');
      router.refresh();
    } catch {
      // Said in terms of the task, not the request that carried it.
      setError('That task could not be deleted. Check your connection and try again.');
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <Link href="/" className="brand">
          <BrandMark size={32} className="brand-mark" />
          <span>DIAL</span>
        </Link>

        <button type="button" className="new-task-button" onClick={() => router.push('/')}>
          <PlusIcon size={20} />
          New task
        </button>

        <div className="nav">
          <Link href="/history" className="nav-item" aria-current={isCurrent('/history')}>
            <SearchIcon size={20} />
            Your tasks
          </Link>
          <Link href="/contacts" className="nav-item" aria-current={isCurrent('/contacts')}>
            <ContactsIcon size={20} />
            Contacts
          </Link>
          <Link
            href="/business"
            className="nav-item"
            aria-current={pathname.startsWith('/business') ? 'page' : undefined}
          >
            <BriefcaseIcon size={20} />
            Business
          </Link>
        </div>

        <div className="nav-divider" />

        <div className="nav-heading">
          <ClockIcon size={20} />
          Recents
        </div>

        <div className="recents">
          {recents.length === 0 ? (
            <p
              style={{
                padding: '4px 12px 4px 34px',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
                margin: 0,
              }}
            >
              Nothing yet
            </p>
          ) : (
            groupTasksByDay(visibleRecents).map((group) => (
              <div key={group.label} className="recent-group">
                {/*
                  The day, once, instead of nothing. Twelve one-line rows all
                  looked equally recent -- there was no way to tell this
                  morning's task from last week's without opening it.
                */}
                <div className="recent-day">{group.label}</div>
                {group.tasks.map((task) =>
                  confirming === task.id ? (
                    /*
                      Deleting a task destroys its calls, transcripts and
                      result, and none of that comes back. So it asks -- inline
                      rather than through a browser dialog, matching how
                      removing a contact and closing an account are confirmed.

                      The row is replaced rather than pushed aside: at sidebar
                      width there is no room for a question and two answers
                      beside the name, and a cramped confirm is how people
                      click the wrong one.
                    */
                    <div
                      key={task.id}
                      className="recent-confirm"
                      role="group"
                      aria-label={`Delete task: ${task.instruction}?`}
                      onKeyDown={(event) => {
                        // Escape backs out, the way it does out of any other
                        // question a page asks before doing something final.
                        if (event.key === 'Escape') {
                          event.stopPropagation();
                          setConfirming(null);
                        }
                      }}
                    >
                      <span className="recent-confirm-text">Delete this task?</span>
                      <button
                        type="button"
                        className="recent-confirm-yes"
                        disabled={busy}
                        onClick={() => void removeTask(task)}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="recent-confirm-no"
                        disabled={busy}
                        /*
                          Focus lands on the safe answer, not the destructive
                          one. Opening a confirm with Delete already focused
                          means a stray Enter deletes the task -- the exact
                          thing the confirm exists to prevent.
                        */
                        autoFocus
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <div key={task.id} className="recent-row">
                      <Link
                        href={`/tasks/${task.id}`}
                        className="recent-item"
                        title={`${task.instruction} — ${taskSummaryLine(task)}`}
                      >
                        <span
                          className="recent-dot"
                          data-live={LIVE_STATES.has(task.state) ? 'true' : 'false'}
                        />
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {task.instruction}
                        </span>
                      </Link>
                      {/*
                        Named for the task it deletes, because "Delete" repeated
                        down a list tells a screen reader nothing about which
                        one is about to go.
                      */}
                      <button
                        type="button"
                        className="recent-delete"
                        aria-label={`Delete task: ${task.instruction}`}
                        onClick={() => {
                          setError(null);
                          setConfirming(task.id);
                        }}
                      >
                        <TrashIcon size={15} />
                      </button>
                    </div>
                  ),
                )}
              </div>
            ))
          )}
          {/* Kept in the sidebar so the failure appears where the click was. */}
          {error ? (
            <p className="recent-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        {/*
          These four pointed at /settings — four entries, one destination, and
          no way to tell from the URL which you had followed. Each is its own
          page now, so each can be current.
        */}
        <div className="sidebar-footer">
          <div className="nav-divider" />
          <Link
            href="/settings/calling"
            className="nav-item"
            aria-current={isCurrent('/settings/calling')}
          >
            <PhoneIcon size={20} />
            Calling
          </Link>
          <Link
            href="/settings/usage"
            className="nav-item"
            aria-current={isCurrent('/settings/usage')}
          >
            <CardIcon size={20} />
            Usage
          </Link>
          <Link
            href="/settings/permissions"
            className="nav-item"
            aria-current={isCurrent('/settings/permissions')}
          >
            <KeyIcon size={20} />
            Permissions
          </Link>
          <Link
            href="/settings/account"
            className="nav-item"
            aria-current={isCurrent('/settings/account')}
          >
            <UserIcon size={20} />
            {user.name}
          </Link>
        </div>
      </nav>

      <main className="main">
        <div className="panel">{children}</div>
      </main>
    </div>
  );
}
