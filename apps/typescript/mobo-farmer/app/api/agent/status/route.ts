import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { calleClient, hasCalleKey } from '@/lib/calle';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const callId = searchParams.get('callId');
    if (!callId) return NextResponse.json({ error: 'No callId provided' }, { status: 400 });

    const allowLiveEnv = process.env.ALLOW_LIVE_CALLS === 'true';
    const isDemoId = callId.startsWith('demo-') || callId.startsWith('mock');

    if (!hasCalleKey ||!allowLiveEnv || isDemoId) {
      if (isDemoId) {
        return NextResponse.json({ status: 'completed', summary: 'Mock completed (synthetic)', structured: {}, transcript: 'Mock transcript turn', mode: 'dry-run' });
      }
      return NextResponse.json({ error: 'callId not found or not owned — synthetic-only mode', status: 'unknown' }, { status: 404 });
    }

    const operatorApproved =!!process.env.OPERATOR_APPROVAL_TOKEN && req.headers.get('x-operator-approval') === process.env.OPERATOR_APPROVAL_TOKEN;
    if (!operatorApproved) {
      return NextResponse.json({ error: 'Operator approval required to fetch live results' }, { status: 403 });
    }

    const call = await calleClient.calls.get(callId);
    let transcript = null;
    if (call.recipients?.[0]?.attempts?.length > 0) {
      const attempt = call.recipients[0].attempts[0] as any;
      transcript = attempt.transcript_turns || attempt.transcriptTurns || call.evidence;
    } else {
      transcript = call.evidence;
    }

    return NextResponse.json({
      status: call.status,
      summary: call.summary,
      structured: call.structuredResult || {},
      transcript,
      error: call.failureMessage,
      mode: 'live'
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message, status: 'unknown' }, { status: 500 });
  }
}
