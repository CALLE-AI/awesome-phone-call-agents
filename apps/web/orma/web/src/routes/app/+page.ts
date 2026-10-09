import { getSession, getSupabase } from "$lib/supabase"
import { loadTodayRows, type TodayRows } from "$lib/today/load"
import type { PageLoad } from "./$types"

// Spec §11 renders /app in the browser. Reads go to PostgREST under RLS.
export const ssr = false
export const prerender = false

export const load: PageLoad = async ({ parent, depends }) => {
	depends("orma:today")
	const { session } = await parent()
	const live = await getSession()
	const userId = live?.user.id ?? session?.user.id ?? ""
	if (!userId) {
		return { rows: null as TodayRows | null, error: "Sign in again to see Today." }
	}
	try {
		return { rows: await loadTodayRows(getSupabase(), userId), error: "" }
	} catch (err) {
		return {
			rows: null as TodayRows | null,
			error: err instanceof Error ? err.message : "Could not load Today."
		}
	}
}
