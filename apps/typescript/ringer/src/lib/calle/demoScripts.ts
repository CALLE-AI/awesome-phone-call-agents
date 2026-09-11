import type {
  CompletionConfidence,
  EventLevel,
  JsonObject,
  TranscriptSpeaker,
} from './types'
import type { TaskValues } from '@/lib/tasks/types'
import { formatMoney } from '@/lib/format'

export interface DemoTurn {
  atMs: number
  speaker: TranscriptSpeaker
  text: string
}

export interface DemoEvent {
  atMs: number
  type: string
  level: EventLevel
  message: string
}

/** One post-decision continuation of a checkpointed call. */
export interface DemoBranch {
  /** Turn times are relative to the moment the user decided. */
  turns: DemoTurn[]
  /** Event times relative to the decision moment. */
  events: DemoEvent[]
  /** How long after the decision this branch completes. */
  totalMs: number
  result: JsonObject
  summary: string
  taskCompleted: boolean
  confidence: CompletionConfidence
  evidence: string[]
}

/** A human-in-the-loop pause point: the agent holds until the user decides. */
export interface DemoCheckpoint {
  /** When (from call start) the approval is requested. */
  atMs: number
  /** Short offer line surfaced to the user, e.g. "$70/mo for 12 months". */
  offer: string
  /** Full prompt for the approval card. */
  prompt: string
  branches: { accept: DemoBranch; push: DemoBranch }
}

export type DemoScenario = 'default' | 'voicemail' | 'escalated'

export interface DemoScript {
  /** When the recipient "answers" and conversation begins. */
  connectMs: number
  /** When this recipient's call completes. */
  totalMs: number
  turns: DemoTurn[]
  events: DemoEvent[]
  /** Structured result for this recipient (batch) / whole call (single). */
  result: JsonObject
  summary: string
  taskCompleted: boolean
  confidence: CompletionConfidence
  evidence: string[]
  /**
   * Optional human-in-the-loop pause. When present, `turns`/`events` cover
   * only the pre-checkpoint part and `result`/`summary` are placeholders —
   * the chosen branch supplies the ending.
   */
  checkpoint?: DemoCheckpoint
}

const val = (v: TaskValues, k: string, fallback = ''): string => {
  const x = v[k]
  return (typeof x === 'string' && x.trim()) || fallback
}

