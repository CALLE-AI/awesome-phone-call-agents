import { NextResponse } from "next/server";

export const revalidate = 3600;

// Live count of current openFDA drug-shortage listings, shown on the landing page.
export async function GET() {
  try {
    const res = await fetch('https://api.fda.gov/drug/shortages.json?search=status:%22Current%22&limit=1', {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { meta?: { last_updated?: string; results?: { total?: number } } };
    return NextResponse.json({ currentRecords: json.meta?.results?.total ?? null, lastUpdated: json.meta?.last_updated ?? null });
  } catch {
    return NextResponse.json({ currentRecords: null, lastUpdated: null });
  }
}
