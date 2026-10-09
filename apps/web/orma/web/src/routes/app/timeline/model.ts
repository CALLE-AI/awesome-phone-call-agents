/**
 * Pure helpers for the operator timeline. No network and no framework imports.
 * Steps sort by (at, id). Every clock renders in the profile timezone.
 * Detail payloads render raw, with phone-shaped text masked before display.
 */
import { dispositionLabel } from "$lib/today/model"

export type TimelineRun = {
	id: string
	scheduled_for: string
	state: string
	disposition: string | null
	dry_run: boolean
	local_date: string
	part_of_day: string
}

export type TimelineEvent = {
	id: number
	call_run_id: string
	at: string
	kind: string
	detail: Record<string, unknown> | null
}

type Detail = Record<string, unknown> | null | undefined

const LIVE_STATES: Record<string, true> = { claimed: true, dispatched: true, awaiting_result: true }
const STOPPED_STATES: Record<string, true> = { failed: true, no_result: true }

export function isLiveState(state: string): boolean {
	return LIVE_STATES[state] === true
}

export function isStoppedState(state: string): boolean {
	return STOPPED_STATES[state] === true
}

/** Steps in row order: by instant, then by append id. */
export function sortSteps(events: readonly TimelineEvent[]): TimelineEvent[] {
	return [...events].sort((a, b) => {
		if (a.at < b.at) return -1
		if (a.at > b.at) return 1
		return a.id - b.id
	})
}

/**
 * Events grouped by run, newest-run order preserved by the caller.
 * Rows for unknown run ids are dropped, so a stray row never renders.
 */
export function groupByRun(
	events: readonly TimelineEvent[],
	runIds: readonly string[]
): Map<string, TimelineEvent[]> {
	const known = new Set(runIds)
	const grouped = new Map<string, TimelineEvent[]>()
	for (const id of runIds) grouped.set(id, [])
	for (const event of events) {
		if (!known.has(event.call_run_id)) continue
		grouped.get(event.call_run_id)?.push(event)
	}
	for (const [id, list] of grouped) grouped.set(id, sortSteps(list))
	return grouped
}

/**
 * The picker default. Runs arrive newest first, so this is the latest run
 * that has events, falling back to the latest run. Null when there are none.
 */
export function pickDefaultRunId(
	runs: readonly TimelineRun[],
	byRun: Map<string, TimelineEvent[]>
): string | null {
	for (const run of runs) {
		if ((byRun.get(run.id)?.length ?? 0) > 0) return run.id
	}
	return runs[0]?.id ?? null
}

export type StoppedRun = { run: TimelineRun; lastKind: string | null }

/** Failed and no_result runs with the last event kind named. */
export function stoppedRuns(
	runs: readonly TimelineRun[],
	byRun: Map<string, TimelineEvent[]>
): StoppedRun[] {
	return runs
		.filter((run) => isStoppedState(run.state))
		.map((run) => {
			const steps = byRun.get(run.id) ?? []
			return { run, lastKind: steps.length > 0 ? steps[steps.length - 1].kind : null }
		})
}

/**
 * Masks anything shaped like a phone number (+ followed by 7 to 15 digits)
 * before a payload reaches the screen or a doc.
 */
export function maskPhones(text: string): string {
	return text.replace(/\+\d{7,15}/g, "+[masked]")
}

function str(detail: Detail, key: string): string | null {
	const value = detail?.[key]
	return typeof value === "string" && value.trim().length > 0 ? value : null
}

function num(detail: Detail, key: string): number | null {
	const value = detail?.[key]
	return typeof value === "number" && Number.isFinite(value) ? value : null
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`
}

function ingestedCounts(detail: Detail): { items: number; mentions: number; retirements: number; commitments: number } | null {
	const nested = detail?.["counts"]
	if (nested && typeof nested === "object" && !Array.isArray(nested)) {
		const rec = nested as Record<string, unknown>
		const read = (key: string): number | null => {
			const value = rec[key]
			return typeof value === "number" && Number.isFinite(value) ? value : null
		}
		const items = read("items")
		const mentions = read("mentions")
		const retirements = read("retirements")
		const commitments = read("commitments")
		if (items !== null && mentions !== null && retirements !== null && commitments !== null) {
			return { items, mentions, retirements, commitments }
		}
	}
	const items = num(detail, "item_count")
	const mentions = num(detail, "mention_count")
	const retirements = num(detail, "retirement_count")
	const commitments = num(detail, "commitment_count")
	if (items === null || mentions === null || retirements === null || commitments === null) return null
	return { items, mentions, retirements, commitments }
}

/**
 * One honest gloss line per step, derived from stable detail fields.
 * Unknown future kinds fall through verbatim and never crash the page.
 */
export function glossFor(kind: string, detail: Detail, clock: (iso: string) => string): string {
	switch (kind) {
		case "materialised": {
			const scheduled = str(detail, "scheduled_for")
			return scheduled ? `Scheduled for ${clock(scheduled)}` : "Scheduled by the materialiser"
		}
		case "claimed":
			return "Picked up by the minute tick"
		case "dispatched":
			return "Sent to CALL-E"
		case "polled": {
			const reason = str(detail, "failure_reason")
			if (reason) return `Check failed: ${reason}`
			const state = str(detail, "state")
			if (str(detail, "outcome") === "terminal" && state) return `Confirmed ${state}`
			return state ? `Checked CALL-E, still ${state}` : "Checked CALL-E again"
		}
		case "webhook_received": {
			const eventType = str(detail, "event_type")
			return eventType ? `CALL-E said ${eventType}` : "CALL-E sent an update"
		}
		case "refetched": {
			const state = str(detail, "state")
			const outcome = str(detail, "outcome")
			if (state && outcome === "terminal") return `Confirmed ${state}`
			if (state && outcome) return `${state}, ${outcome}`
			return state ? `Re-fetched CALL-E, ${state}` : "Re-fetched CALL-E"
		}
		case "ingested": {
			const counts = ingestedCounts(detail)
			if (!counts) return "Call result ingested, no counts recorded"
			return [
				plural(counts.items, "captured", "captured"),
				plural(counts.retirements, "retirement", "retirements"),
				plural(counts.commitments, "commitment", "commitments"),
				plural(counts.mentions, "mention", "mentions")
			].join(", ")
		}
		case "finalised": {
			const state = str(detail, "state") ?? kind
			const label = dispositionLabel(str(detail, "disposition"))
			const reason = str(detail, "failure_reason")
			return `${state}${label ? `, ${label}` : ""}${reason ? `. ${reason}` : ""}`
		}
		default:
			return `Recorded ${kind}`
	}
}
