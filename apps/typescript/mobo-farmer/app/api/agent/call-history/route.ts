import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { mockCallHistory } from '@/lib/mockData';

// In-memory array initialized with some mock data for the MVP
let callHistory: any[] = [...mockCallHistory];

export async function GET() {
  return NextResponse.json({ calls: callHistory.slice(0, 10) });
}

export async function POST(req: Request) {
  try {
    const data = await req.json();
    const newCall = {
      id: Date.now().toString(),
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
      agentType: data.agentType || "Stock Check",
      contact: data.contact || "Unknown",
      result: data.result || "Completed",
      time: data.time || "N/A",
      cost: data.cost || "R0.00",
      transcript: data.transcript || "No transcript available",
      summary: data.summary || "",
      structured: data.structured || {}
    };
    
    callHistory = [newCall, ...callHistory];
    
    return NextResponse.json({ success: true, call: newCall });
  } catch (error) {
    return NextResponse.json({ error: "Failed to save call" }, { status: 400 });
  }
}
