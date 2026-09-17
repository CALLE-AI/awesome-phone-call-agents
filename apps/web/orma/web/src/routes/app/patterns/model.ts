/**
 * Pure helpers for Patterns. No network and no framework imports.
 * Every count comes from the rows passed in. Every time renders in the profile's zone.
 */

export const KNOWN_MOODS = ['energised', 'ok', 'low', 'stressed'] as const

const ANSWERED_DISPOSITIONS = ['answered_extracted', 'answered_no_result']

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
]

export type TrendRun = {
	id: string
	mood: string | null
	disposition: string | null
	scheduled_for: string
	local_date: string
}

/** True when the run counts as answered, mirroring the facts SQL. */
export function isAnswered(disposition: string | null): boolean {
	return disposition !== null && ANSWERED_DISPOSITIONS.includes(disposition)
}

/** Lane index for a heard mood, or -1 when the dot renders hollow. */
export function moodLane(mood: string | null): number {
	return KNOWN_MOODS.indexOf((mood ?? '') as (typeof KNOWN_MOODS)[number])
}

function dayMonth(dateOnly: string): { day: number; month: number } | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly)
	if (!match) return null
	return { day: Number(match[3]), month: Number(match[2]) }
}

/** "1 to 14 September", from the facts window with a fallback to the report columns. */
export function periodLabel(facts: Record<string, unknown>, report: { period_start: string; period_end: string }): string {
	const start = typeof facts['period_start'] === 'string' ? (facts['period_start'] as string) : report.period_start
	const end = typeof facts['period_end'] === 'string' ? (facts['period_end'] as string) : report.period_end
	const startParts = dayMonth(start.slice(0, 10))
	const endParts = dayMonth(end.slice(0, 10))
	if (!startParts || !endParts) return ''
	if (startParts.month === endParts.month) {
		return `${startParts.day} to ${endParts.day} ${MONTH_LONG[endParts.month - 1]}`
	}
	return `${startParts.day} ${MONTH_SHORT[startParts.month - 1]} to ${endParts.day} ${MONTH_SHORT[endParts.month - 1]}`
}

/** Prose as plain paragraphs. No markdown is parsed and no numbers are added. */
export function proseParagraphs(prose: string): string[] {
	return prose
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph.length > 0)
}

export function formatFactValue(value: unknown): string {
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	if (value === null || value === undefined) return 'null'
	return JSON.stringify(value)
}

/** Every facts key beside its value, in the stored key order. */
export function factEntries(facts: Record<string, unknown>): { key: string; value: string }[] {
	return Object.entries(facts).map(([key, value]) => ({ key, value: formatFactValue(value) }))
}

/** Required observed days: the facts value when present, else the T7.1 rule of 3. */
export function requiredDays(facts: Record<string, unknown> | null): number {
	const raw = facts?.['required_days']
	return typeof raw === 'number' && Number.isFinite(raw) ? raw : 3
}

/** Completed runs so far, counted from rows. Never extrapolated. */
export function completedSoFar(runs: readonly { state: string }[]): number {
	return runs.filter((run) => run.state === 'completed').length
}

/** Runs inside the report window. The loader sorts chronologically, so points keep that order. */
export function trendRuns<T extends TrendRun>(runs: readonly T[], periodStart: string, periodEnd: string): T[] {
	const start = periodStart.slice(0, 10)
	const end = periodEnd.slice(0, 10)
	return runs.filter((run) => run.local_date >= start && run.local_date <= end)
}

/** "1 Sep" axis label from a local date. */
export function axisLabel(localDate: string): string {
	const parts = dayMonth(localDate.slice(0, 10))
	if (!parts) return ''
	return `${parts.day} ${MONTH_SHORT[parts.month - 1]}`
}
