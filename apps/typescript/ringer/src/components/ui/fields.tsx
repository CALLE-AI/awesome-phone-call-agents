import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

const baseInput =
  'w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[0.95rem] text-ink ' +
  'placeholder:text-faint transition-colors duration-150 ' +
  'focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/12'

export function Field({
  label,
  htmlFor,
  help,
  required,
  error,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  help?: string
  required?: boolean
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-sm font-semibold text-ink">
        {label}
        {required && <span className="text-accent">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger">{error}</p>
      ) : help ? (
        <p className="text-xs leading-relaxed text-muted">{help}</p>
      ) : null}
    </div>
  )
}

export function Input({
  prefix,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { prefix?: string }) {
  if (prefix) {
    return (
      <div className="flex items-stretch overflow-hidden rounded-xl border border-border bg-surface transition-colors focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/12">
        <span className="grid place-items-center border-r border-border bg-surface-2 px-3 text-sm font-semibold text-muted">
          {prefix}
        </span>
        <input
          className={cn('w-full bg-transparent px-3 py-2.5 text-[0.95rem] text-ink placeholder:text-faint focus:outline-none', className)}
          {...props}
        />
      </div>
    )
  }
  return <input className={cn(baseInput, className)} {...props} />
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} className={cn(baseInput, 'resize-y leading-relaxed', className)} {...props} />
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(baseInput, 'cursor-pointer appearance-none pr-10', className)}
        {...props}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
      </svg>
    </div>
  )
}

export function ChipsInput({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  id?: string
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (v && !value.includes(v)) onChange([...value, v])
    setDraft('')
  }
  return (
    <div className="rounded-xl border border-border bg-surface p-2 transition-colors focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/12">
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((chip) => (
            <span
              key={chip}
              className="inline-flex items-center gap-1 rounded-lg bg-primary-soft px-2 py-1 text-xs font-semibold text-primary-strong dark:text-primary"
            >
              {chip}
              <button
                type="button"
                onClick={() => onChange(value.filter((c) => c !== chip))}
                className="cursor-pointer rounded p-0.5 hover:bg-primary/20"
                aria-label={`Remove ${chip}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={add}
        placeholder={placeholder}
        className="w-full bg-transparent px-1.5 py-1 text-[0.95rem] text-ink placeholder:text-faint focus:outline-none"
      />
    </div>
  )
}
