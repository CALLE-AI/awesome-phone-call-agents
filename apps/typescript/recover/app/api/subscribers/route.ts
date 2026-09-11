import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { subscribersTable } from "@/lib/db";

export async function GET() {
  return NextResponse.json(subscribersTable.all());
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body.name || !body.phone || !body.email || !body.planName || !body.amountCents) {
    return NextResponse.json(
      { error: "name, phone, email, planName, and amountCents are required" },
      { status: 400 }
    );
  }

  const subscriber = {
    id: randomUUID(),
    name: body.name,
    phone: body.phone,
    region: body.region ?? "US",
    locale: body.locale ?? "en-US",
    email: body.email,
    plan_name: body.planName,
    amount_cents: body.amountCents,
    stripe_customer_id: null,
    status: "active",
    followups_paused: 0,
    created_at: new Date().toISOString(),
  };

  subscribersTable.insert(subscriber);
  return NextResponse.json(subscriber, { status: 201 });
}