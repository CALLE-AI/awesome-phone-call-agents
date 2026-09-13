import { ArrowRight, Layers } from 'lucide-react'
import { TEMPLATES } from '@/lib/tasks/templates'
import { TemplateIcon, accentClasses } from '@/components/ui/icon'
import { Badge } from '@/components/ui/Badge'
import { SpotlightCard } from '@/components/bits/SpotlightCard'
import { AnimatedContent } from '@/components/bits/AnimatedContent'

export function TemplatePicker({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
          What call do you want off your plate?
        </h1>
        <p className="mt-1.5 text-muted">
          Pick a playbook. Ringer writes the script, dials, and reports back a clear result.
        </p>
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t, i) => (
          <AnimatedContent key={t.id} delay={(i % 3) * 0.05} distance={40}>
            <SpotlightCard
              as="button"
              onClick={() => onPick(t.id)}
              className="card lift group h-full w-full cursor-pointer p-5 text-left hover:border-primary/40 hover:shadow-[0_12px_30px_-16px_hsl(var(--shadow-color)/0.4)] focus-visible:border-primary"
            >
              <div className="flex items-start justify-between">
                <span className={`grid size-11 place-items-center rounded-xl ${accentClasses(t.accent)}`}>
                  <TemplateIcon name={t.icon} className="size-5.5" />
                </span>
                {t.batchable && (
                  <Badge tone="brand" icon={<Layers className="size-3" />}>
                    Shootout
                  </Badge>
                )}
              </div>
              <h3 className="mt-3.5 text-[1.05rem] font-bold text-ink">{t.label}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{t.tagline}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Set it up <ArrowRight className="size-4" />
              </span>
            </SpotlightCard>
          </AnimatedContent>
        ))}
      </div>
    </div>
  )
}
