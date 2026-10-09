import { NextResponse } from "next/server";
import { z } from "zod";
import { aiProvider, chatJson } from "@/lib/ai";
import { statedBloodGroups } from "@/lib/intake";

const SYSTEM = `You convert a caregiver's message into a JSON search request for PharmaBridge, which phones pharmacies (for a medication) or blood banks (for blood).
Return only a JSON object with exactly these keys:
{"kind":"pharmacy" or "blood_bank","drugQuery":string,"quantity":string,"bloodGroup":"A+"|"A-"|"B+"|"B-"|"AB+"|"AB-"|"O+"|"O-"|"","component":"whole_blood"|"packed_red_cells"|"platelets"|"fresh_frozen_plasma"|"cryoprecipitate"|"","units":number,"hospital":string,"location":string,"urgency":"today"|"48h"|"week"}
Rules:
- Copy facts only from the message. Use "" or 0 when a value is not stated.
- drugQuery is the drug name, strength, and form exactly as written. Never invent, correct, or convert a strength.
- bloodGroup must appear in the message. Never infer or guess it.
- For blood with no component named, use "packed_red_cells".
- location is the city, area, or address to search near. hospital is where the patient is admitted.
- urgency is "today" unless the message says otherwise.
- Never add medical advice or any text outside the JSON.`;

const intakeSchema = z.object({
  kind: z.enum(["pharmacy", "blood_bank"]).catch("pharmacy"),
  drugQuery: z.string().max(160).catch(""),
  quantity: z.string().max(60).catch(""),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", ""]).catch(""),
  component: z.enum(["whole_blood", "packed_red_cells", "platelets", "fresh_frozen_plasma", "cryoprecipitate", ""]).catch(""),
  units: z.coerce.number().int().min(0).max(20).catch(0),
  hospital: z.string().max(120).catch(""),
  location: z.string().max(160).catch(""),
  urgency: z.enum(["today", "48h", "week"]).catch("today"),
});

export async function POST(request: Request) {
  if (!aiProvider()) return NextResponse.json({ error: { code: "ai_disabled", message: "No AI provider key is configured." } }, { status: 404 });
  const body = z.object({ text: z.string().trim().min(4).max(600) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: { code: "invalid_request", message: "Describe what you need in a sentence." } }, { status: 400 });

  try {
    const { data, provider } = await chatJson(SYSTEM, body.data.text);
    const intake = intakeSchema.parse(data ?? {});
    // The group must be stated by the caregiver; drop anything the model produced that isn't in the text.
    if (intake.bloodGroup && !statedBloodGroups(body.data.text).includes(intake.bloodGroup)) intake.bloodGroup = "";
    return NextResponse.json({ intake, provider });
  } catch (error) {
    return NextResponse.json({ error: { code: "ai_failed", message: error instanceof Error ? error.message : "AI intake failed." } }, { status: 502 });
  }
}
