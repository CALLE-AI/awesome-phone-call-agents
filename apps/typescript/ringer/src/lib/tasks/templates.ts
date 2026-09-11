import type { JsonObject } from '@/lib/calle/types'
import { formatMoney } from '@/lib/format'
import type { BuildContext, TaskTemplate, TaskValues } from './types'

/* ------------------------------------------------------------------ */
/*  Small value helpers                                                */
/* ------------------------------------------------------------------ */

const s = (v: TaskValues, k: string): string => {
  const val = v[k]
  return typeof val === 'string' ? val.trim() : ''
}

const list = (v: TaskValues, k: string): string[] => {
  const val = v[k]
  if (Array.isArray(val)) return val.filter(Boolean)
  if (typeof val === 'string' && val.trim()) return [val.trim()]
  return []
}

/** Compose a task instruction from parts, dropping empty lines. */
const compose = (...lines: (string | false | null | undefined)[]): string =>
  lines.filter((l): l is string => Boolean(l && l.trim())).join('\n')

const money = (raw: string, currency = 'USD'): string => {
  if (!raw) return ''
  return formatMoney(raw, currency) ?? raw
}

const identity = (ctx: BuildContext): string => {
  // Fixed AI disclosure — stated at the start of every call, never omitted and
  // never caller-editable, so the recipient always knows they're talking to an
  // automated assistant acting on someone's behalf.
  const bits: string[] = [
    'At the very start of the call, clearly disclose that you are an AI voice assistant calling on the caller’s behalf; do not imply you are the account holder speaking in person.',
  ]
  if (ctx.callerName) bits.push(`You are calling on behalf of ${ctx.callerName}.`)
  if (ctx.callbackNumber)
    bits.push(`If asked for a callback number, provide ${ctx.callbackNumber}.`)
  return bits.join(' ')
}

/** Shared strict-object schema builder. */
const strict = (
  properties: JsonObject,
  required: string[],
): JsonObject => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
})

const OUTCOME_ENUM = ['success', 'partial', 'failed', 'callback_required'] as const

const OUTCOME_MAP = {
  success: { tone: 'success' as const, label: 'Success' },
  partial: { tone: 'partial' as const, label: 'Partial win' },
  failed: { tone: 'failed' as const, label: 'No deal' },
  callback_required: { tone: 'pending' as const, label: 'Callback needed' },
}

/* ------------------------------------------------------------------ */
/*  Templates                                                          */
/* ------------------------------------------------------------------ */

