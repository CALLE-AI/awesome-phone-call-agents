import { cn } from '../lib/utils'
import type { BoardPerson } from '../lib/board'
import type { UnaccountedRow } from '../types'

/**
 * The evening in six numbers.
 *
 * "Nobody accounted for" is in the row and it is never hidden when it is zero-by-luck — a captain
 * closing the board needs to see that number, and a tally that quietly omits it when it is
 * inconvenient is how somebody gets left in a hot house.
 */
export function SweepTally({ board, unaccounted }: { board: BoardPerson[]; unaccounted: UnaccountedRow[] }) {
  const count = (fn: (p: BoardPerson) => boolean) => board.filter(fn).length
  const cells: { label: string; value: number; tone: string }[] = [
    { label: 'No answer', value: count((p) => p.outcome === 'UNREACHABLE'), tone: 'text-rejected' },
    { label: 'Urgent', value: count((p) => p.outcome === 'URGENT'), tone: 'text-rejected' },
    { label: 'Needs help', value: count((p) => p.outcome === 'NEEDS_HELP'), tone: 'text-partial' },
    { label: 'Safe', value: count((p) => p.outcome === 'SAFE' || p.outcome === 'HELP_DECLINED'), tone: 'text-verified-text' },
    { label: 'Nobody accounted for', value: unaccounted.length, tone: 'text-text' },
  ]
  if (board.length === 0) return null

  return (
    <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-edge sm:grid-cols-5">
      {cells.map((c, i) => (
        // Five cells over two columns leaves a hole on a phone; the last one takes the whole row.
        <div key={c.label} className={cn('bg-surface px-3 py-2.5', i === cells.length - 1 && 'col-span-2 sm:col-span-1')}>
          <div className={cn('text-22 font-semibold leading-none tabular-nums', c.value === 0 ? 'text-null' : c.tone)}>
            {c.value}
          </div>
          <div className="mt-1 text-11 leading-tight text-faint">{c.label}</div>
        </div>
      ))}
    </div>
  )
}
