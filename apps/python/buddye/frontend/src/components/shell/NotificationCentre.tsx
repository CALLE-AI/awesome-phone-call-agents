import { useEffect, useMemo, useRef } from 'react'
import { Bell, CheckCheck, CircleAlert, Inbox, Lock, PhoneOff, Siren, Truck, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { awaitsHuman, kindLabel, type Notification, type NotificationFeed } from '../../hooks/useNotifications'
import { clampPriority } from '../ui/Badge'
import { Button, IconButton, cx } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { fmtClock, fmtTime } from '../../lib/utils'

/**
 * The full list behind the bell: everything that has pinged on this hazard, unread first.
 *
 * A panel rather than a page, because a notification is never the destination — it is the doorway.
 * Opening one has to leave the operator on the case, the incident or the map, so the centre closes
 * itself the moment a row is clicked.
 *
 * Unread sorts above read even though it is not chronological, and that is the right trade in an
 * emergency console: what she has not seen is more useful to her than what happened most recently.
 * Inside each group it is newest first.
 */

const KIND_ICON: Record<string, LucideIcon> = {
  'hazard.declared': CircleAlert,
  'case.flagged': Siren,
  'call.finished': PhoneOff,
  'deployment.opened': Siren,
  'deployment.awaiting_authorisation': Lock,
  'asset.arrived': Truck,
}

const DOT: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'bg-p1', 2: 'bg-p2', 3: 'bg-p3', 4: 'bg-p4', 5: 'bg-p5',
}

const ICON_TONE: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'text-p1', 2: 'text-p2', 3: 'text-p3', 4: 'text-p4', 5: 'text-p5',
}

function Row({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }) {
  const p = clampPriority(n.priority)
  const Icon = KIND_ICON[n.kind] ?? Bell
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={cx(
        'flex w-full items-start gap-2.5 border-b border-divider px-4 py-3 text-left transition-colors',
        'hover:bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/35',
        n.read ? 'bg-surface' : 'bg-strip',
      )}
    >
      {/* The unread marker is a dot in the priority colour: one glyph carrying both facts. */}
      <span className="mt-1.5 flex w-2 shrink-0 justify-center">
        {n.read ? null : <span className={cx('h-[7px] w-[7px] rounded-full', DOT[p])} />}
      </span>
      <Icon size={15} className={cx('mt-px shrink-0', n.read ? 'text-faint' : ICON_TONE[p])} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cx('label', n.read ? 'text-faint' : ICON_TONE[p])}>{kindLabel(n.kind)}</span>
          <span className="ml-auto shrink-0 font-mono text-11 tabular-nums text-faint" title={fmtClock(n.at)}>
            {fmtTime(n.at)}
          </span>
        </span>
        <span className={cx('mt-1 block text-13 leading-snug', n.read ? 'font-normal text-muted' : 'font-semibold text-text')}>
          {n.headline}
        </span>
        {n.detail ? <span className="mt-0.5 block text-12 leading-snug text-muted">{n.detail}</span> : null}
        {awaitsHuman(n) && !n.read ? (
          <span className="mt-1.5 inline-block rounded-pill bg-p1-tint px-1.5 py-px text-11 font-semibold uppercase tracking-[0.06em] text-p1-text">
            Needs a decision
          </span>
        ) : null}
      </span>
    </button>
  )
}

export interface NotificationCentreProps {
  open: boolean
  onClose: () => void
  feed: NotificationFeed
  /** Navigate to the ping's route, mark it read and close the panel. */
  onOpen: (n: Notification) => void
  /** Where the panel's left edge sits: flush against the rail, whatever width the rail is. */
  offsetLeft: number
}

export function NotificationCentre({ open, onClose, feed, onOpen, offsetLeft }: NotificationCentreProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape closes it. A panel over the working surface has to be dismissable without aiming.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const { unread, read } = useMemo(() => {
    const u: Notification[] = []
    const r: Notification[] = []
    for (const n of feed.notifications) (n.read ? r : u).push(n)
    return { unread: u, read: r }
  }, [feed.notifications])

  if (!open) return null

  return (
    <>
      {/* Deliberately light. This is not a modal — the map behind it should still be readable. */}
      <div className="fixed inset-0 z-40 bg-text/10" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Notifications"
        tabIndex={-1}
        style={{ left: offsetLeft }}
        className="fixed inset-y-0 z-50 flex w-[380px] max-w-[calc(100vw-3.5rem)] flex-col border-r border-border bg-surface shadow-panel outline-none"
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Bell size={15} className="text-muted" aria-hidden="true" />
          <h2 className="text-14 font-semibold text-text">Notifications</h2>
          {feed.unread > 0 ? (
            <span className="rounded-pill bg-p1 px-1.5 py-px font-mono text-11 leading-[15px] text-surface">{feed.unread}</span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={<CheckCheck size={13} />}
              disabled={feed.unread === 0}
              onClick={() => void feed.markAllRead()}
            >
              Mark all read
            </Button>
            <IconButton size="sm" label="Close" icon={<X size={14} />} onClick={onClose} />
          </div>
        </header>

        {feed.error ? (
          <p className="border-b border-rejected/30 bg-rejected-tint px-4 py-2 text-11 text-rejected">{feed.error}</p>
        ) : null}

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
          {feed.notifications.length === 0 ? (
            <EmptyState
              icon={<Inbox size={22} />}
              title={feed.loading ? 'Looking…' : 'Nothing has pinged yet'}
              body="When triage flags somebody, a call ends, or a unit is prepared for an address, it arrives here."
              size="full"
            />
          ) : (
            <>
              {unread.length > 0 ? (
                <>
                  <p className="label sticky top-0 z-10 border-b border-divider bg-strip px-4 py-1.5">Unread</p>
                  {unread.map((n) => (
                    <Row key={n.id} n={n} onOpen={onOpen} />
                  ))}
                </>
              ) : null}
              {read.length > 0 ? (
                <>
                  <p className="label sticky top-0 z-10 border-b border-divider bg-strip px-4 py-1.5">Earlier</p>
                  {read.map((n) => (
                    <Row key={n.id} n={n} onOpen={onOpen} />
                  ))}
                </>
              ) : null}
            </>
          )}
        </div>

        <footer className="border-t border-border bg-strip px-4 py-2 text-11 text-faint">
          Every ping is derived from something that actually happened. Nothing here is a reminder.
        </footer>
      </div>
    </>
  )
}
