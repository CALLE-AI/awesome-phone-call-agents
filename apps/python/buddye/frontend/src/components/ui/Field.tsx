import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cx } from './Button'

/**
 * A labelled control, with room for the sentence that explains it and the sentence that says what
 * went wrong.
 *
 * `Field` owns the id and wires `htmlFor`, `aria-describedby` and `aria-invalid` itself, because
 * the forms in this console are the ones where a person types their own name before approving an
 * ambulance — the place a missing label is least acceptable.
 *
 * Hint and error occupy the same line: the error replaces the hint rather than pushing it down, so
 * a form does not reflow while somebody is typing in it.
 */
export interface FieldProps {
  label: ReactNode
  /** Quiet guidance under the control. Replaced by `error` when there is one. */
  hint?: ReactNode
  error?: string | null
  required?: boolean
  /** Right-hand side of the label row: a character count, an "optional" note, a small action. */
  aside?: ReactNode
  className?: string
  /** Receives the id to put on the control, plus the aria wiring. */
  children: (props: { id: string; 'aria-describedby': string | undefined; 'aria-invalid': boolean | undefined }) => ReactNode
}

export function Field({ label, hint, error = null, required = false, aside, className, children }: FieldProps) {
  const id = useId()
  const noteId = `${id}-note`
  const hasNote = !!error || !!hint
  return (
    <div className={cx('min-w-0', className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-12 font-medium text-text">
          {label}
          {required ? <span className="ml-0.5 text-rejected">*</span> : null}
        </label>
        {aside ? <span className="text-11 text-faint">{aside}</span> : null}
      </div>
      {children({
        id,
        'aria-describedby': hasNote ? noteId : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {hasNote ? (
        <p id={noteId} className={cx('mt-1 text-11 leading-snug', error ? 'text-rejected' : 'text-muted')}>
          {error || hint}
        </p>
      ) : null}
    </div>
  )
}

const CONTROL =
  'w-full rounded border border-edge bg-surface px-2.5 text-13 text-text outline-none transition-colors ' +
  'placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20 ' +
  'disabled:cursor-not-allowed disabled:bg-strip disabled:text-muted ' +
  'aria-[invalid=true]:border-rejected aria-[invalid=true]:focus:ring-rejected/20'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(CONTROL, 'h-8', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cx(CONTROL, 'resize-y py-2 leading-relaxed', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(CONTROL, 'h-8 pr-8', className)} {...rest}>
      {children}
    </select>
  )
})

/** A checkbox with its label beside it. The label is the target too, which on a phone matters. */
export function Checkbox({ label, hint, className, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  const generated = useId()
  const inputId = id ?? generated
  return (
    <div className={cx('flex items-start gap-2', className)}>
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-[15px] w-[15px] shrink-0 cursor-pointer rounded-[3px] border border-edge accent-accent"
        {...rest}
      />
      <label htmlFor={inputId} className="cursor-pointer select-none text-13 leading-snug text-text">
        {label}
        {hint ? <span className="mt-0.5 block text-11 text-muted">{hint}</span> : null}
      </label>
    </div>
  )
}
