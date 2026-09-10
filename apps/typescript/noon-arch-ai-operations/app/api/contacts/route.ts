import { NextResponse } from "next/server";
import { getD1 } from "../../../db/d1";

export async function GET() {
  const result = await getD1().prepare("SELECT id, name, company, phone FROM contacts ORDER BY id DESC").all();
  return NextResponse.json({ contacts: result.results });
}

export async function POST(request: Request) {
  const body = await request.json() as { name?: string; company?: string; phone?: string };
  const company = body.company?.trim() || "";
  const phone = body.phone?.replace(/\s/g, "") || "";
  if (!body.name?.trim() || !/^\+[1-9]\d{7,14}$/.test(phone)) return NextResponse.json({ error: "أدخل اسم المستلم ورقم هاتف صحيحاً بصيغة E.164 تبدأ بعلامة + ورمز الدولة." }, { status: 400 });
  const db = getD1();
  const existing = await db.prepare("SELECT id, name, company, phone FROM contacts WHERE phone = ?").bind(phone).first();
  if (existing) return NextResponse.json({ error: "هذا الرقم محفوظ مسبقاً. يمكنك تعديل جهة الاتصال الموجودة.", existing }, { status: 409 });
  try {
    const saved = await db.prepare("INSERT INTO contacts (name, company, phone, created_at) VALUES (?, ?, ?, ?) RETURNING id, name, company, phone").bind(body.name.trim(), company, phone, new Date().toISOString()).first();
    return NextResponse.json({ contact: saved }, { status: 201 });
  } catch {
    const duplicate = await db.prepare("SELECT id, name, company, phone FROM contacts WHERE phone = ?").bind(phone).first();
    if (duplicate) return NextResponse.json({ error: "هذا الرقم محفوظ مسبقاً. يمكنك تعديل جهة الاتصال الموجودة.", existing: duplicate }, { status: 409 });
    return NextResponse.json({ error: "تعذر حفظ جهة الاتصال." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const body = await request.json() as { id?: number; name?: string; company?: string; phone?: string };
  const id = Number(body.id);
  const company = body.company?.trim() || "";
  const phone = body.phone?.replace(/\s/g, "") || "";
  if (!Number.isInteger(id) || id < 1 || !body.name?.trim() || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    return NextResponse.json({ error: "أدخل اسم المستلم ورقم هاتف صحيحاً بصيغة E.164 تبدأ بعلامة + ورمز الدولة." }, { status: 400 });
  }

  const db = getD1();
  const duplicate = await db.prepare("SELECT id, name, company, phone FROM contacts WHERE phone = ? AND id <> ?").bind(phone, id).first();
  if (duplicate) return NextResponse.json({ error: "هذا الرقم مستخدم لجهة اتصال أخرى.", existing: duplicate }, { status: 409 });

  try {
    const updated = await db.prepare("UPDATE contacts SET name = ?, company = ?, phone = ? WHERE id = ? RETURNING id, name, company, phone").bind(body.name.trim(), company, phone, id).first();
    if (!updated) return NextResponse.json({ error: "جهة الاتصال غير موجودة." }, { status: 404 });
    return NextResponse.json({ contact: updated });
  } catch {
    return NextResponse.json({ error: "تعذر تحديث جهة الاتصال." }, { status: 500 });
  }
}
