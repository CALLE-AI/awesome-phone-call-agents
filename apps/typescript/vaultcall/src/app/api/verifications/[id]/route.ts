import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { sanitizeRecordForDisplay, isAuthorizedSecret } from '@/lib/phone-utils';

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

  // A record is strictly synthetic ONLY if its isSynthetic flag is true.
  // Live runs reusing seeded IDs or non-synthetic records are private records.
  const isSynthetic = record.isSynthetic === true;

  // Actual private records strictly require authentication.
  // Remotely spoofable Host or proxy headers cannot grant access to private records.
  if (!isSynthetic && !isAuth) {
    return NextResponse.json(
      { error: 'Unauthorized: Access to private verification records requires authentication.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="VaultCall"' } }
    );
  }

  return NextResponse.json({
    record: sanitizeRecordForDisplay(record),
  });
}

