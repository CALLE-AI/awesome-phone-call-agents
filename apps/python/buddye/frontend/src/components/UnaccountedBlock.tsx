import { unaccountedLabel } from '../lib/status'
import type { UnaccountedRow } from '../types'

/**
 * Everyone nobody has accounted for.
 *
 * This block exists because the failure mode of a check-in sweep is not a bad call — it is a person
 * who quietly never appears on any list. Deliberately worded as a fact rather than an error, and
 * deliberately not merged into "No answer": Gerald Pryce never opted in, so nobody rang him, which
 * is a completely different thing from a phone that rang out at a house with an oxygen
 * concentrator in it.
 */
export function UnaccountedBlock({ rows }: { rows: UnaccountedRow[] }) {
  if (!rows.length) return null
  return (
    <section className="card mb-4 overflow-hidden">
      <div className="border-b border-divider px-4 py-2.5">
        <span className="label">Nobody has accounted for these people</span>
        <p className="mt-1 text-12 leading-snug text-muted">
          BuddyE did not speak to them and did not ring them. They are still on your list.
        </p>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.neighbour_id} className="flex flex-wrap items-baseline gap-x-2 border-b border-divider px-4 py-2.5 last:border-b-0">
            <span className="text-13 font-medium text-text">{r.name}</span>
            <span className="pill bg-ground text-muted">{unaccountedLabel(r.kind)}</span>
            <span className="w-full text-12 leading-snug text-muted sm:w-auto sm:flex-1">{r.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
