import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTheme } from '@/hooks/useTheme'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useCallRunner } from '@/hooks/useCallRunner'
import { DEFAULT_SETTINGS, type AppSettings, type HistoryEntry, type ImpactKind } from '@/lib/app'
import { getTemplate } from '@/lib/tasks/templates'
import { buildCall, escalatePayload, type RecipientInput } from '@/lib/tasks/buildCall'
import {
  isDue,
  newRateWatch,
  newScheduledCall,
  parsePromoMonths,
  type RateWatch,
  type ScheduledCall,
} from '@/lib/followups'
import { cancelJob, createJob, listJobs, type ScheduledJob } from '@/lib/schedule'
import type { CreatePayload, CalleSettings } from '@/lib/calle/client'
import type { CallTask, JsonObject } from '@/lib/calle/types'
import type { OutcomeTone, TaskValues } from '@/lib/tasks/types'
import { TopBar } from '@/components/shell/TopBar'
import { SettingsModal } from '@/components/shell/SettingsModal'
import { HistoryDrawer } from '@/components/shell/HistoryDrawer'
import { IntroBanner } from '@/components/shell/IntroBanner'
import { Landing } from '@/components/landing/Landing'
import { TemplatePicker } from '@/components/compose/TemplatePicker'
import { Composer, type LaunchMeta } from '@/components/compose/Composer'
import { CallView } from '@/components/call/CallView'
import { SharedResultView } from '@/components/call/SharedResultView'
import { decodeShareFromLocation, clearShareHash, type SharedSnapshot } from '@/lib/share'
import { formatMoney, currencySymbol } from '@/lib/format'

type View = 'home' | 'compose' | 'call'

