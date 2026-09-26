import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { NotificationCentre } from './NotificationCentre'
import { RAIL_WIDTH, RAIL_WIDTH_COLLAPSED, Rail } from './Rail'
import { ToastStack } from './Toast'
import type { Notification, NotificationFeed } from '../../hooks/useNotifications'
import { sectionForPath, type NavCounts } from '../../lib/nav'
import type { ConnectionState, Dashboard, Hazard } from '../../types'

/**
 * The frame every page sits in.
 *
 * It owns three things and nothing else: the rail's collapsed state, whether the notification
 * centre is open, and what happens when somebody clicks a ping. Data belongs to `HazardLayout`,
 * which holds the SSE connection and the REST rows — putting any of that here would mean a
 * navigation could remount the shell and drop the stream.
 *
 * Clicking a notification is the console's central gesture, and it does three things at once:
 * navigate to the route the *backend* chose (`notifications.py::route_for` knows whether a ping is
 * about a person, an incident or the evening), mark it read, and get out of the way. The operator
 * ends up on the page where she can act, which is the entire point of interrupting her.
 */

/** Below this the rail is icons only, whatever the operator last chose. */
const NARROW = 1120
const COLLAPSE_KEY = 'buddye.rail.collapsed'

function storedCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false // private browsing, a locked-down profile: not worth an error, just expand.
  }
}

export interface AppShellProps {
  hazardId?: string
  hazard: Hazard | null
  dashboard: Dashboard | null
  connection: ConnectionState
  counts: NavCounts
  feed: NotificationFeed
  /** Page-level controls for the content header — the demo actions, an audit link. */
  actions?: ReactNode
  /** A failure from the layout's fetches. Shown above the page, not instead of it. */
  error?: string | null
  onDismissError?: () => void
  children: ReactNode
}

export function AppShell({ hazardId, hazard, dashboard, connection, counts, feed, actions, error, onDismissError, children }: AppShellProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [preferCollapsed, setPreferCollapsed] = useState(storedCollapsed)
  const [narrow, setNarrow] = useState(false)
  const [centreOpen, setCentreOpen] = useState(false)

  // A narrow window collapses the rail without touching the preference, so widening the window
  // gives back the labels somebody deliberately asked for.
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW}px)`)
    const apply = () => setNarrow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const collapsed = narrow || preferCollapsed
  const railWidth = collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH

  const toggleCollapsed = useCallback(() => {
    setPreferCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* storage unavailable: the toggle still works for this session */
      }
      return next
    })
  }, [])

  const openNotification = useCallback(
    (n: Notification) => {
      setCentreOpen(false)
      feed.dismissToast(n.id)
      void feed.markRead([n.id])
      navigate(n.route)
    },
    [feed, navigate],
  )

  const section = sectionForPath(location.pathname)

  return (
    <div className="flex min-h-screen bg-ground">
      <Rail
        hazardId={hazardId}
        hazard={hazard}
        dashboard={dashboard}
        connection={connection}
        counts={counts}
        unread={feed.unread}
        notificationsOpen={centreOpen}
        onOpenNotifications={() => setCentreOpen((v) => !v)}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* The page says what it is. One line, no tabs, nothing competing with it. */}
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface/95 px-5 backdrop-blur">
          <div className="min-w-0">
            <h1 className="truncate text-15 font-semibold leading-tight tracking-tight text-text">{section?.label ?? 'BuddyE'}</h1>
            {section ? <p className="truncate text-11 leading-tight text-faint">{section.hint}</p> : null}
          </div>
          {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>

        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1320px] px-5 py-4">
            {error ? (
              <div className="mb-3 flex items-start gap-3 rounded border border-rejected/30 bg-rejected-tint px-3 py-2">
                <p className="min-w-0 flex-1 text-12 leading-snug text-rejected">{error}</p>
                {onDismissError ? (
                  <button type="button" onClick={onDismissError} className="shrink-0 text-11 text-rejected underline underline-offset-2">
                    dismiss
                  </button>
                ) : null}
              </div>
            ) : null}
            {children}
          </div>
        </main>
      </div>

      <NotificationCentre
        open={centreOpen}
        onClose={() => setCentreOpen(false)}
        feed={feed}
        onOpen={openNotification}
        offsetLeft={railWidth}
      />

      <ToastStack
        toasts={feed.toasts}
        onOpen={openNotification}
        onDismiss={feed.dismissToast}
        overflow={feed.overflow}
        onOverflow={() => setCentreOpen(true)}
      />
    </div>
  )
}
