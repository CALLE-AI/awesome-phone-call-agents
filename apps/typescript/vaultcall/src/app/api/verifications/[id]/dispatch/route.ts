import { NextResponse } from 'next/server';
import { dispatchVerificationCall } from '@/lib/calle-runner';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const record = await dispatchVerificationCall(params.id, {
      simulationScenario: body.simulationScenario,
      useLiveCalle: body.useLiveCalle,
      apiKeyOverride: body.apiKeyOverride,
      targetPhoneOverride: body.targetPhoneOverride,
      officerNameOverride: body.officerNameOverride,
    });
    return NextResponse.json({ success: true, record });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