export default function App() {
  const { theme, toggle } = useTheme()
  const [settings, setSettings] = useLocalStorage<AppSettings>('ringer.settings', DEFAULT_SETTINGS)
  const [history, setHistory] = useLocalStorage<HistoryEntry[]>('ringer.history', [])

  const [view, setView] = useState<View>('home')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [launch, setLaunch] = useState<{ payload: CreatePayload; meta: LaunchMeta } | null>(null)
  const [prefill, setPrefill] = useState<TaskValues | null>(null)
  const [scheduled, setScheduled] = useLocalStorage<ScheduledCall[]>('ringer.scheduled', [])
  const [watches, setWatches] = useLocalStorage<RateWatch[]>('ringer.watches', [])
  const [jobs, setJobs] = useState<ScheduledJob[]>([])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [seenIntro, setSeenIntro] = useLocalStorage('ringer.seenIntro', false)
  const [shared, setShared] = useState<SharedSnapshot | null>(() => decodeShareFromLocation())

  const runner = useCallRunner()

  const refreshJobs = () => {
    listJobs(settings.appSecret)
      .then(setJobs)
      .catch(() => {})
  }

  // Detect server capabilities (BYOK-free Live key + durable scheduler).
  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.hasServerKey === 'boolean') {
          setSettings((s) => ({
            ...s,
            serverKey: d.hasServerKey,
            hasScheduler: Boolean(d.hasScheduler),
          }))
          if (d.hasScheduler) refreshJobs()
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Durable server scheduling is available and the user is in Live mode. */
  const schedulerReady = settings.mode === 'live' && Boolean(settings.hasScheduler)

  const calleSettings = (): CalleSettings => ({
    mode: settings.mode,
    apiKey: settings.apiKey || undefined,
    baseUrl: settings.baseUrl || undefined,
    appSecret: settings.appSecret || undefined,
  })

  const goHome = () => {
    runner.reset()
    recorded.current = null
    setLaunch(null)
    setTemplateId(null)
    if (shared) {
      clearShareHash()
      setShared(null)
    }
    setView('home')
  }

  const startCompose = (id: string | null = null, withPrefill: TaskValues | null = null) => {
    setPrefill(withPrefill)
    setTemplateId(id)
    setView('compose')
  }

  /* --------------- follow-ups: retries + rate watches --------------- */

  const escalateNow = () => {
    if (!launch) return
    const hardened = escalatePayload(launch.payload)
    const meta = { ...launch.meta, title: `${launch.meta.title} · follow-up` }
    recorded.current = null
    setLaunch({ payload: hardened, meta })
    void runner.start(hardened, calleSettings())
  }

  const scheduleRetry = (dueAt: Date) => {
    if (!launch) return
    const escalated = escalatePayload(launch.payload)
    const meta = { ...launch.meta, title: `${launch.meta.title} · follow-up` }
    if (schedulerReady) {
      void createJob(
        {
          dueAt,
          title: meta.title,
          templateId: meta.templateId,
          templateLabel: meta.templateLabel,
          batch: meta.batch,
          escalated: true,
          body: escalated.body,
        },
        settings.appSecret,
      )
        .then(refreshJobs)
        // Fall back to an in-browser reminder if the server rejects it.
        .catch(() => setScheduled((s) => [...s, newScheduledCall(escalated, meta, dueAt, true)]))
      return
    }
    setScheduled((s) => [...s, newScheduledCall(escalated, meta, dueAt, true)])
  }

  const cancelServerJob = (id: string) => {
    setJobs((js) => js.filter((j) => j.id !== id)) // optimistic
    void cancelJob(id, settings.appSecret).catch(refreshJobs)
  }

  const runScheduled = (entry: ScheduledCall) => {
    setScheduled((s) => s.filter((x) => x.id !== entry.id))
    setHistoryOpen(false)
    recorded.current = null
    setLaunch({ payload: entry.payload, meta: entry.meta })
    setView('call')
    void runner.start(entry.payload, calleSettings())
  }

  const watchRate = (result: JsonObject) => {
    if (!launch) return
    const plan = launch.payload.demoPlan[0]
    const company =
      plan?.businessName || String((plan?.values as JsonObject | undefined)?.company ?? 'Provider')
    const newAmount = typeof result.new_amount === 'number' ? result.new_amount : null
    const previousAmount = typeof result.previous_amount === 'number' ? result.previous_amount : null
    const promoLength = typeof result.promo_length === 'string' ? result.promo_length : null
    const currency = launch.payload.currency ?? 'USD'
    const sym = currencySymbol(currency)

    const recipient = launch.payload.body.recipients?.[0]
    const phone = recipient?.phones?.[0]

    // With a durable scheduler, a Rate Watch becomes a real recurring
    // renegotiation call queued a week before the promo ends (and every cycle
    // after). Otherwise it stays an in-browser reminder.
    if (schedulerReady && phone) {
      const months = parsePromoMonths(promoLength)
      const due = new Date()
      due.setMonth(due.getMonth() + months)
      due.setDate(due.getDate() - 7)

      const values: TaskValues = {
        company,
        currentAmount: newAmount != null ? String(newAmount) : '',
        goal: 'promo',
        approvalMode: 'ask',
        leverage: `My promotional rate${newAmount != null ? ` of ${sym}${newAmount}/mo` : ''} is ending. I was previously paying ${previousAmount != null ? `${sym}${previousAmount}/mo` : 'more'} and want the promo extended or beaten.`,
      }
      const recipients: RecipientInput[] = [
        {
          businessName: company,
          phone,
          region: recipient?.region ?? 'US',
          locale: recipient?.locale ?? 'en-US',
        },
      ]
      const payload = buildCall({
        template: getTemplate('negotiate-bill'),
        values,
        identity: { callerName: settings.callerName, callbackNumber: settings.callbackNumber },
        recipients,
        batch: false,
      })
      void createJob(
        {
          dueAt: due,
          title: `Renegotiate ${company}`,
          templateId: 'negotiate-bill',
          templateLabel: 'Negotiate a bill',
          batch: false,
          escalated: false,
          body: payload.body,
          recurrenceMonths: months,
        },
        settings.appSecret,
      )
        .then(refreshJobs)
        .catch(() => setWatches((w) => [...w, newRateWatch({ company, newAmount, previousAmount, promoLength, currency })]))
      return
    }

    setWatches((w) => [...w, newRateWatch({ company, newAmount, previousAmount, promoLength, currency })])
  }

  const queueWatch = (watch: RateWatch) => {
    setWatches((w) => w.filter((x) => x.id !== watch.id))
    setHistoryOpen(false)
    const sym = currencySymbol(watch.currency ?? 'USD')
    startCompose('negotiate-bill', {
      company: watch.company,
      currentAmount: watch.newAmount != null ? String(watch.newAmount) : '',
      goal: 'promo',
      approvalMode: 'ask',
      leverage: `My promotional rate${watch.newAmount != null ? ` of ${sym}${watch.newAmount}/mo` : ''} is ending. I was previously paying ${watch.previousAmount != null ? `${sym}${watch.previousAmount}/mo` : 'more'} and want the promo extended or beaten.`,
    })
  }

  const dueScheduled = scheduled.filter(isDue)
  const dueWatches = watches.filter((w) => new Date(w.endsAt).getTime() <= Date.now())
  const currentCompany = launch
    ? launch.payload.demoPlan[0]?.businessName ||
      String((launch.payload.demoPlan[0]?.values as JsonObject | undefined)?.company ?? '')
    : ''
  const isWatchingCurrent = Boolean(
    launch &&
      currentCompany &&
      (watches.some((w) => w.company === currentCompany) ||
        jobs.some((j) => j.status === 'pending' && j.title === `Renegotiate ${currentCompany}`)),
  )

  const handleLaunch = (payload: CreatePayload, meta: LaunchMeta) => {
    // Guard: Live needs a usable key. BYOK works on its own; the shared server
    // key additionally requires this deployment's access secret.
    if (settings.mode === 'live' && !settings.apiKey) {
      if (!settings.serverKey || !settings.appSecret) {
        setSettingsOpen(true)
        return
      }
    }
    recorded.current = null
    setLaunch({ payload, meta })
    setView('call')
    void runner.start(payload, calleSettings())
  }

  const retry = () => {
    if (launch) {
      recorded.current = null
      void runner.start(launch.payload, calleSettings())
    }
  }

  // Record finished calls to history (once per call id).
  const recorded = useRef<string | null>(null)
  useEffect(() => {
    if (runner.state === 'done' && runner.call && launch && recorded.current !== runner.call.id) {
      recorded.current = runner.call.id
      const entry = deriveHistory(runner.call, launch.meta, settings.mode)
      setHistory((h) => [entry, ...h].slice(0, 40))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner.state, runner.call])

  return (
    <div className="flex min-h-svh flex-col">
      <TopBar
        theme={theme}
        onToggleTheme={toggle}
        mode={settings.mode}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onHome={goHome}
        historyCount={history.length}
      />

      {!seenIntro && !shared && view === 'home' && (
        <IntroBanner onDismiss={() => setSeenIntro(true)} onOpenSettings={() => setSettingsOpen(true)} />
      )}

      {/* Due follow-ups / rate watches */}
      {!shared && view === 'home' && (dueScheduled.length > 0 || dueWatches.length > 0) && (
        <div className="border-b border-accent/25 bg-accent/8">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
            <p className="min-w-0 flex-1 text-sm text-ink">
              {dueScheduled.length > 0 ? (
                <>
                  <span className="font-semibold">A scheduled follow-up call is ready:</span>{' '}
                  <span className="text-muted">{dueScheduled[0].title}</span>
                </>
              ) : (
                <>
                  <span className="font-semibold">Rate Watch:</span>{' '}
                  <span className="text-muted">
                    your {dueWatches[0].company} promo is ending — time to renegotiate.
                  </span>
                </>
              )}
            </p>
            <button
              onClick={() =>
                dueScheduled.length > 0 ? runScheduled(dueScheduled[0]) : queueWatch(dueWatches[0])
              }
              className="cursor-pointer rounded-lg bg-accent px-3.5 py-1.5 text-xs font-bold text-accent-fg hover:bg-accent-strong"
            >
              {dueScheduled.length > 0 ? 'Run it now' : 'Renegotiate'}
            </button>
          </div>
        </div>
      )}

      <main className="flex-1">
        {shared ? (
          <SharedResultView snapshot={shared} onStartOwn={goHome} />
        ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={view === 'compose' ? `compose-${templateId ?? 'pick'}` : view}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {view === 'home' && (
              <Landing onStart={() => startCompose(null)} onPickTemplate={(id) => startCompose(id)} />
            )}

            {view === 'compose' && (
              <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
                {templateId ? (
                  <Composer
                    key={`${templateId}-${prefill ? 'prefilled' : 'blank'}`}
                    templateId={templateId}
                    defaultCaller={settings.callerName}
                    defaultCallback={settings.callbackNumber}
                    initialValues={prefill ?? undefined}
                    mode={settings.mode}
                    onBack={() => setTemplateId(null)}
                    onLaunch={handleLaunch}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                ) : (
                  <TemplatePicker onPick={(id) => setTemplateId(id)} />
                )}
              </div>
            )}

            {view === 'call' && launch && (
              <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
                <CallView
                  runner={runner}
                  template={getTemplate(launch.meta.templateId)}
                  meta={launch.meta}
                  payload={launch.payload}
                  mode={settings.mode}
                  onNewCall={() => {
                    runner.reset()
                    recorded.current = null
                    setLaunch(null)
                    startCompose(null)
                  }}
                  onRetry={retry}
                  onEscalateNow={escalateNow}
                  onScheduleRetry={scheduleRetry}
                  watching={isWatchingCurrent}
                  onWatchRate={watchRate}
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        )}
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onSave={setSettings} />
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        entries={history}
        onClear={() => setHistory([])}
        jobs={jobs}
        onCancelJob={cancelServerJob}
        scheduled={scheduled}
        onRunScheduled={runScheduled}
        onCancelScheduled={(id) => setScheduled((s) => s.filter((x) => x.id !== id))}
        watches={watches}
        onQueueWatch={queueWatch}
        onRemoveWatch={(id) => setWatches((w) => w.filter((x) => x.id !== id))}
      />
    </div>
  )
}

function deriveHistory(call: CallTask, meta: LaunchMeta, mode: AppSettings['mode']): HistoryEntry {
  const template = getTemplate(meta.templateId)
  const result = (call.structured_result ?? {}) as JsonObject
  const currency = meta.currency ?? 'USD'

  let outcomeLabel = 'Done'
  let outcomeTone: OutcomeTone = 'success'
  let headline: string | null = null
  let savedUsd = 0
  let kind: ImpactKind = 'other'

  const money = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  if (meta.batch) {
    outcomeLabel = result.cheapest_business ? 'Compared' : 'Done'
    outcomeTone = 'success'
    if (result.cheapest_price != null) headline = `Best: ${formatMoney(result.cheapest_price, currency)}`
    else if (result.cheapest_business) headline = String(result.cheapest_business)
    savedUsd = money(result.potential_savings)
    kind = 'saved'
  } else {
    const val = String(result[template.outcomeKey] ?? '')
    const mapped = template.outcomeMap[val]
    if (mapped) {
      outcomeLabel = mapped.label
      outcomeTone = mapped.tone
    }
    headline = template.headline?.(result, currency) ?? null
    if (meta.templateId === 'negotiate-bill') {
      savedUsd = money(result.monthly_savings) * 12 // annualized
      kind = 'saved'
    } else if (meta.templateId === 'chase-refund') {
      savedUsd = money(result.amount_recovered)
      kind = 'recovered'
    } else if (meta.templateId === 'book-appointment') {
      kind = 'booked'
    } else if (meta.templateId === 'cancel-subscription') {
      kind = 'cancelled'
    } else if (meta.templateId === 'general-inquiry') {
      kind = 'answered'
    }
  }

  return {
    id: call.id,
    at: new Date().toISOString(),
    mode,
    templateId: meta.templateId,
    templateLabel: meta.templateLabel,
    batch: meta.batch,
    title: meta.title,
    status: call.status,
    outcomeLabel,
    outcomeTone,
    headline,
    summary: call.summary,
    savedUsd,
    currency,
    kind,
  }
}
