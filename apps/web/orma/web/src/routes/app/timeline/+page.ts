import { getSession, getSupabase } from "$lib/supabase"
import type { PageLoad } from "./$types"
import type { TimelineEvent, TimelineRun } from "./model"

export const ssr = false
export const prerender = false

export type TimelineRows = {
	userId: string
	timezone: string
	runs: TimelineRun[]
	events: TimelineEvent[]
}

function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`Could not read ${what}: ${result.error.message}`)
	return result.data
}

export const load: PageLoad = async ({ parent, depends }) => {
	depends("orma:timeline")
	const { session } = await parent()
	const live = await getSession()
	const userId = live?.user.id ?? session?.user.id ?? ""
	if (!userId) return { rows: null as TimelineRows | null, error: "Sign in again to see your timeline." }

	try {
		const supabase = getSupabase()
		const profileRes = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle()
		const profile = must(profileRes, "your profile")
		const runsRes = await supabase
			.from("call_runs")
			.select("id,scheduled_for,state,disposition,dry_run,local_date,part_of_day")
			.eq("user_id", userId)
			.order("scheduled_for", { ascending: false })
		const runs = must(runsRes, "your runs") as TimelineRun[]
		const runIds = runs.map((run) => run.id)
		let events: TimelineEvent[] = []
		if (runIds.length > 0) {
			const eventsRes = await supabase
				.from("call_events")
				.select("id,call_run_id,at,kind,detail")
				.in("call_run_id", runIds)
				.order("at", { ascending: true })
				.order("id", { ascending: true })
			events = must(eventsRes, "your timeline") as TimelineEvent[]
		}
		return {
			rows: { userId, timezone: profile?.timezone ?? "Asia/Kolkata", runs, events },
			error: ""
		}
	} catch (err) {
		return {
			rows: null as TimelineRows | null,
			error: err instanceof Error ? err.message : "Could not load your timeline."
		}
	}
}
