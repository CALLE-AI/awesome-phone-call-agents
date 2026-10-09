import { getSession, getSupabase } from "$lib/supabase"
import type { PageLoad } from "./$types"

export const ssr = false
export const prerender = false

export type ItemRows = {
	userId: string
	profile: { timezone: string } | null
	items: {
		id: string
		text: string
		status: string
		since_date: string | null
		created_at: string
		retired_at: string | null
		retired_reason: string | null
		source: string
		seeded: boolean
	}[]
	mentions: { item_id: string }[]
}

function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
	if (result.error) throw new Error(`Could not read ${what}: ${result.error.message}`)
	return result.data
}

export const load: PageLoad = async ({ parent, depends }) => {
	depends("orma:items")
	const { session } = await parent()
	const live = await getSession()
	const userId = live?.user.id ?? session?.user.id ?? ""
	if (!userId) return { rows: null as ItemRows | null, error: "Sign in again to see your items." }

	try {
		const supabase = getSupabase()
		const [profileRes, itemsRes, mentionsRes] = await Promise.all([
			supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle(),
			supabase
				.from("items")
				.select("id,text,status,since_date,created_at,retired_at,retired_reason,source,seeded")
				.eq("user_id", userId)
				.order("created_at", { ascending: true }),
			supabase.from("item_mentions").select("item_id")
		])

		return {
			rows: {
				userId,
				profile: must(profileRes, "your profile"),
				items: must(itemsRes, "your items"),
				mentions: must(mentionsRes, "item mentions")
			},
			error: ""
		}
	} catch (err) {
		return {
			rows: null as ItemRows | null,
			error: err instanceof Error ? err.message : "Could not load your items."
		}
	}
}
