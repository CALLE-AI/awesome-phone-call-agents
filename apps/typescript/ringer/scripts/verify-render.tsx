/**
 * Server-render smoke test: renders the app shell and the heaviest display
 * components with REAL demo-engine data to catch runtime/JSX errors without a
 * browser. Run: pnpm exec tsx --tsconfig tsconfig.app.json scripts/verify-render.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'
import App from '@/App'
import { Composer } from '@/components/compose/Composer'
import { OutcomeCard } from '@/components/call/OutcomeCard'
import { ShootoutResults } from '@/components/call/ShootoutResults'
import { TranscriptView } from '@/components/call/TranscriptView'
import { EventTimeline } from '@/components/call/EventTimeline'
import { CallView } from '@/components/call/CallView'
import { SharedResultView } from '@/components/call/SharedResultView'
import { ApprovalCard } from '@/components/call/ApprovalCard'
import { AddToCalendar, RateWatchCard, RetryPlanner } from '@/components/call/FollowUpCards'
import { BusinessSearch } from '@/components/compose/BusinessSearch'
import { BillDropzone } from '@/components/compose/BillDropzone'
import { ImpactSummary } from '@/components/shell/ImpactSummary'
import { IntroBanner } from '@/components/shell/IntroBanner'
import { Landing } from '@/components/landing/Landing'
import { TemplatePicker } from '@/components/compose/TemplatePicker'
import { HistoryDrawer } from '@/components/shell/HistoryDrawer'
import { SettingsModal } from '@/components/shell/SettingsModal'
import type { HistoryEntry } from '@/lib/app'
import { getTemplate } from '@/lib/tasks/templates'
import { buildCall } from '@/lib/tasks/buildCall'
import { demoCreate, demoGet, demoEvents } from '@/lib/calle/demoEngine'
import { estimateCost } from '@/lib/pricing'
import { guidanceForError } from '@/lib/calleErrors'
import { outcomeToText } from '@/lib/outcomeText'
import type { CallTask, DeveloperEvent } from '@/lib/calle/types'

let n = 0
const render = (name: string, el: any) => {
  const html = renderToStaticMarkup(el)
  if (!html || html.length < 20) throw new Error(`${name}: rendered empty`)
  n++
  console.log(`  ✓ ${name} (${html.length} chars)`)
}

// Prepare a completed single call + a completed batch call.
const realNow = Date.now
let clock = 1_700_000_000_000
;(Date as any).now = () => clock

const bill = getTemplate('negotiate-bill')
const p1 = buildCall({
  template: bill,
  values: { company: 'Xfinity', currentAmount: '95', goal: 'lower', walkAway: 'yes', approvalMode: 'auto' },
  identity: { callerName: 'Alex' },
  recipients: [{ businessName: 'Xfinity', phone: '+14155550134', region: 'US', locale: 'en-US' }],
  batch: false,
})
const single = demoCreate(p1.body, 'negotiate-bill', p1.demoPlan)
clock += 30000
const singleCall = demoGet(single.id)!
const singleEvents = demoEvents(single.id).data

const quote = getTemplate('get-quote')
const p2 = buildCall({
  template: quote,
  values: { service: 'brake job' },
  identity: { callerName: 'Alex' },
  recipients: [
    { businessName: "Mike's Auto", phone: '+14155550111', region: 'US', locale: 'en-US' },
    { businessName: 'City Garage', phone: '+14155550122', region: 'US', locale: 'en-US' },
  ],
  batch: true,
})
const batch = demoCreate(p2.body, 'get-quote', p2.demoPlan)
clock += 60000
const batchCall = demoGet(batch.id)!
;(Date as any).now = realNow

console.log('\n[render] components')
render('App (home view)', h(App))
render('Landing', h(Landing, { onStart: () => {}, onPickTemplate: () => {} }))
render('Composer (negotiate-bill, live cost + setup hint)', h(Composer, {
  templateId: 'negotiate-bill',
  defaultCaller: 'Alex',
  defaultCallback: '',
  mode: 'live',
  onBack: () => {},
  onLaunch: () => {},
  onOpenSettings: () => {},
}))
render('Composer (get-quote / batchable, demo)', h(Composer, {
  templateId: 'get-quote',
  defaultCaller: '',
  defaultCallback: '',
  mode: 'demo',
  onBack: () => {},
  onLaunch: () => {},
}))
render('OutcomeCard (completed single)', h(OutcomeCard, { template: bill, call: singleCall }))
render('TranscriptView', h(TranscriptView, {
  turns: singleCall.recipients[0].attempts[0].transcript_turns,
  connecting: false,
  live: false,
}))
render('EventTimeline', h(EventTimeline, { events: singleEvents }))
// Robustness: unknown event type (fallback) + an error-level event.
const mixedEvents: DeveloperEvent[] = [
  { id: 'e1', type: 'call.dialing', call_id: 'c', created_at: '2026-08-04T09:30:00Z', level: 'info', status: 'in_progress', message: 'Dialing…', details: {} },
  { id: 'e0', type: 'call.localized', call_id: 'c', created_at: '2026-08-04T09:30:01Z', level: 'info', status: 'in_progress', message: 'Conducting the call in Spanish.', details: {} },
  { id: 'e2', type: 'call.some_new_provider_event', call_id: 'c', created_at: '2026-08-04T09:30:05Z', level: 'debug', status: 'in_progress', message: 'A type we have never seen before.', details: {} },
  { id: 'e3', type: 'call.error', call_id: 'c', created_at: '2026-08-04T09:30:09Z', level: 'error', status: 'failed', message: 'Carrier rejected the call.', details: {} },
]
render('EventTimeline (localized + unknown + error)', h(EventTimeline, { events: mixedEvents }))
render('ShootoutResults (completed batch)', h(ShootoutResults, { template: quote, call: batchCall }))

const doneRunner: any = { state: 'done', call: singleCall, events: singleEvents, error: null, errorCode: null }
render('CallView (done single, Share + Developer peek)', h(CallView, {
  runner: doneRunner,
  template: bill,
  meta: { templateId: 'negotiate-bill', templateLabel: 'Negotiate a bill', batch: false, title: 'Negotiate a bill · Xfinity' },
  payload: p1,
  mode: 'demo',
  onNewCall: () => {},
  onRetry: () => {},
}))
// Error state with an onboarding-related code exercises the guidance block.
const errorRunner: any = {
  state: 'error', call: null, events: [], error: 'Your account is not permitted to place outbound calls yet.', errorCode: 'forbidden',
}
render('CallView (error state + guidance)', h(CallView, {
  runner: errorRunner,
  template: bill,
  meta: { templateId: 'negotiate-bill', templateLabel: 'Negotiate a bill', batch: false, title: 'Negotiate a bill · Xfinity' },
  payload: p1,
  mode: 'live',
  onNewCall: () => {},
  onRetry: () => {},
}))
// Localization: a Spanish call exercises the language directive + header chip.
const p3 = buildCall({
  template: bill,
  values: { company: 'Telmex', currentAmount: '600', goal: 'lower', approvalMode: 'ask' },
  identity: { callerName: 'Alex' },
  recipients: [{ businessName: 'Telmex', phone: '+525555550134', region: 'MX', locale: 'es-MX' }],
  batch: false,
})
render('CallView (Spanish / localized chip)', h(CallView, {
  runner: doneRunner,
  template: bill,
  meta: { templateId: 'negotiate-bill', templateLabel: 'Negotiate a bill', batch: false, title: 'Negotiate a bill · Telmex' },
  payload: p3,
  mode: 'live',
  onNewCall: () => {},
  onRetry: () => {},
}))
render('SettingsModal (live, onboarding checklist)', h(SettingsModal, {
  open: true,
  onClose: () => {},
  settings: { mode: 'live', apiKey: '', baseUrl: '', callerName: '', callbackNumber: '' },
  onSave: () => {},
}))
render('SharedResultView (single)', h(SharedResultView, {
  snapshot: { v: 1, templateId: 'negotiate-bill', title: 'Negotiate a bill · Xfinity', batch: false, call: singleCall },
  onStartOwn: () => {},
}))
render('SharedResultView (batch)', h(SharedResultView, {
  snapshot: { v: 1, templateId: 'get-quote', title: 'Get a quote · 2 businesses', batch: true, call: batchCall },
  onStartOwn: () => {},
}))
const hist: HistoryEntry[] = [
  { id: '1', at: '', mode: 'demo', templateId: 'negotiate-bill', templateLabel: '', batch: false, title: '', status: 'completed', outcomeLabel: '', outcomeTone: 'success', headline: null, summary: null, savedUsd: 420, kind: 'saved' },
  { id: '2', at: '', mode: 'demo', templateId: 'book-appointment', templateLabel: '', batch: false, title: '', status: 'completed', outcomeLabel: '', outcomeTone: 'success', headline: null, summary: null, savedUsd: 0, kind: 'booked' },
]
render('ImpactSummary', h(ImpactSummary, { history: hist }))
render('IntroBanner', h(IntroBanner, { onDismiss: () => {}, onOpenSettings: () => {} }))
render('TemplatePicker (spotlight cards)', h(TemplatePicker, { onPick: () => {} }))
render('ApprovalCard', h(ApprovalCard, {
  request: { prompt: 'They offered $70/mo for 12 months. Accept or push?', offer: '$70/mo for 12 months' },
  onDecide: () => {},
}))
render('RetryPlanner', h(RetryPlanner, { reason: 'Voicemail — retry recommended.', onEscalateNow: () => {}, onSchedule: () => {} }))
render('RateWatchCard', h(RateWatchCard, { company: 'Xfinity', newAmount: 60, promoLength: '12 months', watching: false, onWatch: () => {} }))
render('AddToCalendar', h(AddToCalendar, { result: { appointment_iso: '2026-08-04T09:30:00Z', location: 'Bright Smile' }, title: 'Dentist cleaning' }))
render('BusinessSearch', h(BusinessSearch, { onSelect: () => {} }))
render('BillDropzone', h(BillDropzone, { onParsed: () => {} }))
render('HistoryDrawer (scheduled + watches)', h(HistoryDrawer, {
  open: true,
  onClose: () => {},
  entries: hist,
  onClear: () => {},
  scheduled: [{ id: 's1', createdAt: '', dueAt: new Date(Date.now() + 3_600_000).toISOString(), title: 'Negotiate a bill · Xfinity · follow-up', escalated: true, payload: p1, meta: { templateId: 'negotiate-bill', templateLabel: 'Negotiate a bill', batch: false, title: 'Negotiate a bill · Xfinity' } }],
  watches: [{ id: 'w1', createdAt: '', endsAt: new Date(Date.now() + 86_400_000).toISOString(), company: 'Xfinity', newAmount: 60, previousAmount: 95, promoLength: '12 months' }],
}))

// Pure-helper checks (pricing + error guidance).
const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(`assert failed: ${msg}`); console.log(`  ✓ ${msg}`) }
console.log('\n[assert] pricing + error guidance')
assert(estimateCost(1).formattedTotal === '$0.05', 'estimateCost(1) = $0.05')
assert(estimateCost(3).breakdown === '3 calls × $0.05 = $0.15', 'estimateCost(3) breakdown = 3 × $0.05 = $0.15')
assert(estimateCost(0).total === 0, 'estimateCost(0) = 0')
assert(guidanceForError('forbidden')?.action?.href.includes('heycall-e.com') === true, 'forbidden → dashboard link')
assert(guidanceForError('insufficient_balance') !== null, 'insufficient_balance has guidance')
assert(guidanceForError('unknown_code_xyz') === null, 'unknown code → no guidance')
// A raw/partial live response may omit array fields (evidence, recipients,
// attempts) that the demo always populates. The outcome UI must not crash.
const partialCall = {
  id: 'call_partial',
  object: 'call_task',
  status: 'failed',
  task: 'Call and negotiate.',
  structured_result: { outcome: 'failed' },
  summary: 'The call failed before connecting.',
  task_completed: false,
  completion_confidence: null,
  metadata: {},
  failure_code: 'no_answer',
  failure_message: null,
  created_at: '2026-08-04T09:30:00Z',
  completed_at: null,
  // evidence, recipients intentionally omitted to mimic a raw payload.
} as unknown as CallTask
render('OutcomeCard (partial live: no evidence)', h(OutcomeCard, { template: bill, call: partialCall }))
render('ShootoutResults (partial live: no recipients)', h(ShootoutResults, { template: quote, call: partialCall }))
assert(typeof outcomeToText(bill, partialCall, 'Failed call') === 'string', 'outcomeToText tolerates missing arrays')

// Denominator honesty: a shootout where one business was never reached must
// render the denominator strip and a "Not counted" tag.
const rcpt = (phone: string, price: number | null) =>
  ({
    id: `r${phone.slice(-3)}`,
    phones: [phone],
    locale: 'en-US',
    region: 'US',
    status: 'completed',
    structured_result: price != null ? { outcome: 'success', price_low: price } : { outcome: 'callback_required' },
    summary: price != null ? `Quoted $${price}` : 'Voicemail — no answer',
    attempts: [],
  }) as any
const shootoutCall = {
  id: 'call_so',
  object: 'call_task',
  status: 'completed',
  task: 'quote',
  structured_result: {
    businesses_called: 3,
    reached: 2,
    quotes_received: 2,
    cheapest_business: 'A Auto',
    cheapest_price: 289,
    potential_savings: 60,
    note: '1 not reached (of 3 called) — not counted.',
  },
  summary: '2 of 3 quoted; cheapest is A Auto at $289. 1 not reached — not counted.',
  task_completed: true,
  completion_confidence: { score: 0.9, label: 'high' },
  evidence: ['A Auto: $289', 'B Auto: $349'],
  metadata: {},
  failure_code: null,
  failure_message: null,
  created_at: '2026-08-04T09:30:00Z',
  completed_at: '2026-08-04T09:35:00Z',
  recipients: [rcpt('+14155550111', 289), rcpt('+14155550122', 349), rcpt('+14155550199', null)],
} as unknown as CallTask
render('ShootoutResults (denominator + not counted)', h(ShootoutResults, { template: quote, call: shootoutCall }))
assert((outcomeToText(bill, partialCall, 'x')).includes('NEEDS REVIEW'), 'unverified outcome text is flagged NEEDS REVIEW')

console.log('\n[assert] localization directive')
assert(p3.body.task.includes('Spanish'), 'buildCall(es-MX) task instructs Spanish')
assert(!p1.body.task.includes('Conduct the entire call in'), 'English call gets no language directive')
const pMulti = buildCall({
  template: quote,
  values: { service: 'brake job' },
  identity: { callerName: 'Alex' },
  recipients: [
    { businessName: 'Autos MX', phone: '+525555550111', region: 'MX', locale: 'es-MX' },
    { businessName: 'Garage FR', phone: '+33155550111', region: 'FR', locale: 'fr-FR' },
  ],
  batch: true,
})
assert(pMulti.body.task.includes('Spanish') && pMulti.body.task.includes('French'), 'batch task names each recipient language')

console.log(`\n✅ All ${n} components rendered without errors.\n`)
