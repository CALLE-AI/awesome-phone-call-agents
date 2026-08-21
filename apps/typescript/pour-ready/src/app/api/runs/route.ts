import { NextResponse } from 'next/server';
import { dispatchLiveRun, getCalleClient } from '@/lib/calle-server';
import { InputError, validateLiveRunInput } from '@/lib/validation';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    if (process.env.ENABLE_LIVE_CALLS !== 'true') {
      return NextResponse.json(
        { error: 'Live calls are disabled in this environment.' },
        { status: 403 },
      );
    }

    const input = validateLiveRunInput(await request.json());
    const client = getCalleClient();
    const calls = await dispatchLiveRun(input, (payload, options) =>
      client.calls.create(payload, options),
    );
    const partialFailure = calls.some((call) => call.status === 'failed');

    return NextResponse.json(
      { runId: input.runId, calls, partialFailure },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof InputError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: error instanceof InputError ? error.message : 'Invalid JSON body.' },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: 'CALL-E could not start this run. No automatic retry was made.' },
      { status: 502 },
    );
  }
}
