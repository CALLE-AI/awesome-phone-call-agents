import { ConnectionStrip } from './ConnectionStrip'
import type { ConnectionState, Dashboard } from '../types'
import { cn } from '../lib/utils'

const CONNECTION_META: Record<ConnectionState, { text: string; dot: string }> = {
  connecting: { text: 'connecting', dot: 'bg-faint' },
  open: { text: 'live', dot: 'bg-verified' },
  reconnecting: { text: 'reconnecting', dot: 'bg-partial animate-pulseDot' },
  closed: { text: 'offline', dot: 'bg-edge' },
}

export function TopBar({
  dashboard,
  connection,
  children,
}: {
  dashboard: Dashboard | null
  connection: ConnectionState
  children?: React.ReactNode
}) {
  const c = CONNECTION_META[connection]
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-15 font-semibold tracking-tight text-text">BuddyE</span>
          <span className="truncate text-12 text-muted">
            {dashboard ? `${dashboard.block_captain} · ${dashboard.area}` : 'block check-in'}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="flex h-7 items-center gap-1.5 rounded border border-border bg-strip px-2 font-mono text-11 text-muted">
            <span className={cn('h-[7px] w-[7px] rounded-full', c.dot)} />
            {c.text}
          </span>
          <ConnectionStrip />
        </div>
        {children ? <div className="flex w-full items-center gap-2 sm:w-auto">{children}</div> : null}
      </div>
    </header>
  )
}