const negotiateBill: TaskTemplate = {
  id: 'negotiate-bill',
  label: 'Negotiate a bill',
  tagline: 'Get a lower rate, waive a fee, or match a competitor.',
  icon: 'TrendingDown',
  accent: 'emerald',
  example: {
    label: 'Lower my internet bill',
    values: {
      company: 'Xfinity / Comcast',
      currentAmount: '95',
      goal: 'lower',
      leverage:
        'Been a customer 4 years; AT&T Fiber is offering me $55/mo for the same speed.',
      walkAway: 'yes',
      approvalMode: 'ask',
    },
  },
  fields: [
    { name: 'company', label: 'Who are we calling?', type: 'text', required: true, placeholder: 'e.g. Xfinity / Comcast retention line', example: 'Xfinity billing' },
    { name: 'currentAmount', label: 'Current bill', type: 'number', prefix: '$', placeholder: '95', min: 0 },
    {
      name: 'goal', label: 'Goal', type: 'select', required: true,
      options: [
        { value: 'lower', label: 'Lower my monthly rate' },
        { value: 'waive_fee', label: 'Waive / refund a fee' },
        { value: 'match', label: 'Match a competitor offer' },
        { value: 'promo', label: 'Extend or restore a promo price' },
      ],
    },
    { name: 'leverage', label: 'Your leverage / context', type: 'textarea', placeholder: 'Loyalty, competitor quotes, hardship, autopay — anything that helps the agent argue your case.', help: 'The more specific, the stronger the negotiation.' },
    { name: 'accountRef', label: 'Account reference (optional)', type: 'text', placeholder: 'Last 4 of account #, name on account', help: 'Only share what you are comfortable with.' },
    {
      name: 'walkAway', label: 'Willing to cancel if they refuse?', type: 'select',
      options: [
        { value: 'yes', label: 'Yes — use cancellation as leverage' },
        { value: 'no', label: 'No — do not threaten to cancel' },
      ],
    },
    {
      name: 'approvalMode', label: 'Who approves the deal?', type: 'select',
      help: 'In Demo Mode "Ask me" pauses the live call so you can tap accept or push. In Live mode it means the agent never commits — it captures the exact offer for you to confirm.',
      options: [
        { value: 'ask', label: 'Ask me before accepting any offer (recommended)' },
        { value: 'auto', label: 'Autonomous — accept if under my limit' },
      ],
    },
    {
      name: 'autoAcceptBelow', label: 'Auto-accept at or below', type: 'number', prefix: '$', min: 0,
      placeholder: '70',
      help: 'The agent may accept any offer at or below this monthly amount.',
      showWhen: { field: 'approvalMode', equals: 'auto' },
    },
  ],
  buildTask: (v, ctx) => {
    const goal = s(v, 'goal')
    const goalLine =
      goal === 'waive_fee' ? 'get a specific fee waived or refunded'
      : goal === 'match' ? 'get my rate matched to a competitor offer'
      : goal === 'promo' ? 'restore or extend a promotional price'
      : 'reduce my monthly bill as much as possible'
    return compose(
      `Call ${s(v, 'company') || 'the company'} and negotiate on my behalf to ${goalLine}.`,
      identity(ctx),
      s(v, 'currentAmount') && `My current bill is about ${money(s(v, 'currentAmount'), ctx.currency)} per month.`,
      s(v, 'accountRef') && `Account reference: ${s(v, 'accountRef')}.`,
      s(v, 'leverage') && `Context and leverage to use: ${s(v, 'leverage')}`,
      s(v, 'walkAway') === 'yes'
        ? 'If they refuse to help, politely say I am considering cancelling and ask to be transferred to the retention or loyalty department, then continue negotiating. Do not actually cancel anything.'
        : 'Do not threaten to cancel the service.',
      'Be polite, patient, and persistent. Navigate any phone menus, hold music, and transfers as needed. Never agree to a higher price or add-ons.',
      s(v, 'approvalMode') === 'auto' && s(v, 'autoAcceptBelow')
        ? `DECISION AUTHORITY: You may accept an offer of ${money(s(v, 'autoAcceptBelow'), ctx.currency)} per month or lower on my behalf. If the best offer stays above that amount, do NOT commit — negotiate for the best possible offer, capture its exact terms (amount, promo length), and say I will confirm shortly.`
        : 'DECISION AUTHORITY: You may NOT accept or commit to any offer on my behalf. When you receive an offer, push at least once for a better one, then capture the exact best offer (amount, promo length, any conditions) and tell the representative I will confirm shortly. Never say yes to a binding change.',
      'If a discount is applied, confirm the exact new monthly amount, the length of the promotion, and any confirmation number before ending the call.',
      'Do not make up account details, PINs, or personal information. If you are asked for something you were not given, say you do not have it on hand.',
    )
  },
  buildResultSchema: () =>
    strict(
      {
        outcome: { type: 'string', enum: [...OUTCOME_ENUM], description: 'Overall result of the negotiation.' },
        previous_amount: { type: 'number', description: 'Prior monthly amount in the local currency if known.' },
        new_amount: { type: 'number', description: 'New agreed monthly amount in the local currency, if any.' },
        monthly_savings: { type: 'number', description: 'Monthly savings in the local currency, if any.' },
        promo_length: { type: 'string', description: 'Duration of any promo, e.g. "12 months".' },
        confirmation_number: { type: 'string' },
        agent_name: { type: 'string', description: 'Name of the human representative, if given.' },
        next_steps: { type: 'string', description: 'Any follow-up the user must do.' },
      },
      ['outcome'],
    ),
  outcomeKey: 'outcome',
  outcomeMap: OUTCOME_MAP,
  resultView: [
    { key: 'monthly_savings', label: 'Monthly savings', kind: 'money', emphasize: true },
    { key: 'new_amount', label: 'New monthly bill', kind: 'money', emphasize: true },
    { key: 'previous_amount', label: 'Was', kind: 'money' },
    { key: 'promo_length', label: 'Promo length', kind: 'text' },
    { key: 'confirmation_number', label: 'Confirmation #', kind: 'text' },
    { key: 'agent_name', label: 'Spoke with', kind: 'text' },
    { key: 'next_steps', label: 'Next steps', kind: 'text' },
  ],
  headline: (r, currency) => {
    const prev = r.previous_amount as number | null
    const next = r.new_amount as number | null
    if (typeof prev === 'number' && typeof next === 'number') return `${money(String(prev), currency)}/mo → ${money(String(next), currency)}/mo`
    if (typeof next === 'number') return `New rate: ${money(String(next), currency)}/mo`
    return null
  },
}

