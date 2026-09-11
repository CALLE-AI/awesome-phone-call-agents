import { Clock, FlaskConical, Moon, Radio, Settings, Sun } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { Badge } from '@/components/ui/Badge'
import type { Theme } from '@/hooks/useTheme'
import type { RunMode } from '@/lib/calle/client'

export function TopBar({
  theme,
  onToggleTheme,
  mode,
  onOpenSettings,
  onOpenHistory,
  onHome,
  historyCount,
}: {
  theme: Theme
  onToggleTheme: () => void
  mode: RunMode
  onOpenSettings: () => void
  onOpenHistory: () => void
  onHome: () => void
  historyCount: number
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <button onClick={onHome} className="cursor-pointer" aria-label="Ringer home">
          <Logo />
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={onOpenSettings}
            className="hidden cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold transition-colors hover:border-primary/40 sm:inline-flex"
          >
            <Badge tone={mode === 'demo' ? 'info' : 'success'} icon={mode === 'demo' ? <FlaskConical className="size-3" /> : <Radio className="size-3" />}>
              {mode === 'demo' ? 'Demo mode' : 'Live'}
            </Badge>
          </button>

          <IconButton label="Call history" onClick={onOpenHistory}>
            <Clock className="size-5" />
            {historyCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.6rem] font-bold text-accent-fg">
                {historyCount > 9 ? '9+' : historyCount}
              </span>
            )}
          </IconButton>

          <IconButton label="Toggle theme" onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </IconButton>

          <IconButton label="Settings" onClick={onOpenSettings}>
            <Settings className="size-5" />
          </IconButton>
        </div>
      </div>
    </header>
  )
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="relative grid size-10 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  )
}
