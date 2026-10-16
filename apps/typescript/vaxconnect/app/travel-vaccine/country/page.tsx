"use client";

import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { useFlow } from "@/context/flow-context";

const COUNTRIES = [
    { code: "TH", name: "Thailand", flag: "🇹🇭" },
    { code: "VN", name: "Vietnam", flag: "🇻🇳" },
    { code: "PH", name: "Philippines", flag: "🇵🇭" },
    { code: "KE", name: "Kenya", flag: "🇰🇪" },
    { code: "ZA", name: "South Africa", flag: "🇿🇦" },
];

export default function TravelCountry() {
    const { travel, setTravel } = useFlow();
    const router = useRouter();

    return (
        <AppShell>
            <p className="text-xs text-ink/40 mb-2">
                Travel Vaccine · Step 1 of 3
            </p>

            <h1 className="font-display text-2xl text-ink mb-6">
                Where are you travelling?
            </h1>

            <div className="border border-line bg-white/40 rounded-md max-w-sm mb-6">
                <select
                    value={travel.country}
                    onChange={(e) => setTravel({ country: e.target.value })}
                    className="w-full bg-transparent px-4 py-3 text-sm outline-none"
                >
                    <option value="">Select Country</option>

                    {COUNTRIES.map((country) => (
                        <option key={country.code} value={country.name}>
                            {country.flag} {country.name}
                        </option>
                    ))}
                </select>
            </div>

            <button
                disabled={!travel.country}
                onClick={() => router.push("/travel-vaccine/info")}
                className="bg-teal text-paper rounded-md px-5 py-2.5 text-sm font-medium hover:bg-teal-dark disabled:opacity-40 disabled:cursor-not-allowed"
            >
                Continue →
            </button>
        </AppShell>
    );
}