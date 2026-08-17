import {
  TrendingDown,
  Scissors,
  CalendarCheck,
  Undo2,
  BadgeDollarSign,
  MessageCircleQuestion,
  Sparkles,
  Phone,
  type LucideIcon,
} from 'lucide-react'

const MAP: Record<string, LucideIcon> = {
  TrendingDown,
  Scissors,
  CalendarCheck,
  Undo2,
  BadgeDollarSign,
  MessageCircleQuestion,
  Sparkles,
}

export function TemplateIcon({ name, className }: { name: string; className?: string }) {
  const Icon = MAP[name] ?? Phone
  return <Icon className={className} />
}

const ACCENTS: Record<string, string> = {
  violet: 'text-violet-600 dark:text-violet-400 bg-violet-500/12',
  emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/12',
  amber: 'text-amber-600 dark:text-amber-400 bg-amber-500/12',
  rose: 'text-rose-600 dark:text-rose-400 bg-rose-500/12',
  sky: 'text-sky-600 dark:text-sky-400 bg-sky-500/12',
  slate: 'text-slate-600 dark:text-slate-300 bg-slate-500/12',
}

export function accentClasses(accent: string): string {
  return ACCENTS[accent] ?? ACCENTS.slate
}
