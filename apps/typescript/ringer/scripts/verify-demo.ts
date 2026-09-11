/**
 * Runtime verification of the pure call logic, driven with a mocked clock so
 * the full queued -> in_progress -> completed lifecycle runs instantly.
 * Run: pnpm exec tsx --tsconfig tsconfig.app.json scripts/verify-demo.ts
 */
import assert from 'node:assert'
import { getTemplate } from '@/lib/tasks/templates'
import { buildCall, escalatePayload } from '@/lib/tasks/buildCall'
import { demoCreate, demoDecide, demoGet, demoEvents } from '@/lib/calle/demoEngine'
import { normalizePhone } from '@/lib/phone'
import { outcomeToText } from '@/lib/outcomeText'
import { computeImpact, type HistoryEntry } from '@/lib/app'
import { searchDirectory } from '@/lib/directory'
import { parseBillText, SAMPLE_BILL_TEXT } from '@/lib/billParse'
import { buildIcs } from '@/lib/ics'
import { parsePromoMonths } from '@/lib/followups'
import { denominatorLine, isOutcomeVerified } from '@/lib/honesty'

let pass = 0
const ok = (name: string, cond: boolean) => {
  assert(cond, `FAILED: ${name}`)
  pass++
  console.log(`  ✓ ${name}`)
}

// Controllable clock.
let clock = 1_700_000_000_000
const realNow = Date.now
;(Date as any).now = () => clock

console.log('\n[1] Phone normalization (E.164)')
ok('US 10-digit -> +1', normalizePhone('4155550100', 'US').normalized === '+14155550100')
ok('US formatted -> +1', normalizePhone('(415) 555-0100', 'US').normalized === '+14155550100')
ok('GB trunk 0 dropped', normalizePhone('020 7946 0000', 'GB').normalized === '+442079460000')
ok('already E.164 kept', normalizePhone('+6598765432', 'SG').ok)
ok('garbage rejected', !normalizePhone('12', 'US').ok)
// Reject-don't-guess: inferred country code is flagged, not applied silently.
ok('explicit + is not flagged assumed', normalizePhone('+14155550100', 'US').assumedCountry === false)
ok('national number is flagged assumed', normalizePhone('4155550100', 'US').assumedCountry === true)
ok('assumed region is surfaced', normalizePhone('4155550100', 'US').assumedRegion === 'United States')
ok('US odd length rejected (not force-prefixed)', !normalizePhone('4155', 'US').ok)
ok('invalid + number rejected, not repaired', !normalizePhone('+1', 'US').ok)

console.log('\n[2] buildCall — single (negotiate-bill)')
const bill = getTemplate('negotiate-bill')
const singlePayload = buildCall({
  template: bill,
  values: { company: 'Xfinity', currentAmount: '95', goal: 'lower', walkAway: 'yes', approvalMode: 'auto', autoAcceptBelow: '75' },
  identity: { callerName: 'Alex Rivera', callbackNumber: '+14155550100' },
  recipients: [{ businessName: 'Xfinity', phone: '+14155550134', region: 'US', locale: 'en-US' }],
  batch: false,
})
ok('task mentions company', singlePayload.body.task.includes('Xfinity'))
ok('task mentions caller', singlePayload.body.task.includes('Alex Rivera'))
ok('has result_schema', !!singlePayload.body.result_schema)
ok('no recipient_result_schema (single)', !singlePayload.body.recipient_result_schema)
ok('recipient phone set', singlePayload.body.recipients?.[0].phones[0] === '+14155550134')
ok('metadata app=ringer', (singlePayload.body.metadata as any).app === 'ringer')

console.log('\n[3] Demo lifecycle — single call')
clock = 1_700_000_000_000
const { id } = demoCreate(singlePayload.body, 'negotiate-bill', singlePayload.demoPlan)
let c = demoGet(id)!
ok('t=0 queued', c.status === 'queued')
ok('t=0 no result', c.structured_result === null)

clock += 4000 // connected, talking
c = demoGet(id)!
ok('t=4s in_progress', c.status === 'in_progress')
const midTurns = c.recipients[0].attempts[0].transcript_turns
ok('t=4s transcript streaming', midTurns.length > 0)
ok('t=4s not yet complete', c.task_completed === null)

clock += 20000 // past totalMs
c = demoGet(id)!
ok('t=24s completed', c.status === 'completed')
ok('t=24s task_completed true', c.task_completed === true)
ok('t=24s has structured_result', !!c.structured_result)
ok('outcome=success', (c.structured_result as any).outcome === 'success')
ok('new_amount < previous', Number((c.structured_result as any).new_amount) < Number((c.structured_result as any).previous_amount))
ok('confidence present', (c.completion_confidence?.score ?? 0) > 0.5)
ok('evidence present', c.evidence.length > 0)
ok('completed_at set', !!c.completed_at)
const evs = demoEvents(id)
ok('events include call.completed', evs.data.some((e) => e.type === 'call.completed'))
ok('events ordered', evs.data.every((e, i) => i === 0 || new Date(evs.data[i - 1].created_at) <= new Date(e.created_at)))

