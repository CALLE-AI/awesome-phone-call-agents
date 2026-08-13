import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CalleClient } from '@call-e/calle'

/**
 * POST /api/webhook — receive terminal CALL-E events (call.completed, etc).
 *
 * Demonstrates the SDK's signed-webhook verification. CALL-E signs each
 * delivery with HMAC-SHA256 over `timestamp + "." + raw_body`. We read the
 * RAW body (not the parsed one) so the signature check is byte-exact.
 *
 * The live UI polls for status, so this endpoint is optional — but wiring it
 * up (set CALLE_WEBHOOK_SECRET) shows the full terminal-event path.
 */

// Ask Vercel not to pre-parse the body so we can verify the exact bytes.
export const config = { api: { bodyParser: false } }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { code: 'invalid_request', message: 'Use POST.' } })
    return
  }

  const secret = process.env.CALLE_WEBHOOK_SECRET
  if (!secret) {
    // Nothing to verify against — accept but do nothing.
    res.status(200).json({ ok: true, note: 'CALLE_WEBHOOK_SECRET not set; event ignored.' })
    return
  }

  const rawBody = await readRawBody(req)
  const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY ?? 'unused-for-webhook' })

  try {
    const event = client.webhooks.unwrap({
      rawBody,
      headers: req.headers as Record<string, string | string[] | undefined>,
      secret,
    })
    // In a full product you would persist event.data (the terminal call task)
    // keyed by event.id for idempotency and notify the user. For the hackathon
    // we log it; CALL-E treats any 2xx as delivered.
    console.log(`[webhook] ${event.type} for call ${event.data?.id}`)
    res.status(200).json({ ok: true })
  } catch (err) {
    console.warn('[webhook] signature verification failed:', (err as Error).message)
    res.status(400).end()
  }
}

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
