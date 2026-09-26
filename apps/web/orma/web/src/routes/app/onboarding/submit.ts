/**
 * Write the first profile, optional outbound_calls consent, and first slot.
 * apikey is the publishable anon key. Bearer is the user JWT.
 */
import {
  CONSENT_KIND_OUTBOUND,
  prepareOnboarding,
  type OnboardingInput,
} from "./model.ts"

export type OnboardingClient = {
  apiUrl: string
  accessToken: string
  userId: string
  anonKey: string
  fetch?: typeof fetch
}

function apiBase(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "")
  if (!base) throw new Error("missing ORMA_API_URL")
  if (base.includes("supabase.co")) throw new Error("must not use the project host")
  return base
}

function requireAnonKey(anonKey: string | undefined): string {
  if (typeof anonKey !== "string" || anonKey.length === 0) {
    throw new Error("missing publishable anon key")
  }
  return anonKey
}

function headers(anonKey: string, accessToken: string, prefer?: string): Record<string, string> {
  const key = requireAnonKey(anonKey)
  const next: Record<string, string> = {
    apikey: key,
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  }
  if (prefer) next.prefer = prefer
  return next
}

function restMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      message?: string
      details?: string
      hint?: string
      code?: string
    }
    const parts = [parsed.message, parsed.details, parsed.hint].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    if (parts.length > 0) return parts.join(" ")
  } catch {
    // Body is not PostgREST JSON. Fall through to the raw text.
  }
  return body || `request failed (${status})`
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!response.ok) throw new Error(restMessage(response.status, text))
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function hasLiveOutboundConsent(
  client: OnboardingClient,
  base: string,
): Promise<boolean> {
  const fetchImpl = client.fetch ?? fetch
  const response = await fetchImpl(
    `${base}/rest/v1/consents?user_id=eq.${encodeURIComponent(client.userId)}&kind=eq.${CONSENT_KIND_OUTBOUND}&revoked_at=is.null&select=id&limit=1`,
    { headers: headers(client.anonKey, client.accessToken) },
  )
  const rows = await readJson(response)
  return Array.isArray(rows) && rows.length > 0
}

async function existingSlotId(client: OnboardingClient, base: string): Promise<string | null> {
  const fetchImpl = client.fetch ?? fetch
  const response = await fetchImpl(
    `${base}/rest/v1/slots?user_id=eq.${encodeURIComponent(client.userId)}&select=id&limit=1`,
    { headers: headers(client.anonKey, client.accessToken) },
  )
  const rows = await readJson(response)
  if (!Array.isArray(rows) || rows.length === 0) return null
  const id = (rows[0] as { id?: unknown }).id
  return typeof id === "string" ? id : null
}

async function upsertProfile(
  client: OnboardingClient,
  base: string,
  row: Record<string, unknown>,
): Promise<void> {
  const fetchImpl = client.fetch ?? fetch
  const inserted = await fetchImpl(`${base}/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: headers(
      client.anonKey,
      client.accessToken,
      "return=minimal,resolution=merge-duplicates",
    ),
    body: JSON.stringify(row),
  })
  if (inserted.ok) {
    await inserted.text()
    return
  }
  if (inserted.status !== 409) {
    throw new Error(restMessage(inserted.status, await inserted.text()))
  }
  const patched = await fetchImpl(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(client.userId)}`,
    {
      method: "PATCH",
      headers: headers(client.anonKey, client.accessToken, "return=minimal"),
      body: JSON.stringify({
        display_name: row.display_name,
        phone_e164: row.phone_e164,
        timezone: row.timezone,
      }),
    },
  )
  if (!patched.ok) throw new Error(restMessage(patched.status, await patched.text()))
  await patched.text()
}

export async function submitOnboarding(
  client: OnboardingClient,
  input: OnboardingInput,
): Promise<{ consented: boolean }> {
  const prepared = prepareOnboarding(input, client.userId)
  const base = apiBase(client.apiUrl)
  requireAnonKey(client.anonKey)
  const fetchImpl = client.fetch ?? fetch
  await upsertProfile(client, base, {
    id: client.userId,
    display_name: prepared.displayName,
    phone_e164: prepared.phoneE164,
    timezone: prepared.timeZone,
  })

  if (prepared.consentRows.length > 0) {
    const already = await hasLiveOutboundConsent(client, base)
    if (!already) {
      const inserted = await fetchImpl(`${base}/rest/v1/consents`, {
        method: "POST",
        headers: headers(client.anonKey, client.accessToken, "return=minimal"),
        body: JSON.stringify(prepared.consentRows),
      })
      if (!inserted.ok) throw new Error(restMessage(inserted.status, await inserted.text()))
      await inserted.text()
    }
  }

  const slotBody = {
    user_id: client.userId,
    local_time: prepared.localTime,
    weekdays: prepared.weekdays,
    part_of_day: prepared.partOfDay,
    active: true,
  }
  const slotId = await existingSlotId(client, base)
  if (slotId) {
    const patched = await fetchImpl(
      `${base}/rest/v1/slots?id=eq.${encodeURIComponent(slotId)}`,
      {
        method: "PATCH",
        headers: headers(client.anonKey, client.accessToken, "return=minimal"),
        body: JSON.stringify(slotBody),
      },
    )
    if (!patched.ok) throw new Error(restMessage(patched.status, await patched.text()))
    await patched.text()
  } else {
    const inserted = await fetchImpl(`${base}/rest/v1/slots`, {
      method: "POST",
      headers: headers(client.anonKey, client.accessToken, "return=minimal"),
      body: JSON.stringify(slotBody),
    })
    if (!inserted.ok) throw new Error(restMessage(inserted.status, await inserted.text()))
    await inserted.text()
  }

  return { consented: prepared.consentRows.length > 0 }
}
