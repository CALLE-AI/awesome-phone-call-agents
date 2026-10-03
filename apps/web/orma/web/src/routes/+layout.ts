import type { LayoutLoad } from "./$types"

export const load: LayoutLoad = async ({ data, depends }) => {
	depends("supabase:auth")
	return {
		session: data.session,
		user: data.user,
		hasProfile: data.hasProfile
	}
}
