import { NextResponse } from 'next/server';
import { getCalleClient, sanitizeCall } from '@/lib/calle-server';

export const runtime = 'nodejs';

const CALL_ID = /^call_[a-zA-Z0-9_-]{4,100}$/;
const RUN_ID = /^[a-zA-Z0-9-]{8,64}$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ callId: string }> },
) {
  if (process.env.ENABLE_LIVE_CALLS !== 'true') {
    return NextResponse.json(
      { error: 'Live calls are disabled in this environment.' },
      { status: 403 },
    );
  }

  const { callId } = await context.params;
  const runId = new URL(request.url).searchParams.get('runId') ?? '';
  if (!CALL_ID.test(callId) || !RUN_ID.test(runId)) {
    return NextResponse.json(
      { error: 'A valid call id and run id are required.' },
      { status: 400 },
    );
  }

  try {
    const call = await getCalleClient().calls.get(callId);
    return NextResponse.json({ call: sanitizeCall(call, runId) });
  } catch {
    return NextResponse.json(
      { error: 'The call state could not be retrieved.' },
      { status: 404 },
    );
  }
}
