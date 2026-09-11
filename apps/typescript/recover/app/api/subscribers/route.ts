import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { subscribersTable } from "@/lib/db";
import { validateApiAuth, validateStrictE164 } from "@/lib/auth";
import { maskPhone, maskEmail } from "@/lib/masking";

export async function GET(req: NextRequest) {
  if (!validateApiAuth(req)) {
    return NextResponse.json({ error: "Unauthorized: Invalid or missing API key" }, { status: 401 });
  }

  const all = subscribersTable.all();
  // Mask PII in API output
  const sanitized = all.map((sub) => ({
    ...sub,
    phone: maskPhone(sub.phone),
    email: maskEmail(sub.email),
  }));

  return NextResponse.json(sanitized);
}

export async function POST(req: NextRequest) {
  if (!validateApiAuth(req)) {
    return NextResponse.json({ error: "Unauthorized: Invalid or missing API key" }, { status: 401 });
  }

  let body: {
    name?: string;
    phone?: string;
    email?: string;
    planName?: string;
    amountCents?: number;
    region?: string;
    locale?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name || !body.phone || !body.email || !body.planName || !body.amountCents) {
    return NextResponse.json(
      { error: "name, phone, email, planName, and amountCents are required" },
      { status: 400 }
    );
  }

  // Strict ASCII E.164 enforcement
  const phoneValidation = validateStrictE164(body.phone);
  if (!phoneValidation.valid) {
    return NextResponse.json({ error: phoneValidation.error }, { status: 400 });
  }

  // Conflict Prevention: Halt ambiguous duplicate creates
  const existingSubscribers = subscribersTable.all();
  const duplicate = existingSubscribers.find(
    (s) => s.phone === phoneValidation.normalized || s.email.toLowerCase() === body.email?.toLowerCase().trim()
  );

  if (duplicate) {
    return NextResponse.json(
      {
        error: "Conflict: A subscriber with this phone number or email already exists.",
        duplicateId: duplicate.id,
      },
      { status: 409 }
    );
  }

  const subscriber = {
    id: randomUUID(),
    name: body.name.trim(),
    phone: phoneValidation.normalized!,
    region: body.region ?? "US",
    locale: body.locale ?? "en-US",
    email: body.email.trim(),
    plan_name: body.planName.trim(),
    amount_cents: Number(body.amountCents),
    stripe_customer_id: null,
    status: "active",
    followups_paused: 0,
    created_at: new Date().toISOString(),
  };

  subscribersTable.insert(subscriber);

  return NextResponse.json(
    {
      ...subscriber,
      phone: maskPhone(subscriber.phone),
      email: maskEmail(subscriber.email),
    },
    { status: 201 }
  );
}