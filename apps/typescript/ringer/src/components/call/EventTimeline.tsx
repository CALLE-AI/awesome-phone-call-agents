import type { ComponentType } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Languages,
  ListTree,
  MessageSquare,
  PhoneCall,
  PhoneForwarded,
  PhoneOutgoing,
  Radio,
  Sparkles,
  Voicemail,
  XCircle,
} from 'lucide-react'
import type { DeveloperEvent } from '@/lib/calle/types'
import { humanizeKey } from '@/lib/format'
import { cn } from '@/lib/cn'

const levelText: Record<string, string> = {
  info: 'text-primary',
  debug: 'text-faint',
  warning: 'text-amber-600 dark:text-amber-400',
  error: 'text-rose-600 dark:text-rose-400',
}
const levelRing: Record<string, string> = {
  info: 'bg-primary-soft text-primary-strong dark:text-primary',
  debug: 'bg-surface-2 text-faint',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  error: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
}

/**
 * Map a CALL-E developer event `type` to an icon + friendly label. Keyed on the
 * last dotted segment (e.g. `call.voicemail` → `voicemail`) so it degrades
 * gracefully for any real event type we haven't seen — unknown types still get
 * a sensible icon and a humanized label rather than raw text.
 */
const VISUALS: Record<string, { icon: ComponentType<{ className?: string }>; label: string }> = {
  queued: { icon: Clock, label: 'Queued' },
  created: { icon: Clock, label: 'Created' },
  dialing: { icon: PhoneOutgoing, label: 'Dialing' },
  ringing: { icon: Radio, label: 'Ringing' },
  ivr: { icon: ListTree, label: 'Phone menu' },
  menu: { icon: ListTree, label: 'Phone menu' },
  localized: { icon: Languages, label: 'Localized' },
  answered: { icon: PhoneCall, label: 'Answered' },
  connected: { icon: PhoneCall, label: 'Connected' },
  hold: { icon: Clock, label: 'On hold' },
  holding: { icon: Clock, label: 'On hold' },
  transfer: { icon: PhoneForwarded, label: 'Transferred' },
  transferred: { icon: PhoneForwarded, label: 'Transferred' },
  negotiating: { icon: MessageSquare, label: 'Negotiating' },
  speaking: { icon: MessageSquare, label: 'Speaking' },
  voicemail: { icon: Voicemail, label: 'Voicemail' },
  completed: { icon: CheckCircle2, label: 'Completed' },
  failed: { icon: XCircle, label: 'Failed' },
  canceled: { icon: XCircle, label: 'Canceled' },
  cancelled: { icon: XCircle, label: 'Canceled' },
}

function visualFor(type: string): { icon: ComponentType<{ className?: string }>; label: string } {
  const key = type.split('.').pop()?.toLowerCase() ?? type
  return VISUALS[key] ?? { icon: Sparkles, label: humanizeKey(key) }
}

export function EventTimeline({ events }: { events: DeveloperEvent[] }) {
  if (events.length === 0) {
    return <p className="px-1 py-4 text-sm text-faint">Waiting for the first event…</p>
  }
  return (
    <ol className="relative flex flex-col gap-3.5 pl-1">
      <span className="absolute bottom-3 left-[13px] top-3 w-px bg-border" aria-hidden="true" />
      {events.map((e) => {
        const { icon: Icon, label } = visualFor(e.type)
        const isError = e.level === 'error'
        return (
          <li key={e.id} className="relative flex animate-float-up gap-3">
            <span
              className={cn(
                'relative z-10 grid size-7 shrink-0 place-items-center rounded-full ring-4 ring-surface',
                levelRing[e.level] ?? levelRing.debug,
              )}
            >
              {isError ? <AlertTriangle className="size-3.5" /> : <Icon className="size-3.5" />}
            </span>
            <div className="min-w-0 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className={cn('text-[0.8rem] font-bold', levelText[e.level] ?? 'text-ink')}>{label}</span>
                <span className="font-mono text-[0.66rem] text-faint">{e.type}</span>
                <time className="ml-auto font-mono text-[0.66rem] text-faint">
                  {new Date(e.created_at).toLocaleTimeString(undefined, { hour12: false })}
                </time>
              </div>
              {e.message && <p className="mt-0.5 text-[0.82rem] leading-snug text-muted">{e.message}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