const cancelSubscription: TaskTemplate = {
  id: 'cancel-subscription',
  label: 'Cancel a subscription',
  tagline: 'Cancel cleanly and get past the retention runaround.',
  icon: 'Scissors',
  accent: 'rose',
  example: {
    label: 'Cancel my gym membership',
    values: {
      company: 'Planet Fitness — Downtown location',
      accountRef: 'Membership under my name, phone on file',
      reason: 'Moving out of state, no longer near a location',
      declineOffers: 'yes',
    },
  },
  fields: [
    { name: 'company', label: 'What are we cancelling?', type: 'text', required: true, placeholder: 'e.g. Planet Fitness membership', example: 'SiriusXM subscription' },
    { name: 'accountRef', label: 'Account reference', type: 'text', placeholder: 'Name on account, last 4 of card, member ID', help: 'Only what you are comfortable sharing.' },
    { name: 'reason', label: 'Reason for cancelling', type: 'textarea', placeholder: 'Optional — sometimes speeds things up.' },
    {
      name: 'declineOffers', label: 'Retention offers', type: 'select',
      options: [
        { value: 'yes', label: 'Decline all offers — just cancel' },
        { value: 'consider', label: 'Report offers back to me before accepting' },
      ],
    },
  ],
  buildTask: (v, ctx) =>
    compose(
      `Call ${s(v, 'company') || 'the company'} and cancel the subscription/membership on my behalf, effective as soon as allowed.`,
      identity(ctx),
      s(v, 'accountRef') && `Account reference: ${s(v, 'accountRef')}.`,
      s(v, 'reason') && `Reason for cancelling: ${s(v, 'reason')}`,
      s(v, 'declineOffers') === 'consider'
        ? 'If they make a retention offer, do NOT accept it — note the exact offer so I can decide, and still ask them to proceed with cancellation unless it requires my confirmation.'
        : 'Politely decline any retention offers, discounts, or pauses. I want to fully cancel.',
      'Navigate phone menus, hold, and transfers as needed. Insist on cancellation. Before ending the call, get: a cancellation confirmation number, the exact effective date, and confirmation that no further charges will occur. Ask whether any final or prorated charge applies.',
      'Do not make up personal information, PINs, or card numbers. If asked for something you were not given, say you do not have it available.',
    ),
  buildResultSchema: () =>
    strict(
      {
        outcome: { type: 'string', enum: ['success', 'partial', 'failed', 'callback_required'], description: 'success = cancelled/confirmed; partial = started but needs a step; callback_required = must call back or do online.' },
        cancellation_confirmation: { type: 'string' },
        effective_date: { type: 'string', description: 'When the cancellation takes effect.' },
        final_charge: { type: 'string', description: 'Any final or prorated charge described.' },
        retention_offer: { type: 'string', description: 'Any retention offer that was made.' },
        next_steps: { type: 'string' },
      },
      ['outcome'],
    ),
  outcomeKey: 'outcome',
  outcomeMap: {
    success: { tone: 'success', label: 'Cancelled' },
    partial: { tone: 'partial', label: 'In progress' },
    failed: { tone: 'failed', label: 'Not cancelled' },
    callback_required: { tone: 'pending', label: 'Action needed' },
  },
  resultView: [
    { key: 'cancellation_confirmation', label: 'Confirmation #', kind: 'text', emphasize: true },
    { key: 'effective_date', label: 'Effective', kind: 'text', emphasize: true },
    { key: 'final_charge', label: 'Final charge', kind: 'text' },
    { key: 'retention_offer', label: 'Offer made', kind: 'text' },
    { key: 'next_steps', label: 'Next steps', kind: 'text' },
  ],
}

