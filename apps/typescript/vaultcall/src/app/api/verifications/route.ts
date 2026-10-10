import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { sanitizeRecordForDisplay, isAuthorizedSecret, isLocalRequest } from '@/lib/phone-utils';

export async function GET(req: Request) {
  const isAuth = isAuthorizedSecret(req);

  let rawVerifications = store.listVerifications();
  const killSwitch = store.getKillSwitch();

  // If unauthenticated, access is strictly scoped to genuine synthetic benchmark records.
  // Private/live records (isSynthetic !== true) are excluded, preventing leakage even if a live run reused a seeded ID.
  if (!isAuth) {
    rawVerifications = rawVerifications.filter((v) => v.isSynthetic === true);
  }

  const stats = {
    totalExposureUsd: rawVerifications.reduce((acc, v) => acc + v.request.totalExposureAmountUsd, 0),
    fraudInterceptedUsd: rawVerifications
      .filter((v) => v.status === 'FRAUD_INTERCEPTED')
      .reduce((acc, v) => acc + v.request.totalExposureAmountUsd, 0),
    confirmedValidCount: rawVerifications.filter((v) => v.status === 'CONFIRMED_VALID').length,
    fraudInterceptedCount: rawVerifications.filter((v) => v.status === 'FRAUD_INTERCEPTED').length,
    heldForReviewCount: rawVerifications.filter((v) => v.status === 'GATEKEEPER_HOLD').length,
    inProgressCount: rawVerifications.filter((v) => v.status === 'IN_PROGRESS').length,
  };

  const verifications = rawVerifications.map((v) => sanitizeRecordForDisplay(v));

  return NextResponse.json({
    verifications,
    stats,
    killSwitch,
  });
}

export async function POST(req: Request) {
  try {
    const isAuth = isAuthorizedSecret(req);
    const isLocal = isLocalRequest(req);

    if (!isAuth && !isLocal) {
      return NextResponse.json(
        { error: 'Unauthorized: Privileged mutation requires authentication.' },
        { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="VaultCall"' } }
      );
    }

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
