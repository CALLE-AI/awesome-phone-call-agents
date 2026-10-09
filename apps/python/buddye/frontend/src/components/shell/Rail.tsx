import { NavLink } from 'react-router-dom'
import { CircleAlert, PanelLeftClose, PanelLeftOpen, Thermometer, Wind, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCalleStatus } from '../../hooks/useCalleStatus'
import { NOTIFICATIONS_ICON, SECONDARY_SECTIONS, SECTIONS, hazardPath, type NavCounts, type NavSection } from '../../lib/nav'
import { cx } from '../ui/Button'
import { initials } from '../../lib/utils'
import type { ConnectionState, Dashboard, Hazard } from '../../types'

/**
 * The left rail: graphite, quiet, and never the thing you are looking at.
 *
 * Navigation used to be a tab strip across the top, which put five words in the operator's line of
 * sight above every page and cost a row of vertical space on the one screen — a map — that wants
 * all of it. Moving it to a dark column does three things: it separates chrome from work by value
 * rather than by a hairline, it gives every section a permanent home your hand learns, and it
 * leaves the top of the page free for the page's own title.
 *
 * The bottom third is the standing state of the evening — which hazard, whether the stream is
 * connected, which CALL-E provider is wired up and how much live-call budget is left, and who is on
 * shift. It sits down there rather than in a header because none of it changes minute to minute,
 * but all of it is worth being able to glance at without leaving the page.
 */

export const RAIL_WIDTH = 232
export const RAIL_WIDTH_COLLAPSED = 56

const CONNECTION: Record<ConnectionState, { label: string; dot: string }> = {
  connecting: { label: 'connecting', dot: 'bg-rail-muted animate-pulseDot' },
  open: { label: 'live', dot: 'bg-verified' },
  reconnecting: { label: 'reconnecting', dot: 'bg-p3 animate-pulseDot' },
  closed: { label: 'offline', dot: 'bg-rail-edge' },
}

/** Hazard severity, in the same priority scale everything else on the console is drawn in. */
const SEVERITY_DOT: Record<string, string> = {
  emergency: 'bg-p1',
  warning: 'bg-p2',
  watch: 'bg-p3',
  advisory: 'bg-p4',
}

const SEVERITY_TEXT: Record<string, string> = {
  emergency: 'text-p1',
  warning: 'text-p2',
  watch: 'text-p3',
  advisory: 'text-p4',
}

/**
 * A glyph for the hazard, used when the rail is icons-only.
 *
 * A bare coloured dot down there would be a third unexplained dot in a column of them. The shape
 * says heat or power cut on its own, and the tooltip carries the headline.
 */
const HAZARD_ICON: Record<string, LucideIcon> = {
  heat: Thermometer,
  outage: Zap,
  power_outage: Zap,
  smoke: Wind,
  air_quality: Wind,
}

function providerShort(provider: string | undefined | null): string {
  if (!provider) return 'unknown'
  if (provider === 'calle_sdk') return 'CALL-E sdk'
  if (provider === 'calle_mcp') return 'CALL-E mcp'
  if (provider === 'mock') return 'mock'
  return provider
}

// ---------------------------------------------------------------------------

function Row({
  section,
  hazardId,
  collapsed,
  count,
}: {
  section: NavSection
  hazardId: string | undefined
  collapsed: boolean
  count: NavCounts[keyof NavCounts]
}) {
  const Icon = section.icon
  return (
    <NavLink
      to={hazardPath(hazardId, section.segment)}
      end={section.end}
      title={collapsed ? `${section.label} — ${section.hint}` : section.hint}
      className={({ isActive }) =>
        cx(
          'group relative flex h-8 items-center rounded-[5px] text-13 no-underline transition-colors',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
          isActive
            ? // shadow-railRow is the 2px white spine that marks the current section.
              'bg-rail-tint font-medium text-rail-active shadow-railRow'
            : 'text-rail-text hover:bg-rail-raised hover:text-rail-active',
        )
      }
    >
      <Icon size={15} className="shrink-0" aria-hidden="true" />
      {collapsed ? null : <span className="truncate">{section.label}</span>}
      {count && count.value > 0 ? (
        <span
          title={count.title}
          className={cx(
            'inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-pill px-1 font-mono text-11 leading-none tabular-nums',
            collapsed && 'absolute right-1 top-1 h-[14px] min-w-[14px] px-[3px] text-[9px]',
            !collapsed && 'ml-auto',
            count.tone === 'urgent' ? 'bg-p1 text-surface' : 'bg-rail-edge text-rail-text',
          )}
        >
          {count.value}
        </span>
      ) : null}
    </NavLink>
  )
}

