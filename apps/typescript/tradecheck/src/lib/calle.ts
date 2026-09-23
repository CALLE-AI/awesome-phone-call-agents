/**
 * calle.ts — CALL-E live verification call client.
 *
 * Safety rules enforced here:
 *  - Phone numbers are masked in all server-side logs (last 4 digits only).
 *  - All outbound fetch calls use `redirect: 'error'` to prevent
 *    credential-bearing Bearer tokens from being forwarded to a redirect target.
 *  - Raw provider diagnostic payloads are NOT logged; only the error type and
 *    message are surfaced so internal provider details never reach server logs.
 *  - `confidenceNote` is always set to 'advisory_estimate' — confidence scores
 *    are heuristic estimates, not live-verified metrics.
 *  - `requiresReconciliation` is set to true whenever the outcome is ambiguous
 *    so the chat orchestrator can enforce a user reconciliation step before
 *    allowing any further call tool invocations.
 */

export interface CalleResult {
  reached_business: 'yes' | 'no' | 'unclear';
  confirmed_business_name?: string;
  product_match?: 'matches' | 'discrepancy' | 'could_not_compare';
  stated_price_or_terms?: string;
  advance_payment_requested?: string;
  red_flags?: string[];
  verdict: 'verified_reachable' | 'discrepancy_found' | 'could_not_verify';
  transcript?: string | null;
  /** Advisory heuristic score (0–100). Never a live-verified metric. */
  confidence?: number;
  /**
   * Always 'advisory_estimate'. Confidence scores are heuristic estimates
   * derived from the call outcome fields — they do not guarantee supplier
   * legitimacy or financial health.
   */
  confidenceNote?: 'advisory_estimate';
  /**
   * Set to true when the call outcome is ambiguous (reached_business === 'unclear'
   * or verdict === 'could_not_verify'). The orchestrator must present the result
   * to the user and obtain explicit intent before invoking any call tool again.
   */
  requiresReconciliation?: boolean;
  error?: boolean;
}

export interface CalleCallParams {
  phoneNumber: string;
  companyName: string;
  productCategory: string;
  claimedTerms: string;
  language?: string;
  region: string | 'IN' | 'INTERNATIONAL'; // 'IN' for India, 'INTERNATIONAL' for Nigeria/other
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns a log-safe representation of a phone number with all but the last
 * four digits replaced by asterisks, e.g. "+91987654****".
 */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);
}

const TASK_TEMPLATE = (p: CalleCallParams) =>
  `Call this supplier on behalf of a prospective buyer considering an order with ${p.companyName}. ` +
  `Confirm you've reached ${p.companyName}. Confirm they can supply ${p.productCategory}. ` +
  `Ask them to restate the price, minimum order quantity, and payment terms they quoted for this order — ` +
  `in particular, what share of payment they want in advance versus on dispatch. ` +
  `Do not share any personal or banking information on the buyer's behalf. ` +
  `Do not agree to any payment or place any order. ` +
  `If the line is not reachable, or not associated with this business, note that clearly. ` +
  `Conduct the call in ${p.language || 'English'}.`;

