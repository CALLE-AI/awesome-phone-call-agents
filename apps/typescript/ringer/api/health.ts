import type { VercelRequest, VercelResponse } from '@vercel/node'
import { allowCors } from './_lib/calle.js'
import { kvConfigured } from './_lib/store.js'

/**
 * GET /api/health — reports server capabilities so the UI can adapt.
 * `hasServerKey` lets Live run without BYOK; `hasScheduler` (server key + KV)
 * enables durable scheduled/recurring calls instead of in-browser reminders.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  allowCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  // The shared server key is only usable when an app secret gates it (fail
  // closed). A key set without a secret is "locked" — clients must use BYOK.
  const keySet = Boolean(process.env.CALLE_API_KEY)
  const secretSet = Boolean(process.env.CALLE_APP_SECRET)
  const serverKeyUsable = keySet && secretSet
  res.status(200).json({
    ok: true,
    service: 'ringer',
    hasServerKey: serverKeyUsable,
    // When usable, callers must present the app secret to spend the shared key.
    appSecretRequired: serverKeyUsable,
    // Diagnostic: a key is configured but locked because no secret is set.
    serverKeyLocked: keySet && !secretSet,
    // Scheduled calls fire server-side, so they need KV and a usable server key.
    hasScheduler: serverKeyUsable && kvConfigured(),
    webhookConfigured: Boolean(process.env.CALLE_WEBHOOK_URL?.trim()),
    baseUrl: (process.env.CALLE_BASE_URL || 'https://api.heycall-e.com').replace(/\/$/, ''),
  })
}
