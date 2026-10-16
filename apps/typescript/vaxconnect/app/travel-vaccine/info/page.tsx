"use client";

import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { useFlow } from "@/context/flow-context";

// Dummy content keyed by country — swap for a real data source / API later
const COUNTRY_INFO: Record<string, string> = {
    Thailand:
        "Hepatitis A and Typhoid are recommended for most travellers. Japanese Encephalitis is advised for longer stays or rural travel. Yellow Fever is only required if arriving from a country with risk of transmission.",

    Indonesia:
        "Hepatitis A, Typhoid, and Japanese Encephalitis are commonly recommended, particularly for rural or extended travel. Malaria prophylaxis may be advised depending on the region.",
};

export default function TravelInfo() {
    const { travel } = useFlow();
    const router = useRouter();

    const info =
        COUNTRY_INFO[travel.country] ??
        "General travel vaccines such as Hepatitis A, Typhoid, and routine boosters are commonly recommended. Check with a travel clinic for destination-specific guidance.";

    return (
        <AppShell>
            <p className="text-xs text-ink/40 mb-2">
                Travel Vaccine · Step 2 of 3
            </p>

            <h1 className="font-display text-2xl text-ink mb-4">
                Vaccination Information for{" "}
                {travel.country || "your destination"}
            </h1>

            <div className="border border-line bg-white/40 rounded-md p-6 text-sm leading-relaxed text-ink/75 mb-3">
                {info}
            </div>

            <div className="text-xs text-ink/50 mb-6">
                <span>Source: CDC Travelers' Health · </span>

                <a
                    href="https://wwwnc.cdc.gov/travel/destinations/list"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal underline underline-offset-2 hover:text-teal-dark"
                >
                    View official destination guidance →
                </a>
            </div>

            <button
                onClick={() => router.push("/travel-vaccine/select")}
                className="bg-teal text-paper rounded-md px-5 py-2.5 text-sm font-medium hover:bg-teal-dark"
            >
                Continue →
            </button>
        </AppShell>
    );
}