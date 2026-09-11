import type { CallTask, JsonObject } from './calle/types'
import type { TaskTemplate } from './tasks/types'
import { formatMoney, humanizeKey } from './format'
import { isOutcomeVerified } from './honesty'

/** Human-readable, copy-paste-friendly summary of a completed call. */
export function outcomeToText(template: TaskTemplate, call: CallTask, title: string, currency = 'USD'): string {
  const lines: string[] = [`Ringer — ${title}`, '']
  const result = (call.structured_result ?? {}) as JsonObject
  // A raw live response may omit array fields; the demo always sets them.
  const recipients = call.recipients ?? []
  const evidence = call.evidence ?? []

  if (!isOutcomeVerified(call)) {
    lines.push('NEEDS REVIEW — CALL-E could not fully confirm this outcome; check the transcript.', '')
  }

  if (recipients.length > 1) {
    // Batch: aggregate + per-recipient.
    if (call.summary) lines.push(call.summary, '')
    recipients.forEach((r) => {
      const rr = (r.structured_result ?? {}) as JsonObject
      const head = template.headline?.(rr, currency)
      lines.push(`• ${r.phones?.[0] ?? ''}${head ? ` — ${head}` : ''}${r.summary ? `: ${r.summary}` : ''}`)
    })
  } else {
    const outcomeVal = String(result[template.outcomeKey] ?? '')
    const outcome = template.outcomeMap[outcomeVal]
    if (outcome) lines.push(`Outcome: ${outcome.label}`)
    const head = template.headline?.(result, currency)
    if (head) lines.push(head)
    lines.push('')
    template.resultView.forEach((spec) => {
      const raw = result[spec.key]
      if (raw == null || raw === '') return
      const val = spec.kind === 'money' ? formatMoney(raw, currency) : String(raw)
      lines.push(`${spec.label}: ${val}`)
    })
    if (evidence.length) {
      lines.push('', 'Evidence:')
      evidence.forEach((e) => lines.push(`- ${e}`))
    }
    if (call.summary) lines.push('', call.summary)
  }

  // Fallback for custom templates with no resultView coverage.
  if (lines.filter(Boolean).length <= 2) {
    Object.entries(result).forEach(([k, v]) => {
      if (v != null && v !== '') lines.push(`${humanizeKey(k)}: ${String(v)}`)
    })
  }

  return lines.join('\n').trim()
}
