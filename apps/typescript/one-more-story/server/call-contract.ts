import { createHash } from 'node:crypto'

export type StoryCallRequest = {
  requestId: string
  storytellerPhone: string
  locale: string
  region?: string
  familyName: string
  question: string
  contactPermission: boolean
  aiDisclosureApproved: boolean
  confirmIntent: boolean
}

export type StoryCallResult = {
  disclosure_acknowledged: 'yes' | 'no' | 'unknown'
  permission_to_continue: 'yes' | 'no' | 'unknown'
  story_answer: string
  correction: string | null
  readback_confirmed: 'yes' | 'no' | 'unknown'
  deletion_requested: boolean
}

const E164 = /^\+[1-9]\d{7,14}$/
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/

export function assertLiveCallAuthorized(request: StoryCallRequest): void {
  if (!E164.test(request.storytellerPhone)) throw new Error('The storyteller phone must be an explicit E.164 number.')
  if (!LOCALE.test(request.locale)) throw new Error('The storyteller locale must be an explicit BCP 47 language tag.')
  if (!request.familyName.trim()) throw new Error('The family member placing the call must be named.')
  if (!request.question.trim()) throw new Error('The family must approve one explicit question.')
  if (!request.contactPermission) throw new Error('Recorded permission to contact this adult is required.')
  if (!request.aiDisclosureApproved) throw new Error('The family must approve the spoken AI disclosure.')
  if (!request.confirmIntent) throw new Error('A fresh explicit intent confirmation is required for this call.')
}

export function buildCallTask(request: StoryCallRequest): string {
  return [
    `You are an AI calling on behalf of ${request.familyName}.`,
    'Begin by clearly saying that you are an AI and that the call may be processed and transcribed.',
    'Ask whether the storyteller gives permission to continue and to save their answer for read-back.',
    'If permission is not an explicit yes, thank them, end the call, and record no story.',
    `If permission is given, ask exactly one question: "${request.question.trim()}"`,
    'Listen without adding facts. Read the answer back. Ask for corrections.',
    'Read the corrected version back and ask whether it is right.',
    'A story is confirmed only after an explicit yes to that final read-back.',
    'If the storyteller asks to delete the answer, acknowledge the request and mark deletion_requested true.',
    'Do not give medical, legal, financial, or emergency advice. Do not arrange another call.',
  ].join(' ')
}

export const storyResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'disclosure_acknowledged',
    'permission_to_continue',
    'story_answer',
    'correction',
    'readback_confirmed',
    'deletion_requested',
  ],
  properties: {
    disclosure_acknowledged: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    permission_to_continue: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    story_answer: { type: 'string' },
    correction: { type: ['string', 'null'] },
    readback_confirmed: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    deletion_requested: { type: 'boolean' },
  },
} as const

export function idempotencyKey(request: StoryCallRequest): string {
  const material = JSON.stringify({ requestId: request.requestId, phone: request.storytellerPhone, question: request.question })
  return `one-more-story-${createHash('sha256').update(material).digest('hex').slice(0, 16)}`
}

export function isConfirmedStory(result: StoryCallResult): boolean {
  return result.disclosure_acknowledged === 'yes'
    && result.permission_to_continue === 'yes'
    && result.readback_confirmed === 'yes'
    && !result.deletion_requested
}
