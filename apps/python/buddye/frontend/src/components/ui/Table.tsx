import { useCallback, useMemo, useState } from 'react'
import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { cx } from './Button'

/**
 * A dense operations table.
 *
 * Zebra striping is deliberately absent. Alternating rows are a crutch for tables with no vertical
 * rhythm; a hairline between rows and a hover tint do the same job without painting half the data a
 * different colour, and colour in this console is supposed to mean something.
 *
 * Composable parts rather than a `columns` config, because the cells here are rarely just text — a
 * priority chip, a masked phone number, a live ETA in mono — and a render-prop table ends up being
 * the same JSX with more indirection. `useSort` supplies the state; the header supplies the arrow.
 */

export function TableWrap({ className, children }: { className?: string; children: ReactNode }) {
  // Tables are the one thing on these pages wide enough to break a narrow window, so they scroll
  // inside their own box rather than pushing the page sideways.
  return <div className={cx('thin-scroll w-full overflow-x-auto', className)}>{children}</div>
}

export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cx('w-full border-collapse text-13', className)} {...rest}>
      {children}
    </table>
  )
}

export function THead({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cx('border-b border-edge bg-strip', className)} {...rest}>
      {children}
    </thead>
  )
}

export function TBody({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cx('divide-y divide-divider', className)} {...rest}>
      {children}
    </tbody>
  )
}

export interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  /** The row opens something. Adds the hover tint and a pointer. */
  interactive?: boolean
  /** This row is the one being looked at — the expanded incident, the open case. */
  selected?: boolean
}

export function Tr({ interactive = false, selected = false, className, children, ...rest }: TrProps) {
  return (
    <tr
      className={cx(
        'transition-colors',
        interactive && 'cursor-pointer hover:bg-active',
        selected && 'bg-active shadow-activeRow',
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  )
}

export type SortDirection = 'asc' | 'desc'

export interface ThProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'onClick'> {
  /** Right-align. For every column of numbers, without exception. */
  numeric?: boolean
  sortable?: boolean
  /** `null` when this column is not the one being sorted by. */
  sortDirection?: SortDirection | null
  onSort?: () => void
  children?: ReactNode
}

export function Th({ numeric = false, sortable = false, sortDirection = null, onSort, className, children, ...rest }: ThProps) {
  const Arrow = sortDirection === 'asc' ? ChevronUp : sortDirection === 'desc' ? ChevronDown : ChevronsUpDown
  return (
    <th
      scope="col"
      aria-sort={sortDirection === 'asc' ? 'ascending' : sortDirection === 'desc' ? 'descending' : sortable ? 'none' : undefined}
      className={cx(
        'whitespace-nowrap px-3 py-2 text-11 font-semibold uppercase text-faint',
        numeric && 'text-right',
        className,
      )}
      style={{ letterSpacing: '0.06em' }}
      {...rest}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cx(
            'inline-flex items-center gap-1 rounded-pill text-11 font-semibold uppercase transition-colors hover:text-text',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35',
            sortDirection ? 'text-text' : 'text-faint',
            numeric && 'flex-row-reverse',
          )}
          style={{ letterSpacing: '0.06em' }}
        >
          {children}
          <Arrow size={12} className={sortDirection ? 'opacity-90' : 'opacity-40'} aria-hidden="true" />
        </button>
      ) : (
        children
      )}
    </th>
  )
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean
  /** Numbers that change — an ETA, a distance, a speed — so they do not jitter as they tick. */
  mono?: boolean
  muted?: boolean
}

export function Td({ numeric = false, mono = false, muted = false, className, children, ...rest }: TdProps) {
  return (
    <td
      className={cx(
        'px-3 py-2 align-middle text-13 text-text',
        numeric && 'text-right',
        mono && 'font-mono tabular-nums',
        muted && 'text-muted',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  )
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export interface SortState<K extends string> {
  key: K
  direction: SortDirection
  /** Click a header: same column flips direction, a new column starts at `defaultDirection`. */
  toggle: (key: K) => void
  /** `null` for every column except the one being sorted by — feed it straight to `Th`. */
  directionFor: (key: K) => SortDirection | null
  /** The rows, sorted. Stable: equal values keep the order the API returned them in. */
  sorted: <T>(rows: readonly T[], value: (row: T, key: K) => string | number | null | undefined) => T[]
}

/**
 * Sort state for a table.
 *
 * Stable by construction — it sorts an array of `[row, index]` pairs and falls back to the index —
 * because the API already returns incidents worst-first and a re-sort by name should not scramble
 * that ordering inside a tie.
 */
export function useSort<K extends string>(initialKey: K, initialDirection: SortDirection = 'asc'): SortState<K> {
  const [key, setKey] = useState<K>(initialKey)
  const [direction, setDirection] = useState<SortDirection>(initialDirection)

  const toggle = useCallback(
    (next: K) => {
      setKey((current) => {
        if (current === next) {
          setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
          return current
        }
        setDirection(initialDirection)
        return next
      })
    },
    [initialDirection],
  )

  const directionFor = useCallback((k: K) => (k === key ? direction : null), [key, direction])

  const sorted = useCallback(
    <T,>(rows: readonly T[], value: (row: T, k: K) => string | number | null | undefined): T[] => {
      const sign = direction === 'asc' ? 1 : -1
      return rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => {
          const av = value(a.row, key)
          const bv = value(b.row, key)
          // Missing values sink, whichever way the column is pointing: an empty cell is not the
          // best row in the table and it is not the worst either, it is simply unknown.
          if (av == null && bv == null) return a.index - b.index
          if (av == null) return 1
          if (bv == null) return -1
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign || a.index - b.index
          return String(av).localeCompare(String(bv)) * sign || a.index - b.index
        })
        .map((entry) => entry.row)
    },
    [key, direction],
  )

  return useMemo(() => ({ key, direction, toggle, directionFor, sorted }), [key, direction, toggle, directionFor, sorted])
}
