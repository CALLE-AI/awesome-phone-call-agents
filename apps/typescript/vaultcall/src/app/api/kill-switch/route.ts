import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function GET() {
  return NextResponse.json({ engaged: store.getKillSwitch() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const engaged = Boolean(body.engaged);
    store.setKillSwitch(engaged);
    return NextResponse.json({
      success: true,
      engaged: store.getKillSwitch(),
      message: engaged
        ? 'EMERGENCY KILL SWITCH ENGAGED: Outbound dialing halted.'
        : 'Emergency Kill Switch disengaged. Outbound dialing normal.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