const bookAppointment: TaskTemplate = {
  id: 'book-appointment',
  label: 'Book an appointment',
  tagline: 'Let the agent find a slot that fits and lock it in.',
  icon: 'CalendarCheck',
  accent: 'violet',
  batchable: true,
  example: {
    label: 'Book a dentist cleaning',
    values: {
      business: 'Bright Smile Dental',
      purpose: 'Routine cleaning and checkup, new patient',
      preferredTimes: ['Weekday mornings', 'This or next week', 'Not Wednesdays'],
      patientName: 'the name I provide',
    },
  },
  fields: [
    { name: 'business', label: 'Where are we booking?', type: 'text', required: true, placeholder: 'e.g. Bright Smile Dental', example: 'Luigi’s Trattoria' },
    { name: 'purpose', label: 'What is the appointment for?', type: 'textarea', required: true, placeholder: 'e.g. Routine dental cleaning, new patient; or "table for 4 at 7pm Saturday"' },
    { name: 'preferredTimes', label: 'Preferred times / constraints', type: 'chips', placeholder: 'Add a preference and press Enter', help: 'e.g. "Weekday mornings", "After 5pm", "Not Fridays".' },
    { name: 'patientName', label: 'Name for the booking', type: 'text', placeholder: 'Name to give the business' },
  ],
  buildTask: (v, ctx) => {
    const prefs = list(v, 'preferredTimes')
    return compose(
      `Call ${s(v, 'business') || 'the business'} and book an appointment on my behalf.`,
      identity(ctx),
      s(v, 'purpose') && `What the appointment is for: ${s(v, 'purpose')}`,
      s(v, 'patientName') && `Book it under the name: ${s(v, 'patientName')}.`,
      prefs.length
        ? `My scheduling preferences, in priority order: ${prefs.join('; ')}. Get the closest available slot that fits these.`
        : 'Ask for the earliest reasonable availability and pick a sensible slot.',
      'Navigate any phone menus or hold. Confirm the exact date, time, location/address, and any confirmation number or provider name before ending the call. If none of my preferred times work, book the closest good alternative and clearly report what you booked.',
      'Do not invent personal details, insurance numbers, or card numbers. If asked for something you were not given, say you will follow up with it.',
    )
  },
  buildResultSchema: () =>
    strict(
      {
        outcome: { type: 'string', enum: ['success', 'partial', 'failed', 'callback_required'], description: 'success = booked; partial = tentative/waitlist; failed = could not book.' },
        appointment_datetime: { type: 'string', description: 'Booked date and time in plain language.' },
        appointment_iso: { type: 'string', description: 'Exact appointment start as an ISO 8601 datetime (e.g. 2026-08-04T09:30:00-07:00) when determinable, else null.' },
        location: { type: 'string' },
        provider_name: { type: 'string', description: 'Provider, table, or staff member if relevant.' },
        confirmation_number: { type: 'string' },
        notes: { type: 'string', description: 'Anything to bring or prepare, or why it failed.' },
      },
      ['outcome'],
    ),
  outcomeKey: 'outcome',
  outcomeMap: {
    success: { tone: 'success', label: 'Booked' },
    partial: { tone: 'partial', label: 'Tentative' },
    failed: { tone: 'failed', label: 'No slot' },
    callback_required: { tone: 'pending', label: 'Callback needed' },
  },
  resultView: [
    { key: 'appointment_datetime', label: 'When', kind: 'text', emphasize: true },
    { key: 'location', label: 'Where', kind: 'text' },
    { key: 'provider_name', label: 'With', kind: 'text' },
    { key: 'confirmation_number', label: 'Confirmation #', kind: 'text' },
    { key: 'notes', label: 'Notes', kind: 'text' },
  ],
  headline: (r) => (r.appointment_datetime ? String(r.appointment_datetime) : null),
}