const num = (v: TaskValues, k: string, fallback: number): number => {
  const x = Number(String(v[k] ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(x) && x > 0 ? x : fallback
}

/**
 * Currency-appropriate quote amounts for the Shootout demo, so a run reads as a
 * realistic monthly price in the recipient's currency (e.g. ₦ for Nigeria)
 * rather than a $-scale number. Keyed by ISO 4217; falls back to USD.
 */
const QUOTE_BASES: Record<string, number[]> = {
  USD: [289, 415, 342, 268, 380],
  CAD: [360, 520, 430, 340, 480],
  GBP: [220, 340, 275, 200, 310],
  AUD: [380, 560, 460, 350, 520],
  EUR: [260, 400, 320, 240, 360],
  SGD: [95, 150, 120, 85, 135],
  MYR: [220, 360, 290, 190, 330],
  IDR: [450000, 700000, 560000, 380000, 640000],
  PHP: [2600, 4200, 3300, 2100, 3800],
  KES: [3800, 6000, 4700, 3200, 5400],
  NGN: [25000, 42000, 33000, 20000, 38000],
  INR: [1900, 3200, 2500, 1500, 2900],
  AED: [180, 300, 240, 150, 270],
  MXN: [950, 1550, 1250, 820, 1400],
  BRL: [290, 470, 380, 250, 430],
  JPY: [8500, 14000, 11000, 7000, 12500],
  VND: [950000, 1550000, 1250000, 820000, 1400000],
}

/** Short "went to voicemail" flow shared by all templates. */
function voicemailScript(biz: string): DemoScript {
  return {
    connectMs: 5200,
    totalMs: 9000,
    events: [
      { atMs: 0, type: 'call.queued', level: 'info', message: 'Call task accepted and queued.' },
      { atMs: 600, type: 'call.dialing', level: 'info', message: `Dialing ${biz}…` },
      { atMs: 2600, type: 'call.ringing', level: 'debug', message: 'Ringing…' },
      { atMs: 5200, type: 'call.voicemail', level: 'warning', message: 'Voicemail detected. Leaving a brief message.' },
      { atMs: 9000, type: 'call.completed', level: 'info', message: 'Call completed. No live answer — follow-up recommended.' },
    ],
    turns: [
      {
        atMs: 5600,
        speaker: 'bot',
        text: `Hi, this message is for ${biz}. I was calling about an account matter — I'll try again soon, or please return the call at the callback number on file. Thank you!`,
      },
    ],
    result: {
      outcome: 'callback_required',
      next_steps: 'The line went to voicemail. Retry later or escalate on the next attempt.',
    },
    summary: `${biz} didn't pick up — the call went to voicemail and a brief message was left.`,
    taskCompleted: false,
    confidence: { score: 0.34, label: 'low' },
    evidence: ['No live person answered; voicemail greeting detected after several rings.'],
  }
}

/**
 * Build a personalized demo script for a template + user input. The script
 * references the real names/numbers the user typed so the demo feels live.
 * `variant` lets Quote Shootout produce different outcomes per business.
 * `scenario` selects voicemail / escalated follow-up flows.
 */
export function buildDemoScript(
  templateId: string,
  v: TaskValues,
  opts: { businessName?: string; variant?: number; scenario?: DemoScenario; currency?: string } = {},
): DemoScript {
  const variant = opts.variant ?? 0
  const currency = opts.currency ?? 'USD'
  const biz = opts.businessName || val(v, 'company') || val(v, 'business') || 'the company'
  const escalated = opts.scenario === 'escalated'

  if (opts.scenario === 'voicemail') return voicemailScript(biz)

  const baseEvents = (connectMs: number, totalMs: number): DemoEvent[] => [
    { atMs: 0, type: 'call.queued', level: 'info', message: 'Call task accepted and queued.' },
    { atMs: 600, type: 'call.dialing', level: 'info', message: `Dialing ${biz}…` },
    { atMs: connectMs - 400, type: 'call.ivr', level: 'debug', message: 'Navigating phone menu…' },
    { atMs: connectMs, type: 'call.answered', level: 'info', message: 'Connected to a representative.' },
    { atMs: totalMs, type: 'call.completed', level: 'info', message: 'Call completed. Extracting structured result.' },
  ]

  switch (templateId) {
    case 'negotiate-bill': {
      const current = num(v, 'currentAmount', 95)
      const offer1 = Math.round(current * 0.74) // first offer from the rep
      const target = Math.round(current * (escalated ? 0.58 : 0.62)) // after pushing
      const askApproval = val(v, 'approvalMode') !== 'auto'
      const connectMs = 3200
      const conf = (amt: number) => `CX${7300 + amt}`

      const openLine = escalated
        ? `Hi Marcus. I'm following up on the account — on the last attempt we couldn't reach a resolution, so I'd like to speak with your retention or loyalty team about the monthly rate of about $${current}.`
        : `Hi Marcus. I'm calling about the account — the monthly bill recently went up to about $${current}, and I'd like to see what can be done to bring it down.`

      const preTurns: DemoTurn[] = [
        { atMs: connectMs + 300, speaker: 'user', text: 'Thanks for calling billing, this is Marcus, how can I help?' },
        { atMs: connectMs + 1700, speaker: 'bot', text: openLine },
        { atMs: connectMs + 4200, speaker: 'user', text: 'Let me take a look… I do see the promotional rate expired last month.' },
        { atMs: connectMs + 6200, speaker: 'bot', text: `I understand. I've been a loyal customer for a few years, and a competitor is currently offering a comparable plan for less. I'd really like to stay — is there a loyalty or promotional rate you can apply?` },
        { atMs: connectMs + 9000, speaker: 'user', text: `I can offer a loyalty credit that brings you to about $${offer1} a month for 12 months.` },
      ]

      const preEvents: DemoEvent[] = [
        { atMs: 0, type: 'call.queued', level: 'info', message: 'Call task accepted and queued.' },
        { atMs: 600, type: 'call.dialing', level: 'info', message: `Dialing ${biz}…` },
        { atMs: connectMs - 400, type: 'call.ivr', level: 'debug', message: 'Navigating phone menu…' },
        ...(escalated
          ? [{ atMs: connectMs - 100, type: 'call.transfer', level: 'debug' as const, message: 'Requested retention / loyalty team.' }]
          : []),
        { atMs: connectMs, type: 'call.answered', level: 'info', message: 'Connected to a representative.' },
      ]

      if (!askApproval) {
        // Autonomous flow: accept the negotiated rate straight through.
        const totalMs = 15500
        return {
          connectMs,
          totalMs,
          events: [
            ...preEvents,
            { atMs: totalMs, type: 'call.completed', level: 'info', message: 'Call completed. Extracting structured result.' },
          ],
          turns: [
            ...preTurns,
            { atMs: connectMs + 10600, speaker: 'bot', text: `That works — $${offer1} a month for 12 months. Can you confirm that's the total after taxes and give me a confirmation number?` },
            { atMs: connectMs + 12200, speaker: 'user', text: `Yes, it'll show on your next cycle. Your confirmation number is ${conf(offer1)}.` },
            { atMs: connectMs + 13600, speaker: 'bot', text: 'Perfect, thank you so much for your help, Marcus. Have a great day.' },
          ],
          result: {
            outcome: 'success',
            previous_amount: current,
            new_amount: offer1,
            monthly_savings: current - offer1,
            promo_length: '12 months',
            confirmation_number: conf(offer1),
            agent_name: 'Marcus',
            next_steps: 'New rate applies on the next billing cycle. No action needed.',
          },
          summary: `Negotiated the monthly bill from $${current} down to $${offer1} for 12 months (loyalty credit). Confirmation ${conf(offer1)}.`,
          taskCompleted: true,
          confidence: { score: 0.92, label: 'high' },
          evidence: [
            `Representative confirmed a loyalty credit lowering the rate to $${offer1}/mo.`,
            'A confirmation number was provided and the change applies next cycle.',
          ],
        }
      }

      // Human-in-the-loop flow: pause when the offer lands and ask the user.
      const checkpointAt = connectMs + 11400
      const accept: DemoBranch = {
        turns: [
          { atMs: 500, speaker: 'bot', text: `Great news — let's go ahead with $${offer1} a month for 12 months. Could I get a confirmation number?` },
          { atMs: 2100, speaker: 'user', text: `Done. It'll show on your next cycle — confirmation number ${conf(offer1)}.` },
          { atMs: 3500, speaker: 'bot', text: 'Perfect, thank you so much for your help, Marcus.' },
        ],
        events: [{ atMs: 4600, type: 'call.completed', level: 'info', message: 'Call completed. Extracting structured result.' }],
        totalMs: 4600,
        result: {
          outcome: 'success',
          previous_amount: current,
          new_amount: offer1,
          monthly_savings: current - offer1,
          promo_length: '12 months',
          confirmation_number: conf(offer1),
          agent_name: 'Marcus',
          next_steps: 'You approved the offer live. New rate applies next cycle.',
        },
        summary: `You approved the $${offer1}/mo offer live on the call — down from $${current}. Confirmation ${conf(offer1)}.`,
        taskCompleted: true,
        confidence: { score: 0.93, label: 'high' },
        evidence: [
          `You approved the $${offer1}/mo loyalty offer in real time.`,
          'Representative issued a confirmation number for the new rate.',
        ],
      }
      const push: DemoBranch = {
        turns: [
          { atMs: 500, speaker: 'bot', text: `I appreciate that, but the competitor's offer is still meaningfully lower. Is there anything closer to $${target} you could do for a loyal customer?` },
          { atMs: 2900, speaker: 'user', text: `Hmm… let me check with my supervisor. …Okay, I can apply an additional retention credit — $${target} a month, locked for 12 months.` },
          { atMs: 5500, speaker: 'bot', text: `$${target} a month works. Could I get a confirmation number for the change?` },
          { atMs: 7100, speaker: 'user', text: `Of course — confirmation ${conf(target)}. It takes effect on your next bill.` },
          { atMs: 8600, speaker: 'bot', text: 'Wonderful. Thanks for going the extra mile, Marcus.' },
        ],
        events: [
          { atMs: 3000, type: 'call.negotiating', level: 'debug', message: 'Pushed back on the first offer; rep checking with a supervisor.' },
          { atMs: 9800, type: 'call.completed', level: 'info', message: 'Call completed. Extracting structured result.' },
        ],
        totalMs: 9800,
        result: {
          outcome: 'success',
          previous_amount: current,
          new_amount: target,
          monthly_savings: current - target,
          promo_length: '12 months',
          confirmation_number: conf(target),
          agent_name: 'Marcus',
          next_steps: 'You asked Ringer to push — it beat the first offer. New rate applies next cycle.',
        },
        summary: `You told Ringer to push past the first $${offer1} offer — final rate $${target}/mo for 12 months (was $${current}). Confirmation ${conf(target)}.`,
        taskCompleted: true,
        confidence: { score: 0.94, label: 'high' },
        evidence: [
          `First offer was $${offer1}/mo; after pushing, the rep applied an extra retention credit to $${target}/mo.`,
          'Supervisor-approved credit confirmed with a confirmation number.',
        ],
      }

      return {
        connectMs,
        totalMs: checkpointAt, // superseded by the chosen branch
        events: preEvents,
        turns: [
          ...preTurns,
          { atMs: connectMs + 10600, speaker: 'bot', text: 'That sounds promising — give me just a moment to check that against my notes.' },
        ],
        result: {},
        summary: '',
        taskCompleted: false,
        confidence: { score: 0, label: 'low' },
        evidence: [],
        checkpoint: {
          atMs: checkpointAt,
          offer: `$${offer1}/mo for 12 months`,
          prompt: `They offered $${offer1}/mo for 12 months (down from $${current}). Accept it, or push for a better rate?`,
          branches: { accept, push },
        },
      }
    }

    case 'cancel-subscription': {
      const connectMs = 3400
      const totalMs = 14000
      const conf = `CAN-${48210 + variant}`
      return {
        connectMs,
        totalMs,
        events: baseEvents(connectMs, totalMs),
        turns: [
          { atMs: connectMs + 300, speaker: 'user', text: 'Member services, this is Dana.' },
          { atMs: connectMs + 1600, speaker: 'bot', text: `Hi Dana, I'd like to cancel the membership on the account, effective as soon as possible.` },
          { atMs: connectMs + 3600, speaker: 'user', text: `I can help with that. Before I do — I can offer you two months free if you'd like to stay?` },
          { atMs: connectMs + 5400, speaker: 'bot', text: `I appreciate that, but please go ahead and cancel. I won't be able to use it going forward.` },
          { atMs: connectMs + 7400, speaker: 'user', text: `Understood. It's cancelled. There are no further charges, and it's effective today.` },
          { atMs: connectMs + 9200, speaker: 'bot', text: `Thank you. Could I get a cancellation confirmation number for my records?` },
          { atMs: connectMs + 10800, speaker: 'user', text: `Of course — it's ${conf}.` },
          { atMs: connectMs + 12200, speaker: 'bot', text: 'Great, thank you for your help, Dana.' },
        ],
        result: {
          outcome: 'success',
          cancellation_confirmation: conf,
          effective_date: 'Today',
          final_charge: 'None — no further charges',
          retention_offer: 'Two months free (declined)',
          next_steps: 'Keep the confirmation number. Verify the card is no longer charged next month.',
        },
        summary: `Cancelled successfully, effective today. Declined a 2-months-free retention offer. Confirmation ${conf}.`,
        taskCompleted: true,
        confidence: { score: 0.9, label: 'high' },
        evidence: [
          'Representative confirmed the membership is cancelled with no further charges.',
          `Provided cancellation confirmation number ${conf}.`,
        ],
      }
    }

    case 'book-appointment': {
      const connectMs = 3000
      const totalMs = 13500
      const slots = [
        { label: 'Tuesday at 9:30 AM', h: 9, m: 30 },
        { label: 'Wednesday at 4:15 PM', h: 16, m: 15 },
        { label: 'Thursday at 10:00 AM', h: 10, m: 0 },
      ]
      const picked = slots[variant % slots.length]
      const slot = picked.label
      const when = new Date(Date.now() + (3 + variant) * 86_400_000)
      when.setHours(picked.h, picked.m, 0, 0)
      const slotIso = when.toISOString()
      const conf = `BK${3391 + variant * 7}`
      return {
        connectMs,
        totalMs,
        events: baseEvents(connectMs, totalMs),
        turns: [
          { atMs: connectMs + 300, speaker: 'user', text: `Thanks for calling ${biz}, how can I help?` },
          { atMs: connectMs + 1700, speaker: 'bot', text: `Hi! I'd like to book ${val(v, 'purpose', 'an appointment')}. Do you have anything on a weekday morning this week?` },
          { atMs: connectMs + 4200, speaker: 'user', text: `Let me check the calendar… I have ${slot}, would that work?` },
          { atMs: connectMs + 6200, speaker: 'bot', text: `${slot} is perfect. Please book it under the name provided.` },
          { atMs: connectMs + 8200, speaker: 'user', text: `Done. You're all set for ${slot}. Your confirmation is ${conf}.` },
          { atMs: connectMs + 10200, speaker: 'bot', text: 'Wonderful — anything I should bring or prepare?' },
          { atMs: connectMs + 11400, speaker: 'user', text: 'Just arrive five minutes early. See you then!' },
        ],
        result: {
          outcome: 'success',
          appointment_datetime: slot,
          appointment_iso: slotIso,
          location: biz,
          provider_name: null,
          confirmation_number: conf,
          notes: 'Arrive 5 minutes early.',
        },
        summary: `Booked ${val(v, 'purpose', 'the appointment')} at ${biz} for ${slot}. Confirmation ${conf}.`,
        taskCompleted: true,
        confidence: { score: 0.94, label: 'high' },
        evidence: [`Representative confirmed the booking for ${slot} with confirmation ${conf}.`],
      }
    }

    case 'chase-refund': {
      const amount = num(v, 'amount', 412)
      const connectMs = 3600
      const totalMs = 16000
      const caseNo = `CASE-${90210 + variant}`
      return {
        connectMs,
        totalMs,
        events: [
          ...baseEvents(connectMs, totalMs).slice(0, 3),
          { atMs: connectMs - 200, type: 'call.transfer', level: 'debug', message: 'Escalated to a supervisor.' },
          { atMs: connectMs, type: 'call.answered', level: 'info', message: 'Connected to a supervisor.' },
          { atMs: totalMs, type: 'call.completed', level: 'info', message: 'Call completed. Extracting structured result.' },
        ],
        turns: [
          { atMs: connectMs + 300, speaker: 'user', text: 'This is the resolutions team, I understand you have a refund issue?' },
          { atMs: connectMs + 1900, speaker: 'bot', text: `Yes. There's an outstanding refund of $${amount} that was promised weeks ago but never posted. I'd like it processed today.` },
          { atMs: connectMs + 4400, speaker: 'user', text: 'I see the notes here… you\'re right, it was approved but never pushed through. I apologize.' },
          { atMs: connectMs + 6600, speaker: 'bot', text: 'Thank you. Can you process the full refund now to the original payment method and give me a case number and expected date?' },
          { atMs: connectMs + 9000, speaker: 'user', text: `Yes. I've processed $${amount} back to your original card. It'll post in 3 to 5 business days. Case number ${caseNo}.` },
          { atMs: connectMs + 11400, speaker: 'bot', text: 'I appreciate you sorting that out. Thank you for your help.' },
        ],
        result: {
          outcome: 'success',
          amount_recovered: amount,
          method: 'Refund to original payment method',
          expected_date: '3–5 business days',
          case_number: caseNo,
          next_steps: 'Watch for the refund on your card statement within 5 business days.',
        },
        summary: `Recovered a stuck $${amount} refund to the original card. Posts in 3–5 business days. Case ${caseNo}.`,
        taskCompleted: true,
        confidence: { score: 0.88, label: 'high' },
        evidence: [
          `Supervisor confirmed $${amount} was refunded to the original payment method.`,
          `Provided case number ${caseNo} with a 3–5 business day timeline.`,
        ],
      }
    }

    case 'get-quote': {
      // Currency-appropriate quote amounts so a ₦ (or £, ₹…) Shootout reads
      // realistically — not a $-scale figure with a ₦ symbol slapped on.
      const bases = QUOTE_BASES[currency] ?? QUOTE_BASES.USD
      const low = bases[variant % bases.length]
      const high = Math.round(low * (1.12 + (variant % 3) * 0.05))
      const m = (n: number) => formatMoney(n, currency) ?? String(n)
      const avail = ['This Thursday', 'Next Monday', 'Same-day if you sign up by noon', 'Tomorrow afternoon'][variant % 4]
      const names = ['Sam', 'Priya', 'Diego', 'Tanya', 'Wei'][variant % 5]
      const connectMs = 2600 + (variant % 3) * 400
      const totalMs = 11000 + (variant % 3) * 1200
      return {
        connectMs,
        totalMs,
        events: baseEvents(connectMs, totalMs),
        turns: [
          { atMs: connectMs + 300, speaker: 'user', text: `${biz}, this is ${names}.` },
          { atMs: connectMs + 1600, speaker: 'bot', text: `Hi ${names}, I'm calling for a quote on ${val(v, 'service', 'a service')}. What would that run?` },
          { atMs: connectMs + 4000, speaker: 'user', text: `For that, you're looking at around ${m(low)} to ${m(high)}, everything included.` },
          { atMs: connectMs + 6200, speaker: 'bot', text: `Got it — ${m(low)} to ${m(high)} all in. And what's your earliest availability?` },
          { atMs: connectMs + 8000, speaker: 'user', text: `We could do ${avail}.` },
          { atMs: connectMs + 9400, speaker: 'bot', text: 'Perfect, thank you very much!' },
        ],
        result: {
          outcome: 'success',
          price_low: low,
          price_high: high,
          includes: 'Everything included',
          availability: avail,
          contact_name: names,
          notes: null,
        },
        summary: `${biz} quoted ${m(low)}–${m(high)}, available ${avail.toLowerCase()}.`,
        taskCompleted: true,
        confidence: { score: 0.9, label: 'high' },
        evidence: [`${names} at ${biz} quoted ${m(low)}–${m(high)}.`],
      }
    }

    case 'general-inquiry': {
      const connectMs = 2600
      const totalMs = 9500
      return {
        connectMs,
        totalMs,
        events: baseEvents(connectMs, totalMs),
        turns: [
          { atMs: connectMs + 300, speaker: 'user', text: `${biz}, how can I help?` },
          { atMs: connectMs + 1500, speaker: 'bot', text: `Hi! ${val(v, 'question', 'I had a quick question.')}` },
          { atMs: connectMs + 3800, speaker: 'user', text: 'Yes — we\'re open 9 to 5 on the holiday, and we do have that in stock right now.' },
          { atMs: connectMs + 5600, speaker: 'bot', text: 'That\'s exactly what I needed, thank you!' },
        ],
        result: {
          outcome: 'success',
          answer: 'Open 9 AM–5 PM on the holiday; the item is currently in stock.',
          contact_name: null,
          next_steps: 'Stop by before 5 PM to pick it up.',
        },
        summary: 'Confirmed holiday hours (9–5) and that the item is in stock.',
        taskCompleted: true,
        confidence: { score: 0.86, label: 'high' },
        evidence: ['Representative confirmed holiday hours and current stock availability.'],
      }
    }

    default: {
      const connectMs = 2800
      const totalMs = 11000
      // `collect` may arrive as an array (chips UI) or a string (prefill/example);
      // coerce safely and consistently with the `list()` helper in templates.ts.
      const rawCollect = v.collect
      const collect = Array.isArray(rawCollect)
        ? rawCollect.filter(Boolean)
        : typeof rawCollect === 'string' && rawCollect.trim()
          ? [rawCollect.trim()]
          : []
      const result: JsonObject = {
        outcome: 'success',
        summary: 'Reached the right person and completed the request as described.',
      }
      collect.forEach((c, i) => {
        result[`answer_${i + 1}`] = `Confirmed: ${c}`
      })
      return {
        connectMs,
        totalMs,
        events: baseEvents(connectMs, totalMs),
        turns: [
          { atMs: connectMs + 300, speaker: 'user', text: `Hello, ${biz}, how can I help?` },
          { atMs: connectMs + 1600, speaker: 'bot', text: `Hi! ${val(v, 'task', 'I have a quick request.')}` },
          { atMs: connectMs + 4200, speaker: 'user', text: 'Sure, I can take care of that for you right now.' },
          { atMs: connectMs + 6000, speaker: 'bot', text: 'Thank you so much, that\'s all I needed.' },
        ],
        result,
        summary: 'Completed the requested call and captured the details.',
        taskCompleted: true,
        confidence: { score: 0.85, label: 'high' },
        evidence: ['The representative confirmed the request was handled.'],
      }
    }
  }
}