console.log('\n[4] buildCall + demo — Quote Shootout (batch)')
const quote = getTemplate('get-quote')
const batchPayload = buildCall({
  template: quote,
  values: { service: 'front brake pads + rotors, 2018 Civic', timeframe: 'this week' },
  identity: { callerName: 'Alex' },
  recipients: [
    { businessName: "Mike's Auto", phone: '+14155550111', region: 'US', locale: 'en-US' },
    { businessName: 'City Garage', phone: '+14155550122', region: 'US', locale: 'en-US' },
    { businessName: 'AutoWorks', phone: '+14155550133', region: 'US', locale: 'en-US' },
  ],
  batch: true,
})
ok('batch has recipient_result_schema', !!batchPayload.body.recipient_result_schema)
ok('batch has aggregate result_schema', !!batchPayload.body.result_schema)
ok('batch task is generic (no specific biz)', !batchPayload.body.task.includes("Mike's Auto"))
ok('3 recipients in body', batchPayload.body.recipients?.length === 3)

clock = 1_700_000_100_000
const batch = demoCreate(batchPayload.body, 'get-quote', batchPayload.demoPlan)
clock += 60000 // finish all
const bc = demoGet(batch.id)!
ok('batch completed', bc.status === 'completed')
ok('all recipients completed', bc.recipients.every((r) => r.status === 'completed'))
ok('every recipient has a quote', bc.recipients.every((r) => (r.structured_result as any)?.price_low != null))
const agg = bc.structured_result as any
ok('aggregate has cheapest_business', typeof agg.cheapest_business === 'string')
ok('aggregate businesses_called=3', agg.businesses_called === 3)
ok('potential_savings >= 0', Number(agg.potential_savings) >= 0)
// Cheapest should be the min price among recipients.
const prices = bc.recipients.map((r) => Number((r.structured_result as any).price_low))
ok('cheapest_price is the min', Number(agg.cheapest_price) === Math.min(...prices))

console.log('\n[4b] Human-in-the-loop approval (negotiate-bill, ask mode)')
clock = 1_700_000_200_000
const hitlPayload = buildCall({
  template: bill,
  values: { company: 'Xfinity', currentAmount: '95', goal: 'lower', approvalMode: 'ask' },
  identity: { callerName: 'Alex' },
  recipients: [{ businessName: 'Xfinity', phone: '+14155550134', region: 'US', locale: 'en-US' }],
  batch: false,
})
ok('live task forbids committing', hitlPayload.body.task.includes('may NOT accept'))
const hitl = demoCreate(hitlPayload.body, 'negotiate-bill', hitlPayload.demoPlan)
clock += 60000 // way past the checkpoint — must be holding, not done
let hc = demoGet(hitl.id)!
ok('holds at checkpoint (in_progress)', hc.status === 'in_progress')
const approval = (hc.metadata as any).approval_request
ok('approval_request surfaced', !!approval && typeof approval.prompt === 'string')
ok('offer text present', /\$\d+\/mo/.test(approval.offer))
ok('approval event emitted', demoEvents(hitl.id).data.some((e) => e.type === 'call.approval_required'))
ok('decide accepted', demoDecide(hitl.id, 'push'))
clock += 15000
hc = demoGet(hitl.id)!
ok('completes after decision', hc.status === 'completed')
const hres = hc.structured_result as any
ok('push beat the first offer', Number(hres.new_amount) < Math.round(95 * 0.74))
ok('decision event emitted', demoEvents(hitl.id).data.some((e) => e.type === 'call.approval_received'))
ok('cannot decide twice', !demoDecide(hitl.id, 'accept'))

