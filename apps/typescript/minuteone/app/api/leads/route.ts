import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { leads } from "@/lib/db/schema";
import { leadIntakeSchema } from "@/lib/lead/schema";

/**
 * Lead intake webhook. The hosted demo form (app/page.tsx) posts here, and this is the same
 * shape an external form/CRM webhook would send. Consent is enforced at this boundary — no
 * consent, no row, no call, ever.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = leadIntakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await db.insert(leads).values({
    id,
    name: parsed.data.name,
    phone: parsed.data.phone,
    email: parsed.data.email,
    notes: parsed.data.notes,
    source: parsed.data.source,
    consent: parsed.data.consent,
  });

  return NextResponse.json({ id, status: "pending" }, { status: 201 });
}
