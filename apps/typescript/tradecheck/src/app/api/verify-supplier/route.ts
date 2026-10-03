import { NextResponse } from 'next/server';
import { verifyGSTIN } from '@/lib/gstin';

export async function POST(req: Request) {
  try {
    const { gstin } = await req.json();
    if (!gstin) {
      return NextResponse.json({ error: 'GSTIN is required' }, { status: 400 });
    }

    const result = await verifyGSTIN(gstin);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Error verifying supplier:", error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
