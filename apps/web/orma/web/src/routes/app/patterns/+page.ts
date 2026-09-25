import { getSession, getSupabase } from "$lib/supabase"
import type { PageLoad } from "./$types"

export const ssr = false
export const prerender = false

export type PatternReportRow = {
	id: string
	period_start: string
	period_end: string
	facts: Record<string, unknown>
	prose: string
	created_at: string
}

export type PatternRunRow = {
	id: string
	mood: string | null
	disposition: string | null
	scheduled_for: string
	local_date: string
	state: string
}

export type PatternDeliveryRow = {
	id: string
	channel: string
	kind: string
	call_run_id: string | null
	sent_at: string | null
}

export type PatternRows = {
	userId: string
	timezone: string
	report: PatternReportRow | null
	runs: PatternRunRow[]
	deliveries: PatternDeliveryRow[]
}

function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`Could not read ${what}: ${result.error.message}`)
	return result.data
}

export const load: PageLoad = async ({ parent, depends }) => {
	depends("orma:patterns")
	const { session } = await parent()
	const live = await getSession()
	const userId = live?.user.id ?? session?.user.id ?? ""
	if (!userId) return { rows: null as PatternRows | null, error: "Sign in again to see your patterns." }

	try {
		const supabase = getSupabase()
		const [profileRes, reportRes, runsRes, deliveriesRes] = await Promise.all([
			supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle(),
			supabase
				.from("pattern_reports")
				.select("id,period_start,period_end,facts,prose,created_at")
				.eq("user_id", userId)
				.order("created_at", { ascending: false })
				.limit(1)
				.maybeSingle(),
			supabase
				.from("call_runs")
				.select("id,mood,disposition,scheduled_for,local_date,state")
				.eq("user_id", userId)
				.order("scheduled_for", { ascending: true }),
			supabase
				.from("deliveries")
				.select("id,channel,kind,call_run_id,sent_at")
				.eq("user_id", userId)
				.eq("kind", "pattern")
				.order("sent_at", { ascending: false })
		])

		const profile = must(profileRes, "your profile") as { timezone: string } | null
		const report = must(reportRes, "your pattern reports") as PatternReportRow | null
		const runs = must(runsRes, "your calls") as PatternRunRow[]
		const deliveries = must(deliveriesRes, "your deliveries") as PatternDeliveryRow[]

		return {
			rows: {
				userId,
				timezone: profile?.timezone ?? "Asia/Kolkata",
				report,
				runs,
				deliveries
			},
			error: ""
		}
	} catch (err) {
		return {
			rows: null as PatternRows | null,
			error: err instanceof Error ? err.message : "Could not load your patterns."
		}
	}
}
