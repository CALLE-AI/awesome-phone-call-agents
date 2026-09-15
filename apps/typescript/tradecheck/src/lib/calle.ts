import { CalleClient } from "@call-e/calle";

export interface CalleResult {
  reached_business: 'yes' | 'no' | 'unclear';
  confirmed_business_name?: string;
  product_match?: 'matches' | 'discrepancy' | 'could_not_compare';
  stated_price_or_terms?: string;
  advance_payment_requested?: string;
  red_flags?: string[];
  verdict: 'verified_reachable' | 'discrepancy_found' | 'could_not_verify';
  transcript?: string | null;
  confidence?: number;
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

export async function placeVerificationCall(params: CalleCallParams): Promise<CalleResult> {
  try {
    if (!process.env.CALLE_API_KEY || !process.env.CALLE_BASE_URL) {
      throw new Error('Missing CALL-E environment variables');
    }

    const client = new CalleClient({
      apiKey: process.env.CALLE_API_KEY,
      baseUrl: process.env.CALLE_BASE_URL,
    });

    console.log(params)

    const apiKey = process.env.CALLE_API_KEY!;
    const baseUrl = process.env.CALLE_BASE_URL!.replace(/\/$/, '');

    // 1. Create the call
    const createRes = await fetch(`${baseUrl}/v1/calls`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        task: `Call ${params.phoneNumber}. ` + TASK_TEMPLATE(params),
        result_schema: RESULT_SCHEMA,
      })
    });
    if (!createRes.ok) {
      throw new Error(`Failed to create call: ${await createRes.text()}`);
    }
    const createData = await createRes.json();
    const callId = createData.id;

    // 2. Wait for completion
    let callData = createData;
    while (callData.status !== 'completed' && callData.status !== 'failed' && callData.status !== 'canceled') {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const getRes = await fetch(`${baseUrl}/v1/calls/${callId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!getRes.ok) {
        throw new Error(`Failed to get call status: ${await getRes.text()}`);
      }
      callData = await getRes.json();
    }

    if (!callData.structured_result) {
      throw new Error('CALL-E returned no structured result');
    }

    const structured = callData.structured_result as unknown as CalleResult;
    
    // Extract transcript from new backend schema locations
    const transcript = callData.transcript || 
                       callData.evidence?.[0]?.transcript || 
                       callData.recipients?.[0]?.attempts?.[0]?.transcript || 
                       undefined;
                       
    structured.transcript = transcript;
    // Derive a simple confidence score from verdict + reached_business
    structured.confidence = deriveConfidence(structured);
    return structured;

  } catch (err: any) {
    console.error('CALL-E error:', err);
    if (err.details) {
      console.error('CALL-E Validation Details:', JSON.stringify(err.details, null, 2));
    }
    return {
      reached_business: 'unclear',
      verdict: 'could_not_verify',
      confidence: 0,
      error: true,
    };
  }
}

function deriveConfidence(result: CalleResult): number {
  if (result.verdict === 'verified_reachable' && result.reached_business === 'yes') return 92;
  if (result.verdict === 'discrepancy_found') return 75;
  if (result.reached_business === 'no') return 30;
  return 50;
}
