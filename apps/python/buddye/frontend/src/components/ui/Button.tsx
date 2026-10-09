import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import clsx, { type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * `cn` from `lib/utils` is clsx alone, so a caller's `className` cannot reliably beat a base class —
 * `px-3` and `px-6` would both survive and the later one in the stylesheet wins, not the later one
 * in the string. Every primitive in this directory takes a `className` that is meant to override,
 * so they merge properly. It lives here rather than in `lib/utils` because that file belongs to
 * another part of the console and this is a change of behaviour, not an addition.
 */
export function cx(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  // Near-black rather than a brand colour. In an operations console the accent has to stay
  // reserved for meaning; if every confirm button is blue, blue stops meaning anything.
  primary: 'bg-text text-surface border border-text hover:bg-[#2a2c33] hover:border-[#2a2c33]',
  secondary: 'bg-surface text-text border border-edge hover:bg-strip hover:border-faint/60',
  danger: 'bg-rejected text-surface border border-rejected hover:bg-[#801f1f] hover:border-[#801f1f]',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-strip hover:text-text',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-12',
  md: 'h-8 gap-2 px-3 text-13',
  lg: 'h-9 gap-2 px-4 text-13',
}

export interface ButtonStyle {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Fill the row. For a rail footer or a narrow panel. */
  block?: boolean
}

/**
 * The class string on its own, for the places a button has to be an anchor or a `<Link>` — a row
 * that navigates is a link and should behave like one (middle-click, copy address), so styling it
 * as a button is the honest way round rather than a `<button>` calling `navigate()`.
 */
export function buttonClass({ variant = 'secondary', size = 'md', block = false }: ButtonStyle = {}, className?: string): string {
  return cx(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded font-medium no-underline transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
    'disabled:pointer-events-none disabled:opacity-40',
    'aria-disabled:pointer-events-none aria-disabled:opacity-40',
    SIZE[size],
    VARIANT[variant],
    block && 'w-full',
    className,
  )
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>, ButtonStyle {
  /** Shows a spinner in place of `icon` and disables the button. The label stays put. */
  loading?: boolean
  /** Leading glyph. Sized by the caller; 14px reads right next to 13px text. */
  icon?: ReactNode
  children?: ReactNode
}

/**
 * Enterprise weight: 1px border on every variant so the row height never shifts between them, a
 * 6px radius, no gradient and no shadow. The only motion is the colour.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, loading = false, icon, children, className, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, block }, className)}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
})

/**
 * A square button holding nothing but a glyph. `label` is required because an icon with no
 * accessible name is a button nobody using a screen reader can press.
 */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  className,
  ...rest
}: Omit<ButtonProps, 'children' | 'icon' | 'block'> & { label: string; icon: ReactNode }) {
  const square = size === 'sm' ? 'w-7 px-0' : size === 'lg' ? 'w-9 px-0' : 'w-8 px-0'
  return (
    <Button variant={variant} size={size} aria-label={label} title={label} className={cx(square, className)} {...rest}>
      {icon}
    </Button>
  )
}
