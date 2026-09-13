import { PhoneOutgoing, Sparkles } from 'lucide-react'
import type { SharedSnapshot } from '@/lib/share'
import { getTemplate } from '@/lib/tasks/templates'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { OutcomeCard, RawResult } from './OutcomeCard'
import { ShootoutResults } from './ShootoutResults'
import { TranscriptView } from './TranscriptView'

export function SharedResultView({
  snapshot,
  onStartOwn,
}: {
  snapshot: SharedSnapshot
  onStartOwn: () => void
}) {
  const template = getTemplate(snapshot.templateId)
  const call = snapshot.call
  const currency = snapshot.currency ?? 'USD'
  const hasView = template.resultView.some((s) => call.structured_result?.[s.key] != null)
  const turns = call.recipients?.[0]?.attempts?.at(-1)?.transcript_turns ?? []

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Badge tone="brand" icon={<Sparkles className="size-3.5" />}>
            Shared via Ringer
          </Badge>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">{snapshot.title}</h1>
          <p className="text-sm text-muted">A call Ringer handled — here’s the result.</p>
        </div>
        <Button variant="accent" iconLeft={<PhoneOutgoing className="size-4" />} onClick={onStartOwn}>
          Handle your own call
        </Button>
      </div>

      <div className="flex flex-col gap-5">
        {snapshot.batch ? (
          <ShootoutResults template={template} call={call} currency={currency} />
        ) : hasView ? (
          <OutcomeCard template={template} call={call} currency={currency} />
        ) : (
          <div className="card p-5 sm:p-6">
            <RawResult result={call.structured_result ?? {}} />
            {call.summary && <p className="mt-3 text-sm text-muted">{call.summary}</p>}
          </div>
        )}

        {!snapshot.batch && turns.length > 0 && (
          <div className="card p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-bold text-ink">Transcript</h2>
            <TranscriptView turns={turns} connecting={false} live={false} />
          </div>
        )}
      </div>

      <p className="mt-8 text-center text-sm text-faint">
        Ringer places real phone calls for you via CALL-E. Try it free — no phone, no key.
      </p>
    </div>
  )
}
