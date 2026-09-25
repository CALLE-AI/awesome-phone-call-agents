import { useEffect } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowRight, Bell, CircleAlert, Lock, PhoneOff, Siren, Truck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { TOAST_MS, awaitsHuman, isSticky, kindLabel, type Notification } from '../../hooks/useNotifications'
import { clampPriority } from '../ui/Badge'
import { cx } from '../ui/Button'
import { fmtTime } from '../../lib/utils'

/**
 * The ping, on top of everything.
 *
 * This is where the console's flow begins: something happens on the block, it lands here, and one
 * click puts the operator on the page where she can do something about it. So the whole card is the
 * target and the route is the backend's — `notifications.py::route_for` decides where a ping goes,
 * because it is the thing that knows whether this is a person, an incident, or the evening.
 *
 * Two rules the styling has to keep:
 *
 *   * A toast that awaits a human never leaves on its own. `isSticky` decides; the timer lives in
 *     `useNotifications`, and nothing here can start one.
 *   * The headline is printed verbatim. An approval request says "prepared … nothing has been
 *     sent", and the call to action says **Open**, never Send or Dispatch. BuddyE cannot send an
 *     agency unit and the interface must not imply otherwise.
 */

const KIND_ICON: Record<string, LucideIcon> = {
  'hazard.declared': CircleAlert,
  'case.flagged': Siren,
  'call.finished': PhoneOff,
  'deployment.opened': Siren,
  'deployment.awaiting_authorisation': Lock,
  'asset.arrived': Truck,
}

/** The 3px spine down the left of the card, in the incident priority scale. */
const EDGE: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'border-l-p1', 2: 'border-l-p2', 3: 'border-l-p3', 4: 'border-l-p4', 5: 'border-l-p5',
}

const ICON_TONE: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'text-p1', 2: 'text-p2', 3: 'text-p3', 4: 'text-p4', 5: 'text-p5',
}

export interface ToastProps {
  notification: Notification
  /** Navigate to `notification.route` and mark it read. */
  onOpen: (n: Notification) => void
  /** Take it off the screen. Does not mark it read — it stays in the centre. */
  onDismiss: (id: string) => void
}

export function Toast({ notification: n, onOpen, onDismiss }: ToastProps) {
  const p = clampPriority(n.priority)
  const Icon = KIND_ICON[n.kind] ?? Bell
  const held = awaitsHuman(n)
  const sticky = isSticky(n)

  /**
   * A routine toast times itself out, and each one owns its own clock.
   *
   * Deliberately here rather than in a single effect over the whole stack: one effect keyed on the
   * list of visible toasts would clear and rebuild every timer whenever any toast arrived or left,
   * so a steady trickle of pings would keep resetting the countdown on the ones already up and the
   * stack would never drain. Keyed on this notification's id, an arrival next door cannot touch it.
   *
   * Sticky toasts get no timer at all. That is the rule the product cannot break: nothing waiting
   * on a human ever leaves the screen by itself.
   */
  useEffect(() => {
    if (sticky) return
    const timer = window.setTimeout(() => onDismiss(n.id), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [n.id, sticky, onDismiss])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(n)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(n)}
      onKeyDown={onKey}
      // Anything a person is being waited on for is announced immediately rather than when the
      // screen reader next comes up for air.
      aria-live={isSticky(n) ? 'assertive' : 'polite'}
      className={cx(
        'group w-[352px] max-w-[calc(100vw-2rem)] cursor-pointer rounded border border-border border-l-[3px] bg-surface',
        'animate-slideIn shadow-toast transition-colors hover:bg-active',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        EDGE[p],
      )}
    >
      <div className="flex items-start gap-2.5 px-3 pb-2.5 pt-2.5">
        <Icon size={15} className={cx('mt-px shrink-0', ICON_TONE[p])} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cx('label', ICON_TONE[p])}>{kindLabel(n.kind)}</span>
            <span className="ml-auto shrink-0 font-mono text-11 tabular-nums text-faint">{fmtTime(n.at)}</span>
          </div>
          <p className="mt-1 text-13 font-semibold leading-snug text-text">{n.headline}</p>
          {n.detail ? <p className="mt-0.5 line-clamp-2 text-12 leading-snug text-muted">{n.detail}</p> : null}
          <div className="mt-2 flex items-center gap-2">
            {held ? (
              <span className="rounded-pill bg-p1-tint px-1.5 py-px text-11 font-semibold uppercase tracking-[0.06em] text-p1-text">
                Needs a decision
              </span>
            ) : null}
            <span className="ml-auto inline-flex items-center gap-1 text-12 font-medium text-accent">
              Open
              <ArrowRight size={13} aria-hidden="true" />
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          title="Dismiss — it stays in the notification centre"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss(n.id)
          }}
          // Always visible, not hover-revealed. A sticky toast cannot time out, so the way to get
          // rid of one has to be findable without a mouse hovering over it first.
          className="-mr-1 -mt-1 shrink-0 rounded-pill p-1 text-edge transition-colors hover:bg-ground hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export interface ToastStackProps {
  toasts: Notification[]
  onOpen: (n: Notification) => void
  onDismiss: (id: string) => void
  /** How many more are queued behind the visible ones. Clicking the counter opens the centre. */
  overflow?: number
  onOverflow?: () => void
}

/**
 * Bottom right, stacked upward, newest nearest the corner.
 *
 * Bottom rather than top because the top of this console is where the page says what it is, and a
 * card that lands over a case headline hides the thing the operator just clicked through to read.
 *
 * `toasts` arrives oldest first. The box is pinned to the bottom and grows upward, so rendering in
 * that order puts the newest arrival closest to the corner and pushes the older ones up out of the
 * way — the eye stays in one place while the stack moves.
 */
export function ToastStack({ toasts, onOpen, onDismiss, overflow = 0, onOverflow }: ToastStackProps) {
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
      {overflow > 0 ? (
        <button
          type="button"
          onClick={onOverflow}
          className="pointer-events-auto rounded border border-border bg-surface px-2.5 py-1 font-mono text-11 text-muted shadow-toast transition-colors hover:bg-active hover:text-text"
        >
          +{overflow} more
        </button>
      ) : null}
      {toasts.map((n) => (
        <div key={n.id} className="pointer-events-auto">
          <Toast notification={n} onOpen={onOpen} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  )
}
