import { getSession, getSupabase } from "$lib/supabase"
import type { CommitmentRow, RunMentionRow, RunRow } from "$lib/today/model"
import type { PageLoad } from "./$types"

// Spec §11 renders /app/history in the browser. Reads go to PostgREST under RLS.
export const ssr = false
export const prerender = false

export type HistoryRows = {
	userId: string
	profile: { timezone: string } | null
	runs: RunRow[]
	transcripts: {
		call_run_id: string
		turns: unknown
		raw: unknown
	}[]
	results: {
		call_run_id: string
		structured: unknown
		valid: boolean
	}[]
	mentions: RunMentionRow[]
	commitments: CommitmentRow[]
}

function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`Could not read ${what}: ${result.error.message}`)
	return result.data
}

const RUN_COLUMNS =
	"id,state,disposition,mood,scheduled_for,claimed_at,dispatched_at,completed_at,poll_after,slot_id"

export const load: PageLoad = async ({ parent, depends }) => {
	depends("orma:history")
	const { session } = await parent()
	const live = await getSession()
	const userId = live?.user.id ?? session?.user.id ?? ""
	if (!userId) return { rows: null as HistoryRows | null, error: "Sign in again to see your history." }

	try {
		const supabase = getSupabase()
		const profileRes = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle()
		const profile = must(profileRes, "your profile")
		// Scheduled runs never rang and canceled runs never will. Live runs stay: they render on-the-call.
		const runsRes = await supabase
			.from("call_runs")
			.select(RUN_COLUMNS)
			.eq("user_id", userId)
			.neq("state", "scheduled")
			.neq("state", "canceled")
			.order("scheduled_for", { ascending: false })
			.limit(200)
		const runs = must(runsRes, "your calls") as RunRow[]
		const ids = runs.map((run) => run.id)

		const [transcriptsRes, resultsRes, mentionsRes, commitmentsRes] = await Promise.all([
			ids.length > 0
				? supabase.from("transcripts").select("call_run_id,turns,raw").in("call_run_id", ids)
				: Promise.resolve({ data: [] as HistoryRows["transcripts"], error: null }),
			ids.length > 0
				? supabase.from("results").select("call_run_id,structured,valid").in("call_run_id", ids)
				: Promise.resolve({ data: [] as HistoryRows["results"], error: null }),
			ids.length > 0
				? supabase
						.from("item_mentions")
						.select("item_id,call_run_id,offset_seconds,items(text,status,source,created_at,retired_at)")
						.in("call_run_id", ids)
				: Promise.resolve({ data: [] as RunMentionRow[], error: null }),
			ids.length > 0
				? supabase
						.from("commitments")
						.select("item_id,call_run_id,due,evidence_offset_seconds,items(text)")
						.eq("user_id", userId)
						.in("call_run_id", ids)
				: Promise.resolve({ data: [] as CommitmentRow[], error: null }),
		])

		return {
			rows: {
				userId,
				profile,
				runs,
				transcripts: must(transcriptsRes, "your transcripts"),
				results: must(resultsRes, "your results"),
				mentions: must(mentionsRes, "item mentions") as unknown as RunMentionRow[],
				commitments: must(commitmentsRes, "your commitments") as unknown as CommitmentRow[],
			},
			error: "",
		}
	} catch (err) {
		return {
			rows: null as HistoryRows | null,
			error: err instanceof Error ? err.message : "Could not load your history.",
		}
	}
}