const RESULT_SCHEMA = {
  type: 'object',
  required: ['reached_business', 'verdict'],
  properties: {
    reached_business: { type: 'string', enum: ['yes', 'no', 'unclear'] },
    confirmed_business_name: { type: 'string' },
    product_match: { type: 'string', enum: ['matches', 'discrepancy', 'could_not_compare'] },
    stated_price_or_terms: { type: 'string' },
    advance_payment_requested: { type: 'string' },
    red_flags: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['verified_reachable', 'discrepancy_found', 'could_not_verify'] },
  },
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function placeVerificationCall(params: CalleCallParams): Promise<CalleResult> {
  try {
    const apiKey = process.env.CALLE_API_KEY;
    const baseUrlRaw = process.env.CALLE_BASE_URL;

    if (!apiKey || !baseUrlRaw) {
      throw new Error('Missing CALL-E environment variables (CALLE_API_KEY / CALLE_BASE_URL)');
    }

    const baseUrl = baseUrlRaw.replace(/\/$/, '');

    // Verify the base URL uses HTTPS so credentials are never sent over plain HTTP.
    if (!baseUrl.startsWith('https://')) {
      throw new Error('CALLE_BASE_URL must use HTTPS to protect credential transport');
    }

    // Restrict credentialed requests to approved HTTPS CALL-E origins.
    if (baseUrl !== 'https://api.call-e.com' && baseUrl !== 'https://api.heycall-e.com') {
      throw new Error('CALLE_BASE_URL must be an approved CALL-E origin');
    }

    // Log a masked summary — never log the raw phone number.
    console.info('[calle] placing verification call', {
      phone: maskPhone(params.phoneNumber),
      company: params.companyName,
      region: params.region,
    });

    // 1. Create the call
    // redirect: 'error' prevents the Bearer token from being forwarded if
    // the server issues a redirect (e.g. HTTP→HTTPS or domain change).
    const createRes = await fetch(`${baseUrl}/v1/calls`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task: `Call ${params.phoneNumber}. ` + TASK_TEMPLATE(params),
        result_schema: RESULT_SCHEMA,
      }),
    });

    if (!createRes.ok) {
      // Do not expose raw provider response text in the error message.
      throw new Error(`CALL-E returned HTTP ${createRes.status} when creating call`);
    }

    const createData = await createRes.json();
    const callId = createData.id;

    // 2. Wait for completion
    let callData = createData;
    while (
      callData.status !== 'completed' &&
      callData.status !== 'failed' &&
      callData.status !== 'canceled'
    ) {
      await new Promise(resolve => setTimeout(resolve, 3000));

      const getRes = await fetch(`${baseUrl}/v1/calls/${callId}`, {
        redirect: 'error',
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!getRes.ok) {
        // Do not expose raw provider response text in the error message.
        throw new Error(`CALL-E returned HTTP ${getRes.status} when polling call status`);
      }

      callData = await getRes.json();
    }

    if (!callData.structured_result) {
      throw new Error('CALL-E returned no structured result');
    }

    const structured = callData.structured_result as unknown as CalleResult;

    // Extract transcript from known backend schema locations.
    const transcript =
      callData.transcript ||
      callData.evidence?.[0]?.transcript ||
      callData.recipients?.[0]?.attempts?.[0]?.transcript ||
      undefined;

    // Mask phone numbers from transcript and red flags before returning
    const phoneRegex = new RegExp(params.phoneNumber.replace('+', '\\+'), 'g');
    const masked = maskPhone(params.phoneNumber);

    if (transcript && typeof transcript === 'string') {
      structured.transcript = transcript.replace(phoneRegex, masked);
    } else {
      structured.transcript = transcript;
    }

    if (structured.red_flags && Array.isArray(structured.red_flags)) {
      structured.red_flags = structured.red_flags.map(flag => flag.replace(phoneRegex, masked));
    }

    // Confidence is a heuristic estimate — label it accordingly.
    structured.confidence = deriveConfidence(structured);
    structured.confidenceNote = 'advisory_estimate';

    // Flag ambiguous outcomes so the orchestrator can require user reconciliation.
    if (
      structured.reached_business === 'unclear' ||
      structured.verdict === 'could_not_verify'
    ) {
      structured.requiresReconciliation = true;
    }

    return structured;

  } catch (err: unknown) {
    // Log only the error type and message — never log provider-internal details
    // such as validation payloads or raw response bodies, which may contain PII
    // or expose internal API behaviour.
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[calle] call failed:', message);

    return {
      reached_business: 'unclear',
      verdict: 'could_not_verify',
      confidence: 0,
      confidenceNote: 'advisory_estimate',
      requiresReconciliation: true,
      error: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Derives a heuristic confidence score from the call result fields.
 * These values are ADVISORY ESTIMATES only — they are not live-verified metrics
 * and do not guarantee supplier legitimacy or financial health.
 */
function deriveConfidence(result: CalleResult): number {
  if (result.verdict === 'verified_reachable' && result.reached_business === 'yes') return 92;
  if (result.verdict === 'discrepancy_found') return 75;
  if (result.reached_business === 'no') return 30;
  return 50;
}