const chaseRefund: TaskTemplate = {
  id: 'chase-refund',
  label: 'Chase a refund',
  tagline: 'Dispute a charge or push a stuck refund over the line.',
  icon: 'Undo2',
  accent: 'amber',
  example: {
    label: 'Refund for a cancelled flight',
    values: {
      company: 'Delta Air Lines',
      orderRef: 'Confirmation ABC123',
      amount: '412',
      issue: 'Flight was cancelled by the airline; I was told a refund would post in 7–10 days but it has been 6 weeks.',
      resolution: 'refund',
    },
  },
  fields: [
    { name: 'company', label: 'Who owes you?', type: 'text', required: true, placeholder: 'e.g. Delta, Amazon, a store', example: 'Amazon' },
    { name: 'orderRef', label: 'Order / reference number', type: 'text', placeholder: 'Order #, confirmation code' },
    { name: 'amount', label: 'Amount in dispute', type: 'number', prefix: '$', min: 0 },
    { name: 'issue', label: 'What happened?', type: 'textarea', required: true, placeholder: 'Describe the problem and any promises already made to you.' },
    {
      name: 'resolution', label: 'Desired resolution', type: 'select',
      options: [
        { value: 'refund', label: 'Full refund' },
        { value: 'replacement', label: 'Replacement / redo' },
        { value: 'credit', label: 'Account credit is acceptable' },
        { value: 'either', label: 'Refund preferred, credit acceptable' },
      ],
    },
  ],
  buildTask: (v, ctx) => {
    const res = s(v, 'resolution')
    const want =
      res === 'replacement' ? 'a replacement or redo of the service'
      : res === 'credit' ? 'an account credit'
      : res === 'either' ? 'a full refund (an account credit is acceptable if a refund is refused)'
      : 'a full refund to my original payment method'
    return compose(
      `Call ${s(v, 'company') || 'the company'} on my behalf to resolve a billing/service issue and obtain ${want}.`,
      identity(ctx),
      s(v, 'orderRef') && `Order/reference: ${s(v, 'orderRef')}.`,
      s(v, 'amount') && `Amount in dispute: ${money(s(v, 'amount'), ctx.currency)}.`,
      s(v, 'issue') && `What happened: ${s(v, 'issue')}`,
      'Be firm but courteous. Reference any prior promises. Navigate phone menus, hold, and escalate to a supervisor if the first agent cannot help. Before ending, confirm: whether the refund/credit is approved, the exact amount, the method, the expected date it will post, and a confirmation or case number.',
      'Do not invent card numbers or personal information. If asked for something you were not given, say you will follow up with it.',
    )
  },
  buildResultSchema: () =>
    strict(
      {
        outcome: { type: 'string', enum: ['success', 'partial', 'failed', 'callback_required'], description: 'success = refund/credit approved; partial = escalated/opened case; failed = denied.' },
        amount_recovered: { type: 'number', description: 'Approved amount in the local currency.' },
        method: { type: 'string', description: 'Refund, replacement, or credit.' },
        expected_date: { type: 'string' },
        case_number: { type: 'string' },
        next_steps: { type: 'string' },
      },
      ['outcome'],
    ),
  outcomeKey: 'outcome',
  outcomeMap: {
    success: { tone: 'success', label: 'Approved' },
    partial: { tone: 'partial', label: 'Escalated' },
    failed: { tone: 'failed', label: 'Denied' },
    callback_required: { tone: 'pending', label: 'Callback needed' },
  },
  resultView: [
    { key: 'amount_recovered', label: 'Recovered', kind: 'money', emphasize: true },
    { key: 'method', label: 'As', kind: 'text' },
    { key: 'expected_date', label: 'Expected by', kind: 'text' },
    { key: 'case_number', label: 'Case #', kind: 'text' },
    { key: 'next_steps', label: 'Next steps', kind: 'text' },
  ],
  headline: (r, currency) =>
    typeof r.amount_recovered === 'number' ? `${money(String(r.amount_recovered), currency)} recovered` : null,
}

