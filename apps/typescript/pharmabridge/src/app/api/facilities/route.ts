import { NextResponse } from "next/server";
import { z } from "zod";
import { findFacilities, geocode, syntheticFacilities, type GeoPoint } from "@/lib/geo";

const querySchema = z.object({
  kind: z.enum(["pharmacy", "blood_bank"]).default("pharmacy"),
  q: z.string().trim().min(2).max(160),
  radiusKm: z.coerce.number().min(0.5).max(25).default(5),
  synthetic: z.enum(["0", "1"]).default("0"),
});

const FALLBACK_CENTER: GeoPoint = { lat: 40.6782, lon: -73.9442, label: "Brooklyn, NY", countryCode: "US" };

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Enter a city, address, or postal code." }, { status: 400 });
  const { kind, q, radiusKm, synthetic } = parsed.data;

  let center: GeoPoint | null = null;
  try {
    center = await geocode(q);
  } catch {
    if (synthetic !== "1") return NextResponse.json({ error: "Geocoding is unavailable right now." }, { status: 502 });
  }
  if (!center && synthetic === "1") center = FALLBACK_CENTER;
  if (!center) return NextResponse.json({ error: `Could not find "${q}".` }, { status: 404 });

  if (synthetic === "1") {
    return NextResponse.json({ kind, center, facilities: syntheticFacilities(kind, center), withoutPhone: 0, sources: ["synthetic"] });
  }

  try {
    const found = await findFacilities(kind, center, radiusKm);
    return NextResponse.json({ kind, center, ...found });
  } catch {
    return NextResponse.json({
      kind,
      center,
      facilities: syntheticFacilities(kind, center),
      withoutPhone: 0,
      sources: ["synthetic"],
      warning: "Map data was unreachable, so this list comes from the built-in directory.",
    });
  }
}
