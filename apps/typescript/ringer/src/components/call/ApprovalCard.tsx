import { useState } from 'react'
import { motion } from 'motion/react'
import { BadgeCheck, Flame, Hand } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { DemoDecision } from '@/lib/calle/demoEngine'

export interface ApprovalRequest {
  prompt: string
  offer: string
}

/**
 * Human-in-the-loop decision card: the agent is holding on the live call
 * waiting for the user to accept the offer or push for a better one.
 */
export function ApprovalCard({
  request,
  onDecide,
}: {
  request: ApprovalRequest
  onDecide: (choice: DemoDecision) => Promise<void> | void
}) {
  const [busy, setBusy] = useState<DemoDecision | null>(null)

  const decide = async (choice: DemoDecision) => {
    if (busy) return
    setBusy(choice)
    await onDecide(choice)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="card overflow-hidden border-amber-500/40 ring-2 ring-amber-500/25"
    >
      <div className="flex items-center gap-2.5 border-b border-border bg-amber-500/10 px-5 py-3.5">
        <span className="relative grid size-9 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300">
          <Hand className="size-5" />
          <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-amber-500 live-dot" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Your call — the agent is holding
          </p>
          <p className="text-sm font-semibold text-ink">Offer on the table: {request.offer}</p>
        </div>
      </div>

      <div className="p-5">
        <p className="text-[0.95rem] leading-relaxed text-ink">{request.prompt}</p>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <Button
            variant="primary"
            size="lg"
            loading={busy === 'accept'}
            disabled={busy !== null}
            iconLeft={<BadgeCheck className="size-5" />}
            onClick={() => decide('accept')}
          >
            Accept this offer
          </Button>
          <Button
            variant="accent"
            size="lg"
            loading={busy === 'push'}
            disabled={busy !== null}
            iconLeft={<Flame className="size-5" />}
            onClick={() => decide('push')}
          >
            Push for a better rate
          </Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Ringer stays on the line either way. Nothing is agreed until you decide.
        </p>
      </div>
    </motion.div>
  )
}
