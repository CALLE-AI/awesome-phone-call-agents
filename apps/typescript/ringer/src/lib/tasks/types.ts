import type { JsonObject } from '@/lib/calle/types'

export type FieldType =
  | 'text'
  | 'textarea'
  | 'tel'
  | 'number'
  | 'select'
  | 'chips'
  | 'date'

export interface FieldOption {
  value: string
  label: string
}

export interface TemplateField {
  name: string
  label: string
  type: FieldType
  placeholder?: string
  help?: string
  required?: boolean
  options?: FieldOption[]
  example?: string
  /** Prefix shown inside the input, e.g. `$`. */
  prefix?: string
  /** For `number` inputs. */
  min?: number
  /** Only render this field when another field has a given value. */
  showWhen?: { field: string; equals: string }
}

export type ResultKind =
  | 'text'
  | 'money'
  | 'badge'
  | 'list'
  | 'boolean'
  | 'datetime'
  | 'outcome'

export interface ResultFieldSpec {
  key: string
  label: string
  kind?: ResultKind
  /** Render larger / highlighted in the outcome card. */
  emphasize?: boolean
}

/** Maps a raw outcome value to a semantic tone for badges/headlines. */
export type OutcomeTone = 'success' | 'partial' | 'failed' | 'pending' | 'neutral'

export interface TaskValues {
  [key: string]: string | string[] | undefined
}

export interface TaskTemplate {
  id: string
  label: string
  /** One-line value proposition shown on the picker card. */
  tagline: string
  /** lucide-react icon name. */
  icon: string
  /** Accent hue token used for the card + outcome. */
  accent: 'violet' | 'emerald' | 'amber' | 'rose' | 'sky' | 'slate'
  /** Short realistic example the user can one-click to prefill. */
  example: {
    label: string
    values: TaskValues
  }
  /** Whether this template is offered in Quote Shootout (batch) mode. */
  batchable?: boolean
  fields: TemplateField[]
  /** Build the natural-language CALL-E task instruction. */
  buildTask: (v: TaskValues, ctx: BuildContext) => string
  /** Build the strict JSON Schema for the per-call structured result. */
  buildResultSchema: (v: TaskValues) => JsonObject
  /** How to present the structured result. */
  resultView: ResultFieldSpec[]
  /** Key in the structured result that carries the headline outcome enum. */
  outcomeKey: string
  /** Map an outcome enum value to a tone + human label. */
  outcomeMap: Record<string, { tone: OutcomeTone; label: string }>
  /** Optional bespoke headline, e.g. "$95 → $60/mo". `currency` is ISO 4217. */
  headline?: (result: JsonObject, currency?: string) => string | null
}

export interface BuildContext {
  callerName: string
  callbackNumber?: string
  /** ISO 4217 currency for amounts stated in the task (default USD). */
  currency?: string
}
