import { useEffect, useRef, useState } from 'react'
import { Building2, Phone, Search } from 'lucide-react'
import { searchDirectory, type DirectoryEntry } from '@/lib/directory'
import { maskPhone } from '@/lib/phone'
import { Badge } from '@/components/ui/Badge'

/**
 * Directory combobox: type "Comcast" or "dentist" and pick a business —
 * the E.164 number is filled automatically.
 */
export function BusinessSearch({
  onSelect,
  placeholder = 'Search businesses — “Comcast”, “dentist”, “auto repair”…',
}: {
  onSelect: (entry: DirectoryEntry) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const results = searchDirectory(query)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (entry: DirectoryEntry) => {
    onSelect(entry)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter' && results.length > 0) {
              e.preventDefault()
              pick(results[0])
            }
          }}
          placeholder={placeholder}
          aria-label="Search the business directory"
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-3.5 text-[0.95rem] text-ink placeholder:text-faint transition-colors focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/12"
        />
      </div>

      {open && query.trim().length >= 2 && (
        <div className="card soft-shadow absolute inset-x-0 top-full z-20 mt-1.5 max-h-72 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">
              No matches — type the phone number below instead.
            </p>
          ) : (
            results.map((e) => (
              <button
                key={`${e.name}-${e.phone}`}
                type="button"
                onClick={() => pick(e)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-strong dark:text-primary">
                  <Building2 className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{e.name}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    <Phone className="size-3" /> {maskPhone(e.phone)} · {e.category}
                  </span>
                </span>
                <Badge tone={e.kind === 'national' ? 'brand' : 'info'}>
                  {e.kind === 'national' ? 'Public line' : 'Demo listing'}
                </Badge>
              </button>
            ))
          )}
          <p className="border-t border-border px-3 py-2 text-[0.7rem] leading-relaxed text-faint">
            Public lines come from public listings — verify before calling. Demo listings are fictional.
          </p>
        </div>
      )}
    </div>
  )
}
