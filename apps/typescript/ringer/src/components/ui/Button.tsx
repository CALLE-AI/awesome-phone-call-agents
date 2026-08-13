import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'accent' | 'ghost' | 'outline' | 'subtle' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

const variants: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-fg hover:bg-primary-strong shadow-sm active:translate-y-px',
  accent:
    'bg-accent text-accent-fg hover:bg-accent-strong shadow-sm active:translate-y-px',
  outline:
    'border border-border-strong text-ink bg-surface hover:bg-surface-2',
  ghost: 'text-muted hover:text-ink hover:bg-surface-2',
  subtle: 'bg-surface-2 text-ink hover:bg-primary-soft',
  danger: 'bg-danger text-white hover:brightness-95 active:translate-y-px',
}

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-[0.95rem] gap-2 rounded-xl',
  lg: 'h-13 px-6 text-base gap-2.5 rounded-xl',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, iconLeft, iconRight, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex cursor-pointer select-none items-center justify-center font-semibold',
        'transition-all duration-200 focus-visible:outline-2',
        'disabled:pointer-events-none disabled:opacity-55',
        sizes[size],
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  )
})
