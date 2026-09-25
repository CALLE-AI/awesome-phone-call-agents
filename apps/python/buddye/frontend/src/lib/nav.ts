/**
 * The console's navigation model, in one place.
 *
 * The rail, the content header and the notification centre all have to agree about what a section
 * is called and where it lives. Keeping that in a module rather than inside the rail component
 * means a page can ask "what is this screen called" without importing the chrome, and means the
 * route table in `App.tsx` has exactly one shadow instead of three.
 *
 * The order is the order the evening is worked, not alphabetical and not by importance:
 *
 *   Operations   the map — where you watch what is already moving
 *   Sweep        the people — the cases, one row each
 *   Incidents    the deployment cases — where a human approves or denies
 *   Approvals    the record of what was decided
 *   Fleet        the assets themselves
 *
 * `Live` sits apart at the bottom. It is the original dense console, kept as a deep link rather
 * than promoted to a peer of the five: it is a diagnostic view, not a step in the flow.
 */
import {
  Bell,
  ClipboardList,
  Map,
  ScrollText,
  Siren,
  Terminal,
  Truck,
  type LucideIcon,
} from 'lucide-react'

export type SectionKey = 'operations' | 'sweep' | 'incidents' | 'approvals' | 'fleet' | 'live'

export interface NavSection {
  key: SectionKey
  /** What the rail row says, and the title of the content header. */
  label: string
  /** One line of what this screen is for. Shown as the collapsed rail's tooltip. */
  hint: string
  icon: LucideIcon
  /** Path segment under `/hazards/:hazardId`. `''` is the index route. */
  segment: string
  /** `NavLink`'s `end`: only the index route needs exact matching, or it lights up everywhere. */
  end: boolean
}

export const SECTIONS: readonly NavSection[] = [
  {
    key: 'operations',
    label: 'Operations',
    hint: 'The map. Everything currently moving, and where it is.',
    icon: Map,
    segment: '',
    end: true,
  },
  {
    key: 'sweep',
    label: 'Sweep',
    hint: 'Everybody under watch tonight, one case each.',
    icon: ClipboardList,
    segment: 'sweep',
    end: false,
  },
  {
    key: 'incidents',
    label: 'Incidents',
    hint: 'Deployment cases. Approve or deny, one address at a time.',
    icon: Siren,
    segment: 'incidents',
    end: false,
  },
  {
    key: 'approvals',
    label: 'Approvals',
    hint: 'The record of what was approved, denied and deployed.',
    icon: ScrollText,
    segment: 'approvals',
    end: false,
  },
  {
    key: 'fleet',
    label: 'Fleet',
    hint: 'Every asset, where it is and what it can do.',
    icon: Truck,
    segment: 'fleet',
    end: false,
  },
] as const

/** Below the divider. Not part of the flow; kept because it is still the densest read of a sweep. */
export const SECONDARY_SECTIONS: readonly NavSection[] = [
  {
    key: 'live',
    label: 'Live console',
    hint: 'The original call-by-call console. Every event as it lands.',
    icon: Terminal,
    segment: 'live',
    end: false,
  },
] as const

export const ALL_SECTIONS: readonly NavSection[] = [...SECTIONS, ...SECONDARY_SECTIONS]

/** The notification centre is a rail row too, but it opens a panel rather than navigating. */
export const NOTIFICATIONS_ICON: LucideIcon = Bell

/**
 * Where a rail row points.
 *
 * `hazardId` is genuinely optional: `App.tsx` routes `/` to the layout with no param while it looks
 * up the newest hazard and rewrites the address. The rail renders during that beat, so every row
 * has to have somewhere to point — and `/` is the only honest answer until a hazard is known.
 */
export function hazardPath(hazardId: string | undefined, segment: string): string {
  if (!hazardId) return '/'
  return segment ? `/hazards/${hazardId}/${segment}` : `/hazards/${hazardId}`
}

/**
 * Which section a URL belongs to, for the content header.
 *
 * Matched on the segment after the hazard id, longest first, so `/incidents/inc_1` titles as
 * Incidents rather than falling through to the index route.
 */
export function sectionForPath(pathname: string): NavSection | null {
  const m = pathname.match(/^\/hazards\/[^/]+(?:\/(.*))?$/)
  if (!m) return null
  const rest = (m[1] ?? '').replace(/\/+$/, '')
  if (!rest) return ALL_SECTIONS.find((s) => s.segment === '') ?? null
  const head = rest.split('/')[0]
  return ALL_SECTIONS.find((s) => s.segment === head) ?? null
}

// ---------------------------------------------------------------------------
// Rail counts
// ---------------------------------------------------------------------------

/**
 * A number on a rail row.
 *
 * Two tones only, and the distinction is the whole point of the badge: `urgent` means a person is
 * waiting and nothing moves until they act; `muted` means "this is how many there are". A rail full
 * of red numbers teaches people to stop reading red numbers, so `urgent` is spent sparingly — in
 * practice on Incidents, when one of the open cases has an agency unit prepared and unsent.
 */
export interface NavCount {
  value: number
  tone: 'urgent' | 'muted'
  /** Long form, for the row's title attribute. The badge itself is only ever a number. */
  title?: string
}

export type NavCounts = Partial<Record<SectionKey, NavCount>>
