import { getAuthLocals, getOrmaApiUrl, getPublishableKey } from "$lib/supabase"
import type { LayoutServerLoad } from "./$types"
import { hasProfileCached, lookupProfileExists } from "./app/onboarding/profile-gate"

type GateAuth = ReturnType<typeof getAuthLocals> & { hasProfile?: boolean }

export const prerender = false

export const load: LayoutServerLoad = async ({ locals }) => {
	const auth = getAuthLocals(locals) as GateAuth
	const session = auth.session ?? null
	const user = auth.user ?? null
	if (!session?.access_token || !user?.id) {
		return { session, user, hasProfile: false }
	}
	const hasProfile =
		typeof auth.hasProfile === "boolean"
			? auth.hasProfile
			: await hasProfileCached(locals, () =>
					lookupProfileExists({
						apiUrl: getOrmaApiUrl(),
						anonKey: getPublishableKey(),
						accessToken: session.access_token,
						userId: user.id
					})
				)
	return {
		session,
		user,
		hasProfile
	}
}
