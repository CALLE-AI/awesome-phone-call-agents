import { useState } from 'react'
import {
  BadgeCheck,
  ExternalLink,
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Radio,
  Rocket,
  ShieldCheck,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/fields'
import { cn } from '@/lib/cn'
import type { AppSettings } from '@/lib/app'

const DASHBOARD = 'https://dashboard.heycall-e.com'

export function SettingsModal({
  open,
  onClose,
  settings,
  onSave,
  onForget,
}: {
  open: boolean
  onClose: () => void
  settings: AppSettings
  onSave: (next: AppSettings) => void
  /** Wipe the stored credentials (key + access secret) immediately. */
  onForget?: () => void
}) {
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [showKey, setShowKey] = useState(false)

  // Re-sync when reopened.
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setDraft(settings)
  }

  const set = (patch: Partial<AppSettings>) => setDraft((d) => ({ ...d, ...patch }))
  const save = () => {
    onSave(draft)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <div className="flex flex-col gap-6 p-5">
        {/* Mode */}
        <div>
          <p className="mb-2 text-sm font-bold text-ink">How should Ringer run?</p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <ModeCard
              active={draft.mode === 'demo'}
              onClick={() => set({ mode: 'demo' })}
              icon={<FlaskConical className="size-5" />}
              title="Demo"
              desc="Realistic simulated calls. No key, no credits — try everything instantly."
            />
            <ModeCard
              active={draft.mode === 'live'}
              onClick={() => set({ mode: 'live' })}
              icon={<Radio className="size-5" />}
              title="Live"
              desc="Places real phone calls via CALL-E using your API key."
            />
          </div>
        </div>

        {/* Live credentials */}
        {draft.mode === 'live' && (
          <>
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-2 p-4">
            <Field
              label="CALL-E API key"
              htmlFor="apikey"
              help="Kept only in this browser tab for the session — never in permanent storage or on our servers — and sent per-request. Closing the tab clears it."
            >
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <Input
                  id="apikey"
                  type={showKey ? 'text' : 'password'}
                  className="pl-9 pr-10 font-mono"
                  placeholder="calle_live_…"
                  value={draft.apiKey}
                  onChange={(e) => set({ apiKey: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-faint hover:text-ink"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            {settings.serverKey && !draft.apiKey && (
              <p className="text-xs text-success">
                <ShieldCheck className="mr-1 inline size-3.5 -translate-y-px" />
                This deployment shares a CALL-E key — enter its access secret below to run Live without your own key.
              </p>
            )}
            <Field
              label="Access secret (shared key)"
              htmlFor="appsecret"
              help="Only needed if this deployment shares a CALL-E key and you're not using your own. Kept only in this session and sent per-request; never stored server-side."
            >
              <div className="relative">
                <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <Input
                  id="appsecret"
                  type={showKey ? 'text' : 'password'}
                  className="pl-9 font-mono"
                  placeholder="deployment access secret"
                  value={draft.appSecret}
                  onChange={(e) => set({ appSecret: e.target.value })}
                />
              </div>
            </Field>
            <Field label="API base URL" htmlFor="baseurl" help="Leave blank for the default (api.heycall-e.com).">
              <Input
                id="baseurl"
                className="font-mono text-sm"
                placeholder="https://api.heycall-e.com"
                value={draft.baseUrl}
                onChange={(e) => set({ baseUrl: e.target.value })}
              />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <a
                href={`${DASHBOARD}/account/api-keys`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-primary hover:underline"
              >
                Get a CALL-E API key →
              </a>
              {onForget && (draft.apiKey || draft.appSecret || settings.apiKey || settings.appSecret) && (
                <button
                  type="button"
                  onClick={() => {
                    set({ apiKey: '', appSecret: '' })
                    onForget()
                  }}
                  className="cursor-pointer text-xs font-semibold text-danger hover:underline"
                >
                  Forget key on this device
                </button>
              )}
            </div>
          </div>

          {/* First-live-call onboarding: real outbound needs KYC + a number */}
          <div className="rounded-2xl border border-border bg-surface-2 p-4">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-bold text-ink">
              <Rocket className="size-4 text-primary" /> Before your first live call
            </p>
            <ol className="flex flex-col gap-3.5">
              <SetupStep
                n={1}
                icon={<BadgeCheck className="size-4" />}
                title="Verify your identity (KYC)"
                desc="CALL-E requires identity verification before it will place outbound calls."
                href={DASHBOARD}
                action="Verify in dashboard"
              />
              <SetupStep
                n={2}
                icon={<Radio className="size-4" />}
                title="Get a phone number"
                desc="Buy a CALL-E number (or connect a SIP trunk) so your calls have a caller ID. Some regions restrict outbound."
                href={DASHBOARD}
                action="Get a number"
              />
              <SetupStep
                n={3}
                icon={<KeyRound className="size-4" />}
                title="Add your API key"
                desc="Paste your key above — or the operator can configure one on the server."
                href={`${DASHBOARD}/account/api-keys`}
                action="API keys"
              />
            </ol>
            <p className="mt-3.5 border-t border-border pt-3 text-xs leading-relaxed text-muted">
              New accounts include free calls; after that, each completed call is about{' '}
              <span className="font-semibold text-ink">$0.05</span>. Demo Mode is always free.
            </p>
          </div>
          </>
        )}

        {/* Identity defaults */}
        <div className="flex flex-col gap-4">
          <p className="text-sm font-bold text-ink">Your details (prefilled into every call)</p>
          <Field label="Your name" htmlFor="s-caller">
            <Input id="s-caller" placeholder="e.g. Alex Rivera" value={draft.callerName} onChange={(e) => set({ callerName: e.target.value })} />
          </Field>
          <Field label="Callback number" htmlFor="s-callback" help="Given only if a business asks for one.">
            <Input id="s-callback" type="tel" placeholder="+1 415 555 0100" value={draft.callbackNumber} onChange={(e) => set({ callbackNumber: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface px-5 py-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save}>Save settings</Button>
      </div>
    </Modal>
  )
}

function SetupStep({
  n,
  icon,
  title,
  desc,
  href,
  action,
}: {
  n: number
  icon: React.ReactNode
  title: string
  desc: string
  href: string
  action: string
}) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-fg">
        {n}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <span className="text-primary">{icon}</span>
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{desc}</p>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          {action} <ExternalLink className="size-3" />
        </a>
      </div>
    </li>
  )
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-2xl border p-4 text-left transition-all',
        active ? 'border-primary bg-primary-soft/50 ring-2 ring-primary/30' : 'border-border bg-surface hover:border-primary/40',
      )}
    >
      <span className={cn('grid size-9 place-items-center rounded-xl', active ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted')}>
        {icon}
      </span>
      <p className="mt-2.5 font-bold text-ink">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">{desc}</p>
    </button>
  )
}