const getQuote: TaskTemplate = {
  id: 'get-quote',
  label: 'Get a price quote',
  tagline: 'Call around and collect real prices — great for Shootout.',
  icon: 'BadgeDollarSign',
  accent: 'sky',
  batchable: true,
  example: {
    label: 'Quote a brake job',
    values: {
      business: 'the auto shop',
      service: '2018 Honda Civic — front brake pads and rotors replacement. Need an out-the-door price and earliest availability.',
      timeframe: 'This week if possible',
    },
  },
  fields: [
    { name: 'business', label: 'Business name', type: 'text', required: true, placeholder: 'e.g. Mike’s Auto Repair', example: 'Any local shop' },
    { name: 'service', label: 'What do you need quoted?', type: 'textarea', required: true, placeholder: 'Describe the job/product precisely so the quote is apples-to-apples.' },
    { name: 'timeframe', label: 'Timeframe', type: 'text', placeholder: 'e.g. This week, next month, flexible' },
  ],
  buildTask: (v, ctx) =>
    compose(
      `Call ${s(v, 'business') || 'the business'} and get a clear price quote on my behalf.`,
      identity(ctx),
      s(v, 'service') && `What I need quoted: ${s(v, 'service')}`,
      s(v, 'timeframe') && `Timeframe: ${s(v, 'timeframe')}.`,
      'Ask for a specific total or a low–high price range, what is included, any extra fees, and the earliest availability. If they can only give a range, capture the range. Do not commit to or book anything — I only want the quote.',
      'Be brief and friendly. Navigate any phone menu to reach a person who can quote.',
    ),
  buildResultSchema: () =>
    strict(
      {
        outcome: { type: 'string', enum: ['success', 'partial', 'failed', 'callback_required'], description: 'success = got a usable quote; partial = vague/partial; failed = no quote.' },
        price_low: { type: 'number', description: 'Low end of quote in the local currency.' },
        price_high: { type: 'number', description: 'High end (or same as low if a single price), in the local currency.' },
        includes: { type: 'string', description: 'What the price includes.' },
        availability: { type: 'string' },
        contact_name: { type: 'string' },
        notes: { type: 'string' },
      },
      ['outcome'],
    ),
  outcomeKey: 'outcome',
  outcomeMap: {
    success: { tone: 'success', label: 'Quoted' },
    partial: { tone: 'partial', label: 'Rough quote' },
    failed: { tone: 'failed', label: 'No quote' },
    callback_required: { tone: 'pending', label: 'Will call back' },
  },
  resultView: [
    { key: 'price_low', label: 'From', kind: 'money', emphasize: true },
    { key: 'price_high', label: 'To', kind: 'money', emphasize: true },
    { key: 'availability', label: 'Availability', kind: 'text' },
    { key: 'includes', label: 'Includes', kind: 'text' },
    { key: 'contact_name', label: 'Spoke with', kind: 'text' },
    { key: 'notes', label: 'Notes', kind: 'text' },
  ],
  headline: (r, currency) => {
    const lo = r.price_low as number | null
    const hi = r.price_high as number | null
    if (typeof lo === 'number' && typeof hi === 'number' && hi !== lo)
      return `${money(String(lo), currency)}–${money(String(hi), currency)}`
    if (typeof lo === 'number') return money(String(lo), currency)
    if (typeof hi === 'number') return money(String(hi), currency)
    return null
  },
}

