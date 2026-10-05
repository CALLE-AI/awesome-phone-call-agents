import { NextResponse } from 'next/server';
import { dispatchVerificationCall } from '@/lib/calle-runner';
import {
  isValidAsciiE164,
  isAuthorizedLiveRecipient,
  maskPhoneNumbersInText,
  sanitizeRecordForDisplay,
  isAuthorizedSecret,
} from '@/lib/phone-utils';
import { store } from '@/lib/store';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const existing = store.getVerification(params.id);
    if (!existing) {
      return NextResponse.json({ error: `Verification record "${params.id}" not found.` }, { status: 404 });
    }

    if (body.useLiveCalle) {
      if (!isAuthorizedSecret(req)) {
        return NextResponse.json(
          { error: 'Unauthorized: Live carrier dispatch requires configured VAULTCALL_DISPATCH_SECRET and valid authorization credentials.' },
          { status: 401 }
        );
      }

      const targetPhone = (body.targetPhoneOverride || existing.vendor.verifiedPbxPhone || '').trim();
      if (!isValidAsciiE164(targetPhone)) {
        return NextResponse.json(
          { error: 'Recipient phone number must strictly be formatted as an ASCII E.164 string (+ followed by 7-15 digits).' },
          { status: 400 }
        );
      }

      const authCheck = isAuthorizedLiveRecipient(targetPhone, [existing.vendor.verifiedPbxPhone]);
      if (!authCheck.authorized) {
        return NextResponse.json(
          { error: authCheck.reason || 'Recipient phone number is not on the authorized destination allowlist.' },
          { status: 403 }
        );
      }
    }

    const record = await dispatchVerificationCall(params.id, {
      simulationScenario: body.simulationScenario,
      useLiveCalle: body.useLiveCalle,
      apiKeyOverride: body.apiKeyOverride,
      targetPhoneOverride: body.targetPhoneOverride,
      officerNameOverride: body.officerNameOverride,
    });

    return NextResponse.json({
      success: true,
      record: sanitizeRecordForDisplay(record),
    });
  } catch (err: any) {
    const maskedError = maskPhoneNumbersInText(err.message || 'Verification dispatch failed.');
    return NextResponse.json({ error: maskedError }, { status: 400 });
  }
}
