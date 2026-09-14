import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { loadCatalogue } from "@/lib/catalogue";
import { generatePlan } from "@/lib/plan-generate";

/* Hobby's ceiling. The generation is two calls that run at the same time, so
   it fits inside this with room to spare - which is half the reason it was
   split. See lib/plan-generate.ts for the other half. */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { brief, pin } = await req.json();

    const cat = await loadCatalogue();
    if (!cat.stations.length && !cat.creators.length) {
      return NextResponse.json(
        {
          error:
            "No contacts are available to plan with. Seed the Contact table " +
            "(scripts/seed-contacts.ts) and give at least one contact a number.",
        },
        { status: 503 }
      );
    }

    /* A line carried in from a directory. Validated against the catalogue
       inside generatePlan; an id we do not carry is dropped in silence,
       because a stale link is not worth an error message. */
    const result = await generatePlan(brief, cat, typeof pin === "string" ? pin : null);

    if (!result.plan) {
      return NextResponse.json(
        {
          error:
            result.failed === "media"
              ? "The plan came back recommending stations we do not carry, twice. " +
                "Nothing was saved. Please try again."
              : "The scripts came back in a form we could not read. Nothing was saved. " +
                "Please try again.",
          problems: result.problems,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ...result.plan,
      source: result.source,
      /* Only meaningful for the sample path, and only as an explanation. */
      sampleReason: result.sampleReason,
      generationTimeMs: result.generationTimeMs,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Campaign generation error:", message, err);
    return NextResponse.json(
      { error: message || "Generation failed. Please try again." },
      { status: 500 }
    );
  }
}
