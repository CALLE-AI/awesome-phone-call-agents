/**
 * Pure helpers for History. Parsing and links only.
 * Counts come from lastCallSummary and clocks from the profile zone,
 * both in $lib/today/model, so History and Today agree by construction.
 */
import { formatOffset } from "$lib/today/model"

export type TurnView = {
	offsetSeconds: number | null
	offset: string
	who: string
	text: string
}

export function speakerLabel(speaker: unknown): string {
	const name = typeof speaker === "string" ? speaker.trim().toLowerCase() : ""
	if (name === "agent" || name === "bot" || name === "orma") return "Orma"
	if (name === "user" || name === "callee" || name === "caller" || name === "you") return "You"
	if (name && typeof speaker === "string") return speaker.trim()
	return "Unknown"
}

function turnOffset(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
	return Math.floor(value)
}

/** Turns in offset order. Turns without an offset keep file order at the end. */
export function parseTurns(turns: unknown): TurnView[] {
	if (!Array.isArray(turns)) return []
	const parsed = turns.map((turn, order) => {
		const record = turn !== null && typeof turn === "object" ? (turn as Record<string, unknown>) : {}
		const offsetSeconds = turnOffset(record.offset_seconds)
		const text = typeof record.text === "string" ? record.text : ""
		return { order, offsetSeconds, offset: formatOffset(offsetSeconds), who: speakerLabel(record.speaker), text }
	})
	parsed.sort(
		(a, b) =>
			(a.offsetSeconds ?? Number.MAX_SAFE_INTEGER) - (b.offsetSeconds ?? Number.MAX_SAFE_INTEGER) ||
			a.order - b.order,
	)
	return parsed.map((turn) => ({
		offsetSeconds: turn.offsetSeconds,
		offset: turn.offset,
		who: turn.who,
		text: turn.text,
	}))
}

/** Link into a transcript at a moment. A null offset selects the run only. */
export function historyHref(runId: string, offset?: number | null): string {
	const base = `/app/history?run=${encodeURIComponent(runId)}`
	return offset === null || offset === undefined ? base : `${base}&t=${offset}`
}

/** The t query param names a turn offset in seconds. Anything else selects nothing. */
export function parseTParam(value: string | null): number | null {
	if (value === null || value === "") return null
	const parsed = Number(value)
	if (!Number.isInteger(parsed) || parsed < 0) return null
	return parsed
}