export interface RailProps {
  hazardId?: string
  hazard: Hazard | null
  dashboard: Dashboard | null
  connection: ConnectionState
  counts: NavCounts
  unread: number
  notificationsOpen: boolean
  onOpenNotifications: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function Rail({
  hazardId,
  hazard,
  dashboard,
  connection,
  counts,
  unread,
  notificationsOpen,
  onOpenNotifications,
  collapsed,
  onToggleCollapsed,
}: RailProps) {
  const { status } = useCalleStatus()
  const conn = CONNECTION[connection]
  const Bell = NOTIFICATIONS_ICON

  const provider = providerShort(status?.provider ?? dashboard?.provider)
  const live = status?.live === true
  const used = status?.budget?.used ?? dashboard?.real_calls_used ?? 0
  const max = status?.budget?.max ?? dashboard?.real_calls_budget ?? 0
  const captain = dashboard?.block_captain ?? ''

  return (
    <nav
      aria-label="Sections"
      style={{ width: collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH }}
      className="sticky top-0 z-30 flex h-screen shrink-0 flex-col border-r border-rail-edge bg-rail transition-[width] duration-150"
    >
      {/* ------------------------------------------------------------------ mark */}
      <div className={cx('flex h-12 shrink-0 items-center border-b border-rail-edge', collapsed ? 'justify-center px-0' : 'gap-2.5 px-3')}>
        <span className="relative flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] bg-rail-raised ring-1 ring-inset ring-rail-edge">
          <span className="h-[7px] w-[7px] rounded-full bg-verified" />
        </span>
        {collapsed ? null : (
          <span className="min-w-0">
            <span className="block text-14 font-semibold leading-none tracking-tight text-rail-active">BuddyE</span>
            <span className="mt-1 block text-11 leading-none text-rail-muted">block response console</span>
          </span>
        )}
      </div>

      {/* ------------------------------------------------------- the notification bell */}
      <div className={cx('shrink-0 border-b border-rail-edge py-2', collapsed ? 'px-1.5' : 'px-2')}>
        <button
          type="button"
          onClick={onOpenNotifications}
          title="Notifications"
          aria-expanded={notificationsOpen}
          className={cx(
            'relative flex h-8 w-full items-center rounded-[5px] text-13 transition-colors',
            collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
            notificationsOpen ? 'bg-rail-tint text-rail-active' : 'text-rail-text hover:bg-rail-raised hover:text-rail-active',
          )}
        >
          <Bell size={15} className="shrink-0" aria-hidden="true" />
          {collapsed ? null : <span className="truncate">Notifications</span>}
          {unread > 0 ? (
            <span
              className={cx(
                'inline-flex items-center justify-center rounded-pill bg-p1 font-mono leading-none tabular-nums text-surface',
                collapsed
                  ? 'absolute right-0.5 top-0.5 h-[14px] min-w-[14px] px-[3px] text-[9px]'
                  : 'ml-auto h-[16px] min-w-[16px] px-1 text-11',
              )}
            >
              {unread}
            </span>
          ) : null}
        </button>
      </div>

      {/* ------------------------------------------------------------------ sections */}
      <div className={cx('thin-scroll min-h-0 flex-1 overflow-y-auto py-2', collapsed ? 'px-1.5' : 'px-2')}>
        {collapsed ? null : <p className="px-2.5 pb-1.5 text-11 font-semibold uppercase tracking-[0.06em] text-rail-muted">Response</p>}
        <div className="flex flex-col gap-px">
          {SECTIONS.map((s) => (
            <Row key={s.key} section={s} hazardId={hazardId} collapsed={collapsed} count={counts[s.key]} />
          ))}
        </div>
        <div className="my-2 border-t border-rail-edge" />
        <div className="flex flex-col gap-px">
          {SECONDARY_SECTIONS.map((s) => (
            <Row key={s.key} section={s} hazardId={hazardId} collapsed={collapsed} count={counts[s.key]} />
          ))}
        </div>
      </div>

      {/* --------------------------------------------------------- standing state */}
      <div className={cx('shrink-0 border-t border-rail-edge', collapsed ? 'px-1.5 py-2' : 'px-3 py-2.5')}>
        {/* The hazard. Collapsed, it survives as a single dot in the severity colour. */}
        {hazard ? (
          collapsed ? (
            <div className="flex justify-center py-1" title={`${hazard.severity} — ${hazard.headline} — ${hazard.area}`}>
              {(() => {
                const HazardIcon = HAZARD_ICON[hazard.kind] ?? CircleAlert
                return <HazardIcon size={15} className={SEVERITY_TEXT[hazard.severity] ?? 'text-p4'} aria-hidden="true" />
              })()}
            </div>
          ) : (
            <div className="mb-2.5">
              <div className="flex items-center gap-1.5">
                <span className={cx('h-[7px] w-[7px] shrink-0 rounded-full', SEVERITY_DOT[hazard.severity] ?? 'bg-p4')} />
                <span className="text-11 font-semibold uppercase tracking-[0.06em] text-rail-muted">{hazard.severity}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-12 leading-snug text-rail-text" title={hazard.headline}>
                {hazard.headline}
              </p>
              <p className="mt-0.5 text-11 text-rail-muted">{hazard.area}</p>
            </div>
          )
        ) : null}

        {/* The stream. If this stops saying "live", nothing else on the console is moving. */}
        <div
          className={cx('flex items-center gap-1.5', collapsed && 'justify-center py-1')}
          title={`Event stream: ${conn.label}`}
        >
          <span className={cx('h-[7px] w-[7px] shrink-0 rounded-full', conn.dot)} />
          {collapsed ? null : <span className="font-mono text-11 text-rail-muted">{conn.label}</span>}
        </div>

        {/* CALL-E. `live` means this console can put a real phone call into somebody's house, so it
            is stated in words and in red rather than left to a provider string nobody parses. */}
        <div
          className={cx('mt-1.5 flex items-center gap-1.5', collapsed && 'justify-center py-1')}
          title={`${provider} · ${live ? 'LIVE — real calls' : 'mock provider'} · live calls ${used} of ${max}`}
        >
          {collapsed ? (
            <span className={cx('h-[7px] w-[7px] rounded-full', live ? 'bg-p1' : 'bg-rail-edge')} />
          ) : (
            <>
              <span className="truncate font-mono text-11 text-rail-muted">{provider}</span>
              {live ? (
                <span className="rounded-pill bg-p1 px-1 py-px font-mono text-[9px] font-semibold leading-none tracking-[0.08em] text-surface">
                  LIVE
                </span>
              ) : null}
              <span className="ml-auto shrink-0 font-mono text-11 tabular-nums text-rail-muted">
                {used}/{max}
              </span>
            </>
          )}
        </div>

        {/* Who is on shift. Every approval in this product is signed with a person's name. */}
        {captain ? (
          <div className={cx('mt-2.5 flex items-center gap-2 border-t border-rail-edge pt-2.5', collapsed && 'justify-center')} title={captain}>
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-rail-raised font-mono text-11 text-rail-text ring-1 ring-inset ring-rail-edge">
              {initials(captain)}
            </span>
            {collapsed ? null : (
              <span className="min-w-0">
                <span className="block truncate text-12 leading-tight text-rail-text">{captain}</span>
                <span className="block text-11 leading-tight text-rail-muted">on shift</span>
              </span>
            )}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className={cx(
            'mt-2 flex h-7 w-full items-center rounded-[5px] text-11 text-rail-muted transition-colors hover:bg-rail-raised hover:text-rail-active',
            collapsed ? 'justify-center px-0' : 'gap-2 px-2.5',
          )}
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          {collapsed ? null : <span>Collapse</span>}
        </button>
      </div>
    </nav>
  )
}
