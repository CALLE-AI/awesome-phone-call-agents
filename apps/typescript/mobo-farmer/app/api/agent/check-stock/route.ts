import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { calleClient, hasCalleKey } from '@/lib/calle';
import { inputStockSchema, marketPriceSchema, waterAllocationSchema } from '@/lib/agentSchemas';

const E164 = /^\+[1-9]\d{7,14}$/;
const SA_E164 = /^\+27\d{9}$/;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { taskType, userIntent, phone, mockMode, live, confirmLive } = body;

    const allowLiveEnv = process.env.ALLOW_LIVE_CALLS === 'true';
    const liveIntent = live === true && confirmLive === true && req.headers.get('x-live-intent') === 'true';
    const operatorApproved =!!process.env.OPERATOR_APPROVAL_TOKEN && req.headers.get('x-operator-approval') === process.env.OPERATOR_APPROVAL_TOKEN;

    const shouldUseMock = mockMode ||!hasCalleKey ||!allowLiveEnv ||!liveIntent ||!operatorApproved;

    if (shouldUseMock) {
      await new Promise(r => setTimeout(r, 1500));
      return NextResponse.json({
        mode: 'dry-run',
        live: false,
        query: { taskType, userIntent },
        summary: `Mock: Called about ${userIntent}. Supplier confirmed availability.`,
        status: 'completed',
        transcript: 'Mock transcript: Yes we have L33 in stock, R875 per bag, 60 bags available...',
        structured: { item_available: true, price_per_bag: 875, stock_quantity: 60, next_delivery_date: '2026-09-20' },
        note: 'Synthetic fixture. Live requires ALLOW_LIVE_CALLS=true + body {live:true, confirmLive:true} + headers x-live-intent:true + x-operator-approval:TOKEN + destination in ALLOWED_E164'
      });
    }

    if (!phone ||!E164.test(phone) ||!SA_E164.test(phone)) {
      return NextResponse.json({ error: 'Invalid E.164. Must be +27XXXXXXXXX', status: 'unknown', message: 'manual-reconciliation required' }, { status: 400 });
    }
    const allowList = (process.env.ALLOWED_E164 || '').split(',').map(s=>s.trim()).filter(Boolean);
    if (!allowList.includes(phone)) {
      return NextResponse.json({ error: 'Destination is not authorized in ALLOWED_E164', status: 'unknown' }, { status: 403 });
    }

    let basePrompt = '';
    let resultSchema: any = null;
    switch (taskType) {
      case 'Find Buyer':
        basePrompt = `You are MoboFarmer assistant calling a market or buyer on behalf of a farmer in South Africa. Farmer's request: "${userIntent}" Ask what produce grades they accept, price per kg, farm pickups, payment terms.`;
        resultSchema = marketPriceSchema; break;
      case 'Check Water Allocation':
      case 'Schedule Service':
        basePrompt = `You are MoboFarmer assistant calling the Water Association/Municipality on behalf of a farmer. Request: "${userIntent}" Ask about allocation liters, ration days, confirm service time/cost.`;
        resultSchema = waterAllocationSchema; break;
      default:
        basePrompt = `You are MoboFarmer assistant calling a supplier on behalf of a farmer. Request: "${userIntent}" Ask follow-ups. Pronounce L33 as "L thirty-three".`;
        resultSchema = inputStockSchema; break;
    }

    const fullPrompt = `${basePrompt}\nTask Type: ${taskType}\nHave natural conversation. At END give verbal summary: "Just to summarize: I called about [X], you said [Y], next step is [Z]. Is that correct?" Keep under 90s. Language: English.`;

    const call = await calleClient.calls.create({
      task: fullPrompt,
      resultSchema,
      recipients: [{ phones: [phone], region: 'US', locale: 'en-US' }],
      metadata: { taskType, userIntent }
    });

    return NextResponse.json({ callId: call.id, live: true, mode: 'live' });

  } catch (error: any) {
    if (error?.code === 'call_not_ready') {
      return NextResponse.json({ status: 'unknown', message: 'manual-reconciliation required', error: error.details?.questions?.[0] }, { status: 200 });
    }
    return NextResponse.json({ status: 'unknown', message: 'manual-reconciliation required', error: error?.message || 'Unknown error' }, { status: 200 });
  }
}