console.log('\n[4c] Voicemail + escalation retry')
clock = 1_700_000_300_000
const vmPayload = buildCall({
  template: bill,
  values: { company: 'Xfinity', currentAmount: '95', approvalMode: 'auto' },
  identity: { callerName: 'Alex' },
  recipients: [{ businessName: 'Xfinity', phone: '+14155550199', region: 'US', locale: 'en-US' }],
  batch: false,
})
const vm = demoCreate(vmPayload.body, 'negotiate-bill', vmPayload.demoPlan)
clock += 20000
const vc = demoGet(vm.id)!
ok('voicemail call completes', vc.status === 'completed')
ok('voicemail outcome callback_required', (vc.structured_result as any).outcome === 'callback_required')
const esc = escalatePayload(vmPayload)
ok('escalated task hardened', esc.body.task.includes('FOLLOW-UP ATTEMPT'))
ok('escalated metadata flag', (esc.body.metadata as any).escalated === true)
ok('escalated demo flag', esc.demoPlan[0].values.__escalated === 'yes')
clock = 1_700_000_400_000
const esc2 = demoCreate(esc.body, 'negotiate-bill', esc.demoPlan)
clock += 30000
const ec = demoGet(esc2.id)!
ok('escalated retry succeeds', (ec.structured_result as any).outcome === 'success')

console.log('\n[4d] Directory, bill parsing, ics, promo parsing')
const comcast = searchDirectory('comcast')
ok('directory finds Comcast', comcast.length > 0 && comcast[0].name.includes('Comcast'))
ok('directory finds dentists', searchDirectory('dentist').filter((e) => e.kind === 'local-demo').length >= 2)
ok('directory empty on short query', searchDirectory('c').length === 0)
const parsed = parseBillText(SAMPLE_BILL_TEXT)
ok('bill provider detected', parsed.provider === 'Comcast' || parsed.provider === 'Xfinity')
ok('bill amount = 95', parsed.amount === 95)
ok('bill account found', !!parsed.accountRef)
ok('bill plan line found', !!parsed.planLine && /plan/i.test(parsed.planLine))
const ics = buildIcs({ title: 'Dentist; cleaning', startIso: '2026-08-04T09:30:00Z', location: 'Bright Smile' })
ok('ics has VEVENT + DTSTART', !!ics && ics.includes('BEGIN:VEVENT') && ics.includes('DTSTART:20260804T093000Z'))
ok('ics escapes semicolons', !!ics && ics.includes('Dentist\\; cleaning'))
ok('ics rejects bad date', buildIcs({ title: 'x', startIso: 'Tuesday-ish' }) === null)
ok('promo "12 months" = 12', parsePromoMonths('12 months') === 12)
ok('promo "1 year" = 12', parsePromoMonths('1 year') === 12)
ok('promo null defaults 12', parsePromoMonths(null) === 12)

console.log('\n[4e] Booking demo emits appointment_iso')
clock = 1_700_000_500_000
const bookTpl = getTemplate('book-appointment')
const bookPayload = buildCall({
  template: bookTpl,
  values: { business: 'Bright Smile Dental', purpose: 'Cleaning' },
  identity: { callerName: 'Alex' },
  recipients: [{ businessName: 'Bright Smile Dental', phone: '+14155550134', region: 'US', locale: 'en-US' }],
  batch: false,
})
ok('booking schema includes appointment_iso', JSON.stringify(bookPayload.body.result_schema).includes('appointment_iso'))
const bk = demoCreate(bookPayload.body, 'book-appointment', bookPayload.demoPlan)
clock += 20000
const bkc = demoGet(bk.id)!
const bkIso = (bkc.structured_result as any).appointment_iso
ok('demo booking has parseable ISO', typeof bkIso === 'string' && !Number.isNaN(new Date(bkIso).getTime()))

console.log('\n[5] outcomeToText + computeImpact')
const text = outcomeToText(bill, c, 'Negotiate a bill · Xfinity')
ok('outcome text has title', text.includes('Negotiate a bill'))
ok('outcome text has money', /\$\d/.test(text))
ok('outcome text has evidence', text.toLowerCase().includes('evidence'))

const hist: HistoryEntry[] = [
  { id: '1', at: '', mode: 'demo', templateId: 'negotiate-bill', templateLabel: '', batch: false, title: '', status: 'completed', outcomeLabel: '', outcomeTone: 'success', headline: null, summary: null, savedUsd: 420, kind: 'saved' },
  { id: '2', at: '', mode: 'demo', templateId: 'chase-refund', templateLabel: '', batch: false, title: '', status: 'completed', outcomeLabel: '', outcomeTone: 'success', headline: null, summary: null, savedUsd: 412, kind: 'recovered' },
  { id: '3', at: '', mode: 'demo', templateId: 'book-appointment', templateLabel: '', batch: false, title: '', status: 'completed', outcomeLabel: '', outcomeTone: 'success', headline: null, summary: null, savedUsd: 0, kind: 'booked' },
]
const impact = computeImpact(hist)
ok('impact totalSaved = 832', impact.totalSaved === 832)
ok('impact callsHandled = 3', impact.callsHandled === 3)
ok('impact booked = 1', impact.booked === 1)
ok('impact minutesSaved = 45', impact.minutesSaved === 45)