const generalInquiry: TaskTemplate = {
  id: 'general-inquiry',
  label: 'Ask a question',
  tagline: 'Get a straight answer without the hold music.',
  icon: 'MessageCircleQuestion',
  accent: 'slate',
  batchable: true,
  example: {
    label: 'Are they open on the 4th?',
    values: {
      business: 'the store',
      question: 'Are you open on July 4th, and what are the hours? Do you have the item in stock?',
    },
  },
  fields: [
    { name: 'business', label: 'Who are we calling?', type: 'text', required: true, placeholder: 'e.g. City Hall, a store, a clinic' },
    { name: 'question', label: 'What should the agent find out?', type: 'textarea', required: true, placeholder: 'Ask one or more specific questions.' },
    { name: 'reference', label: 'Reference (optional)', type: 'text', placeholder: 'Account #, order #, case #' },
  ],
  buildTask: (v, ctx) =>
    compose(
      `Call ${s(v, 'business') || 'the business'} on my behalf and get clear answers to my questions.`,
      identity(ctx),
      s(v, 'reference') && `Reference: ${s(v, 'reference')}.`,
      s(v, 'question') && `Questions to get answered: ${s(v, 'question')}`,
      'Navigate any phone menu to reach a person or automated system that can answer. Capture the specific answers clearly. If they cannot answer, note who can and how to reach them. Do not commit me to anything.',
    ),
  buildResultSchema: () =>
    strict(
      {
        outcome: { type: 'string', enum: ['success', 'partial', 'failed', 'callback_required'], description: 'success = got clear answers; partial = some answered; failed = none.' },
        answer: { type: 'string', description: 'The answer(s) to the question(s).' },
        contact_name: { type: 'string' },
        next_steps: { type: 'string' },
      },
      ['outcome'],
    ),
  outcomeKey: 'outcome',
  outcomeMap: {
    success: { tone: 'success', label: 'Answered' },
    partial: { tone: 'partial', label: 'Partly answered' },
    failed: { tone: 'failed', label: 'No answer' },
    callback_required: { tone: 'pending', label: 'Will call back' },
  },
  resultView: [
    { key: 'answer', label: 'Answer', kind: 'text', emphasize: true },
    { key: 'contact_name', label: 'Spoke with', kind: 'text' },
    { key: 'next_steps', label: 'Next steps', kind: 'text' },
  ],
  headline: (r) => (r.answer ? String(r.answer) : null),
}

const custom: TaskTemplate = {
  id: 'custom',
  label: 'Something else',
  tagline: 'Describe any call in your own words.',
  icon: 'Sparkles',
  accent: 'violet',
  example: {
    label: 'Custom call',
    values: {
      task: 'Call the pharmacy and ask if my prescription is ready for pickup, and until what time they are open today.',
      collect: ['Is it ready?', 'Pickup deadline today', 'Anything else I need to bring'],
    },
  },
  fields: [
    { name: 'task', label: 'What should the agent do?', type: 'textarea', required: true, placeholder: 'Describe the call in plain English — the goal and anything the agent should know or say.', help: 'Be specific about your goal and any details the agent needs.' },
    { name: 'collect', label: 'What should it find out? (one per line)', type: 'chips', placeholder: 'Add an item and press Enter', help: 'Each becomes a field in your structured result.' },
  ],
  buildTask: (v, ctx) =>
    compose(
      s(v, 'task') || 'Make a phone call on my behalf.',
      identity(ctx),
      list(v, 'collect').length
        ? `Make sure to find out and clearly report: ${list(v, 'collect').join('; ')}.`
        : '',
      'Navigate any phone menus, hold, and transfers as needed. Do not invent personal information; if asked for something you were not given, say you do not have it on hand. Do not commit me to anything without it being part of the goal above.',
    ),
  buildResultSchema: (v) => {
    const items = list(v, 'collect')
    const props: Record<string, JsonObject> = {
      outcome: { type: 'string', enum: ['success', 'partial', 'failed', 'callback_required'] },
      summary: { type: 'string', description: 'Plain-language summary of what happened.' },
    }
    items.forEach((item, i) => {
      props[`answer_${i + 1}`] = { type: 'string', description: `Answer to: ${item}` }
    })
    return strict(props, ['outcome'])
  },
  outcomeKey: 'outcome',
  outcomeMap: OUTCOME_MAP,
  resultView: [{ key: 'summary', label: 'Summary', kind: 'text', emphasize: true }],
  headline: (r) => (r.summary ? String(r.summary) : null),
}

export const TEMPLATES: TaskTemplate[] = [
  negotiateBill,
  cancelSubscription,
  bookAppointment,
  chaseRefund,
  getQuote,
  generalInquiry,
  custom,
]

export const TEMPLATES_BY_ID: Record<string, TaskTemplate> = Object.fromEntries(
  TEMPLATES.map((t) => [t.id, t]),
)

export const BATCH_TEMPLATES = TEMPLATES.filter((t) => t.batchable)

export function getTemplate(id: string): TaskTemplate {
  return TEMPLATES_BY_ID[id] ?? custom
}
