import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Employee } from '@/types';

export async function GET() {
  return NextResponse.json({ staff: db.getStaff() });
}

export async function POST(req: NextRequest) {
  try {
    const employee: Employee = await req.json();
    if (!employee.id || !employee.name || !employee.phone || !employee.role) {
      return NextResponse.json({ error: 'Missing required employee fields' }, { status: 400 });
    }

    const saved = db.updateStaff(employee);
    return NextResponse.json({ success: true, employee: saved });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