console.log('\n[6] Custom playbook — `collect` coercion (regression)')
const customTpl = getTemplate('custom')
// Guard the example data: chips field must be an array, not a joined string.
ok('custom example.collect is an array', Array.isArray(customTpl.example.values.collect))
const runCustom = (collect: unknown) => {
  clock = 1_700_001_000_000
  const pay = buildCall({
    template: customTpl,
    values: { task: 'Call the pharmacy.', collect: collect as any },
    identity: { callerName: 'Alex' },
    recipients: [{ businessName: 'Pharmacy', phone: '+14155550134', region: 'US', locale: 'en-US' }],
    batch: false,
  })
  const created = demoCreate(pay.body, 'custom', pay.demoPlan) // used to throw on a string
  clock += 20000
  return demoGet(created.id)!.structured_result as any
}
ok('array collect → answer_1..3', (() => { const r = runCustom(['a', 'b', 'c']); return 'answer_1' in r && 'answer_3' in r })())
ok('string collect does not crash', (() => { const r = runCustom('just one thing'); return 'answer_1' in r })())
ok('undefined collect is fine', (() => { const r = runCustom(undefined); return 'summary' in r })())

console.log('\n[7] Localization directive')
const esPay = buildCall({
  template: bill,
  values: { company: 'Telmex', goal: 'lower', approvalMode: 'ask' },
  identity: { callerName: 'Alex' },
  recipients: [{ businessName: 'Telmex', phone: '+525555550134', region: 'MX', locale: 'es-MX' }],
  batch: false,
})
ok('es-MX task instructs Spanish', esPay.body.task.includes('Conduct the entire call in Spanish'))
ok('en-US task has no language directive', !singlePayload.body.task.includes('Conduct the entire call in'))

console.log('\n[8] Denominator honesty — Quote Shootout with a voicemail')
const quoteTpl = getTemplate('get-quote')
const shootout = buildCall({
  template: quoteTpl,
  values: { service: 'front brake pads + rotors' },
  identity: { callerName: 'Alex' },
  recipients: [
    { businessName: 'A Auto', phone: '+14155550111', region: 'US', locale: 'en-US' },
    { businessName: 'B Auto', phone: '+14155550122', region: 'US', locale: 'en-US' },
    { businessName: 'C Auto', phone: '+14155550199', region: 'US', locale: 'en-US' }, // ...99 → voicemail
  ],
  batch: true,
})
ok('batch task carries the aggregation-honesty rule', shootout.body.task.includes('AGGREGATION HONESTY'))
ok('aggregate schema declares reached + note', JSON.stringify(shootout.body.result_schema).includes('reached') && JSON.stringify(shootout.body.result_schema).includes('note'))
clock = 1_700_002_000_000
const soId = demoCreate(shootout.body, 'get-quote', shootout.demoPlan).id
clock += 40000
const soAgg = demoGet(soId)!.structured_result as any
ok('shootout businesses_called = 3', soAgg.businesses_called === 3)
ok('shootout reached = 2 (one voicemail)', soAgg.reached === 2)
ok('shootout quotes_received = 2', soAgg.quotes_received === 2)
ok('shootout does NOT count the unreached', typeof soAgg.note === 'string' && soAgg.note.includes('not reached'))
ok('cheapest computed over the 2 quotes', typeof soAgg.cheapest_price === 'number')
ok('denominatorLine names the base', (denominatorLine(soAgg) ?? '').includes('of 3 called'))

console.log('\n[9a] Fixed AI disclosure in every task')
ok('disclosure present with a caller name', singlePayload.body.task.includes('AI voice assistant'))
const noName = buildCall({
  template: bill,
  values: { company: 'X', goal: 'lower' },
  identity: {},
  recipients: [{ businessName: 'X', phone: '+14155550111', region: 'US', locale: 'en-US' }],
  batch: false,
})
ok('disclosure present even without a caller name', noName.body.task.includes('AI voice assistant'))

console.log('\n[9] Verification gate (confidence + evidence)')
ok('successful single call is evidence-backed', isOutcomeVerified(c) === true)
const vmSingle = buildCall({
  template: quoteTpl,
  values: { business: 'X', service: 'brakes' },
  identity: { callerName: 'Alex' },
  recipients: [{ businessName: 'X', phone: '+14155550199', region: 'US', locale: 'en-US' }],
  batch: false,
})
clock = 1_700_003_000_000
const vmId = demoCreate(vmSingle.body, 'get-quote', vmSingle.demoPlan).id
clock += 12000
ok('voicemail (low confidence, no evidence) is NOT verified', isOutcomeVerified(demoGet(vmId)!) === false)

;(Date as any).now = realNow
console.log(`\n✅ All ${pass} checks passed.\n`)
