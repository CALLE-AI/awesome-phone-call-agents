import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { loadCatalogue } from "@/lib/catalogue";

/**
 * The list a person can choose from when Arc's list is not the answer.
 *
 * The Select step used to show only what the model picked. When the model
 * picked nothing - which it may legitimately do, and did - the tab rendered an
 * empty div and the Continue button stayed disabled, because it requires a
 * ticked line in every channel the brief asked for. Blank screen, no
 * explanation, no way forward.
 *
 * Arc proposes; the buyer decides. That needs the whole catalogue reachable
 * from the wizard, not just the slice one generation happened to return.
 *
 * Facts only. Every row here carries what the Contact table holds - city,
 * frequency, audience, rate estimate - and NONE of the three fields that are
 * the model's judgement: match score and rationale. A row added by hand was
 * not scored by anything, and the screen says so rather than showing a number.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const cat = await loadCatalogue();

  /* Substring over the fields a person would actually type: the name, the
     city, and for creators the handle. Not fuzzy - a directory of sixty rows
     does not need ranking, and a match the user cannot explain is worse than
     no match. */
  const hit = (...fields: (string | null)[]) =>
    !q || fields.some((f) => f && f.toLowerCase().includes(q));

  return NextResponse.json({
    stations: cat.stations.filter((s) => hit(s.stationName, s.city, s.frequency)),
    creators: cat.creators.filter((c) => hit(c.displayName, c.username, c.city, c.niche)),
  });
}
