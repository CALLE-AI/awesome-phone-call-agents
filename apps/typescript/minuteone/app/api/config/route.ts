import { NextResponse } from "next/server";
import { businessConfigSchema } from "@/lib/config/schema";
import { saveBusinessConfig } from "@/lib/config/load";

/** Single-tenant: no auth, no ownership check — there's only ever one business config. */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = businessConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await saveBusinessConfig(parsed.data);
  return NextResponse.json({ ok: true });
}
