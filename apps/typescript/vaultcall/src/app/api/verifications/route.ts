import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function GET() {
  const verifications = store.listVerifications();
  const killSwitch = store.getKillSwitch();

  const stats = {
    totalExposureUsd: verifications.reduce((acc, v) => acc + v.request.totalExposureAmountUsd, 0),
    fraudInterceptedUsd: verifications
      .filter((v) => v.status === 'FRAUD_INTERCEPTED')
      .reduce((acc, v) => acc + v.request.totalExposureAmountUsd, 0),
    confirmedValidCount: verifications.filter((v) => v.status === 'CONFIRMED_VALID').length,
    fraudInterceptedCount: verifications.filter((v) => v.status === 'FRAUD_INTERCEPTED').length,
    heldForReviewCount: verifications.filter((v) => v.status === 'GATEKEEPER_HOLD').length,
    inProgressCount: verifications.filter((v) => v.status === 'IN_PROGRESS').length,
  };

  return NextResponse.json({
    verifications,
    stats,
    killSwitch,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.action === 'reset_seed') {
      store.seed();
      return NextResponse.json({ success: true, message: 'Database reset to benchmark fixtures.' });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
