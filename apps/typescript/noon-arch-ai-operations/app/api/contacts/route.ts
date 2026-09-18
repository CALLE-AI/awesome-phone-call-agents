import { NextResponse } from "next/server";
import { getD1 } from "../../../db/d1";
import { operatorAuthResponse } from "../../../lib/integrations/owner";

export async function GET() {
  const unauthorized = await operatorAuthResponse();
  if (unauthorized) return unauthorized;
  const result = await getD1().prepare("SELECT id, name, company, phone FROM contacts ORDER BY id DESC").all();
  return NextResponse.json({ contacts: result.results });
}

export async function POST(request: Request) {
  const unauthorized = await operatorAuthResponse();
  if (unauthorized) return unauthorized;
  const body = await request.json() as { name?: string; company?: string; phone?: string };
  const company = body.company?.trim() || "";
  const phone = body.phone?.replace(/\s/g, "") || "";
  if (!body.name?.trim() || !/^\+[1-9]\d{7,14}$/.test(phone)) return NextResponse.json({ error: "Enter a recipient name and a valid E.164 phone number with country code." }, { status: 400 });
  const db = getD1();
  const existing = await db.prepare("SELECT id, name, company, phone FROM contacts WHERE phone = ?").bind(phone).first();
  if (existing) return NextResponse.json({ error: "This number is already saved. Edit the existing contact instead.", existing }, { status: 409 });
  try {
    const saved = await db.prepare("INSERT INTO contacts (name, company, phone, created_at) VALUES (?, ?, ?, ?) RETURNING id, name, company, phone").bind(body.name.trim(), company, phone, new Date().toISOString()).first();
    return NextResponse.json({ contact: saved }, { status: 201 });
  } catch {
    const duplicate = await db.prepare("SELECT id, name, company, phone FROM contacts WHERE phone = ?").bind(phone).first();
    if (duplicate) return NextResponse.json({ error: "This number is already saved. Edit the existing contact instead.", existing: duplicate }, { status: 409 });
    return NextResponse.json({ error: "The contact could not be saved." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const unauthorized = await operatorAuthResponse();
  if (unauthorized) return unauthorized;
  const body = await request.json() as { id?: number; name?: string; company?: string; phone?: string };
  const id = Number(body.id);
  const company = body.company?.trim() || "";
  const phone = body.phone?.replace(/\s/g, "") || "";
  if (!Number.isInteger(id) || id < 1 || !body.name?.trim() || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    return NextResponse.json({ error: "Enter a recipient name and a valid E.164 phone number with country code." }, { status: 400 });
  }

  const db = getD1();
  const duplicate = await db.prepare("SELECT id, name, company, phone FROM contacts WHERE phone = ? AND id <> ?").bind(phone, id).first();
  if (duplicate) return NextResponse.json({ error: "This number belongs to another contact.", existing: duplicate }, { status: 409 });

  try {
    const updated = await db.prepare("UPDATE contacts SET name = ?, company = ?, phone = ? WHERE id = ? RETURNING id, name, company, phone").bind(body.name.trim(), company, phone, id).first();
    if (!updated) return NextResponse.json({ error: "The contact was not found." }, { status: 404 });
    return NextResponse.json({ contact: updated });
  } catch {
    return NextResponse.json({ error: "The contact could not be updated." }, { status: 500 });
  }
}
