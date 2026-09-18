import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BellOff, Phone, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { fmtMask, firstName } from '../../lib/utils'
import type { CanCall } from './caseApi'

/**
 * The button that rings a real telephone.
 *
 * Three properties, in the order they matter:
 *
 * **It is fast.** One click opens the confirm, one more dials, and the confirm's own button holds
 * focus so the keyboard path is press-enter. Nothing is typed. This screen is used while somebody
 * is deciding whether to drive to a house.
 *
 * **It confirms anyway.** A phone rings in a frail person's home at nine at night, and on the live
 * provider that call is spent from a small budget. So the confirm exists — but it earns its beat by
 * saying what a coordinator cannot otherwise see: which number, which provider, how many calls are
 * left, and that the call is paced for an emergency rather than a survey.
 *
 * **It cannot be pressed for somebody who opted out.** Consent is checked server-side too
 * (`_callable_now`), and this is the same fact shown before the click rather than discovered as a
 * refusal thirty seconds later. Gerald asked for a knock on the door; the screen says so and there
 * is no button to press.
 */

export interface CallLauncherProps {
  name: string
  phoneMasked: string
  canCall: CanCall
  /** They are on the phone right now — the button becomes a state, not an action. */
  live: boolean
  launching: boolean
  /** True once a call has already been placed to this person tonight. Changes the wording only. */
  calledBefore: boolean
  /** The backend's sentence when a dial was refused, rendered verbatim. */
  error: string | null
  onLaunch: () => void
  onDismissError: () => void
  /** Consent, straight off the roster row. `false` means never dial, in any circumstance. */
  consent: boolean
  /** The roster's own note about this person — usually why they opted out. */
  notes: string
}

export function CallLauncher({
  name,
  phoneMasked,
  canCall,
  live,
  launching,
  calledBefore,
  error,
  onLaunch,
  onDismissError,
  consent,
  notes,
}: CallLauncherProps) {
  const [confirming, setConfirming] = useState(false)
  const dialRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (confirming) dialRef.current?.focus()
  }, [confirming])

  // Escape backs out of the confirm. A dialogue you cannot leave with the key everybody presses is
  // a dialogue people click through.
  useEffect(() => {
    if (!confirming) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming])

  useEffect(() => {
    if (live || launching) setConfirming(false)
  }, [live, launching])

  if (!consent) {
    return (
      <div className="flex items-start gap-2.5 rounded border border-border bg-strip px-3 py-2.5">
        <BellOff size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-13 font-medium text-text">Opted out of check-in calls</p>
          <p className="mt-0.5 text-12 leading-snug text-muted">
            BuddyE will never dial this number. {notes || 'No consent is on file for automated calls.'}
          </p>
        </div>
      </div>
    )
  }

  if (live) {
    return (
      <Badge tone="accent" dot pulse size="md">
        On the phone with {firstName(name)}
      </Badge>
    )
  }

  const blocked = !canCall.allowed
  // The mock provider makes no telephone ring at all. Saying so is not a disclaimer — it is the
  // difference between a rehearsal and spending one of a handful of real calls.
  const isLive = canCall.provider !== 'mock'

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="lg"
          icon={<Phone size={14} />}
          loading={launching}
          disabled={blocked}
          title={blocked ? canCall.reason : undefined}
          onClick={() => {
            setConfirming((v) => !v)
          }}
        >
          {launching ? 'Dialling…' : calledBefore ? `Call ${firstName(name)} again` : `Call ${firstName(name)} now`}
        </Button>
      </div>

      <p className="mt-1.5 text-right text-12 text-muted">
        Rings <span className="font-mono tabular-nums text-text">{fmtMask(phoneMasked)}</span>
      </p>

      {blocked ? <p className="mt-1 text-right text-12 leading-snug text-rejected">{canCall.reason}</p> : null}

      {error ? (
        <div className="mt-2 flex items-start gap-2 rounded border border-rejected/30 bg-rejected-tint px-2.5 py-2">
          <p className="min-w-0 flex-1 text-12 leading-snug text-rejected">{error}</p>
          <button type="button" onClick={onDismissError} className="shrink-0 text-rejected" aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ) : null}

      {confirming && !blocked ? (
        <div
          role="dialog"
          aria-label={`Call ${name}`}
          className="absolute right-0 top-full z-30 mt-2 w-[340px] animate-slideIn rounded border border-edge bg-surface p-3.5 shadow-panel"
        >
          <p className="text-14 font-semibold leading-tight text-text">Ring {name} now?</p>
          <p className="mt-1 text-12 leading-relaxed text-muted">
            An emergency-paced check-in: it says who it is and why in one breath, asks only what decides whether they are
            safe, and is over in under two minutes.
          </p>

          <dl className="mt-3 space-y-1.5 border-t border-divider pt-2.5">
            <Row label="Number" value={<span className="font-mono tabular-nums">{fmtMask(phoneMasked)}</span>} />
            <Row
              label="Provider"
              value={
                isLive ? (
                  <span className="text-rejected">{canCall.provider} — a real phone will ring</span>
                ) : (
                  <span>{canCall.provider} — no telephone is dialled</span>
                )
              }
            />
            {canCall.budget_remaining != null ? (
              <Row
                label="Calls left"
                value={<span className="font-mono tabular-nums">{canCall.budget_remaining}</span>}
              />
            ) : null}
          </dl>

          <div className="mt-3 flex items-center gap-2">
            <Button
              ref={dialRef}
              variant={isLive ? 'danger' : 'primary'}
              size="md"
              icon={<Phone size={14} />}
              onClick={() => {
                setConfirming(false)
                onLaunch()
              }}
            >
              Dial now
            </Button>
            <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-12 text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-12 text-text">{value}</dd>
    </div>
  )
}
