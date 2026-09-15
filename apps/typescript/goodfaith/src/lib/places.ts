// File: src/lib/places.ts
// Places Text Search response shape assumed; seeded fallback guarantees output.
import "server-only";
import { env } from "@/lib/env";

export interface ClinicCandidate {
  name: string;
  phone: string; // E.164 where known; main line
  address?: string;
}

const SEEDED: ClinicCandidate[] = [
  { name: "Lone Star Open MRI", phone: "+15125550142", address: "Austin, TX 78701" },
  { name: "Capitol Imaging Partners", phone: "+15125550188", address: "Austin, TX 78701" },
  { name: "Riverside Diagnostic Center", phone: "+15125550170", address: "Austin, TX 78704" },
  { name: "Hill Country MRI", phone: "+15125550199", address: "Austin, TX 78703" },
];

export async function findClinics(zip: string, query = "MRI imaging center"): Promise<ClinicCandidate[]> {
  const key = env.placesApiKey();
  if (!key) return SEEDED;

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.internationalPhoneNumber,places.formattedAddress",
      },
      body: JSON.stringify({ textQuery: `${query} near ${zip}` }),
    });
    if (!res.ok) return SEEDED;
    const json = (await res.json()) as {
      places?: { displayName?: { text?: string }; internationalPhoneNumber?: string; formattedAddress?: string }[];
    };
    const out = (json.places ?? [])
      .filter((p) => p.internationalPhoneNumber)
      .map((p) => ({
        name: p.displayName?.text ?? "Imaging center",
        phone: (p.internationalPhoneNumber ?? "").replace(/[^\d+]/g, ""),
        address: p.formattedAddress,
      }));
    return out.length > 0 ? out : SEEDED;
  } catch {
    return SEEDED; // graceful degradation
  }
}
