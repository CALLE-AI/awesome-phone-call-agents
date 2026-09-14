import { NextRequest, NextResponse } from 'next/server';
import { calleClient } from '@/lib/calle';

export async function POST(req: NextRequest) {
  try {
    const { phone, employeeName = 'Alex', role = 'Bartender' } = await req.json();

    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    if (!calleClient.isConfigured()) {
      return NextResponse.json({ error: 'CALL_E_API_KEY is not configured on server' }, { status: 500 });
    }

    const idempotencyKey = `test_call_${Date.now()}`;
    const result = await calleClient.createCall({
      idempotencyKey,
      phone,
      employeeName,
      businessName: 'The Copper Bistro',
      role,
      shiftDate: 'Tonight',
      startTime: '6:00 PM',
      endTime: '11:00 PM',
      location: 'Main Branch'
    });

    return NextResponse.json({
      success: true,
      callId: result.callId,
      initialStatus: result.initialStatus,
      message: `Outbound call to ${phone} successfully dispatched through CALL-E!`
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
