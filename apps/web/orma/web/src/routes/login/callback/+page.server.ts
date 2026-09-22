import { redirect } from "@sveltejs/kit"
import { getAuthLocals, getOrmaApiUrl, getPublishableKey } from "$lib/supabase"
import type { EmailOtpType } from "@supabase/supabase-js"
import { lookupProfileExists, postAuthPath } from "../../app/onboarding/profile-gate"

const otpTypes = new Set<EmailOtpType>([
  "email",
  "magiclink",
  "signup",
  "invite",
  "recovery",
  "email_change",
])

async function destination(supabase: ReturnType<typeof getAuthLocals>["supabase"]) {
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session?.access_token || !session.user?.id) return "/app/onboarding"
  const hasProfile = await lookupProfileExists({
    apiUrl: getOrmaApiUrl(),
    anonKey: getPublishableKey(),
    accessToken: session.access_token,
    userId: session.user.id,
  })
  return postAuthPath(hasProfile)
}

export const load = async ({ url, locals }) => {
  const auth = getAuthLocals(locals)
  const queryError = url.searchParams.get("error_description") || url.searchParams.get("error")
  if (queryError) {
    return { error: queryError }
  }

  const code = url.searchParams.get("code")
  if (code) {
    const { error } = await auth.supabase.auth.exchangeCodeForSession(code)
    if (!error) redirect(303, await destination(auth.supabase))
    return { error: error.message }
  }

  const tokenHash = url.searchParams.get("token_hash")
  const type = url.searchParams.get("type")
  if (tokenHash && type && otpTypes.has(type as EmailOtpType)) {
    const { error } = await auth.supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    })
    if (!error) redirect(303, await destination(auth.supabase))
    return { error: error.message }
  }

  return { error: null as string | null }
}
