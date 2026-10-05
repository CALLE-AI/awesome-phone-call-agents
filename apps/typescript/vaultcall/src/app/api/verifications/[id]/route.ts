import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { sanitizeRecordForDisplay, isAuthorizedSecret, isLocalRequest } from '@/lib/phone-utils';
import { SEEDED_RECORD_IDS } from '@/fixtures/seed-data';

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const record = store.getVerification(params.id);
  if (!record) {
    return NextResponse.json(
      { error: `Verification record "${params.id}" not found.` },
      { status: 404 }
    );
  }

  const isAuth = isAuthorizedSecret(req);
  const isLocal = isLocalRequest(req);

  // If remote and unauthenticated, reject
  if (!isAuth && !isLocal) {
    return NextResponse.json(
      { error: 'Unauthorized: Remote access to verification records requires authentication.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="VaultCall"' } }
    );
  }

  // If unauthenticated, access is restricted strictly to synthetic benchmark records
  const isSynthetic = record.isSynthetic || SEEDED_RECORD_IDS.has(record.id);
  if (!isAuth && !isSynthetic) {
    return NextResponse.json(
      { error: 'Unauthorized: Access to non-synthetic verification records requires authentication.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="VaultCall"' } }
    );
  }

  return NextResponse.json({
    record: sanitizeRecordForDisplay(record),
  });
}
