import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { calleClient } from '@/lib/calle';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const callId = searchParams.get('callId');
    if (!callId) return NextResponse.json({ error: "No callId provided" }, { status: 400 });

    const call = await calleClient.calls.get(callId);
    
    // Attempt to extract transcript from the latest attempt
    let transcript = null;
    if (call.recipients?.[0]?.attempts?.length > 0) {
      const attempt = call.recipients[0].attempts[0] as any;
      transcript = attempt.transcript_turns || attempt.transcriptTurns || call.evidence;
    } else {
      transcript = call.evidence;
    }
    
    return NextResponse.json({
      status: call.status,
      summary: call.summary || (call.status === 'completed' ? 'Live call completed.' : undefined),
      structured: call.structuredResult || {},
      transcript: transcript,
      error: call.failureMessage || call.failureCode,
      message: call.status
    });
  } catch (error: any) {
    console.error("Status poll error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
