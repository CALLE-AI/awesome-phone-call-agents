"use client";

import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { useFlow } from "@/context/flow-context";

type TravelVaccine = {
    name: string;
    recommendation: string;
    icon: string;
};

const COUNTRY_VACCINES: Record<string, TravelVaccine[]> = {
    Thailand: [
        {
            name: "Hepatitis A",
            recommendation: "Recommended for unvaccinated travelers",
            icon: "🛡️",
        },
        {
            name: "Hepatitis B",
            recommendation: "Recommended for many unvaccinated travelers",
            icon: "💉",
        },
        {
            name: "Typhoid",
            recommendation: "Recommended for most travelers",
            icon: "🦠",
        },
        {
            name: "Japanese Encephalitis",
            recommendation: "Consider for longer stays or rural/outdoor travel",
            icon: "🦟",
        },
        {
            name: "Rabies",
            recommendation: "Consider with animal exposure or limited access to care",
            icon: "🐕",
        },
    ],

    Vietnam: [
        {
            name: "Hepatitis A",
            recommendation: "Recommended for unvaccinated travelers",
            icon: "🛡️",
        },
        {
            name: "Hepatitis B",
            recommendation: "Recommended for many unvaccinated travelers",
            icon: "💉",
        },
        {
            name: "Typhoid",
            recommendation: "Recommended for most travelers",
            icon: "🦠",
        },
        {
            name: "Japanese Encephalitis",
            recommendation: "Consider for longer stays or rural/outdoor travel",
            icon: "🦟",
        },
        {
            name: "Rabies",
            recommendation: "Consider with animal exposure or limited access to care",
            icon: "🐕",
        },
    ],

    Philippines: [
        {
            name: "Hepatitis A",
            recommendation: "Recommended for unvaccinated travelers",
            icon: "🛡️",
        },
        {
            name: "Hepatitis B",
            recommendation: "Recommended for many unvaccinated travelers",
            icon: "💉",
        },
        {
            name: "Typhoid",
            recommendation: "Recommended for most travelers",
            icon: "🦠",
        },
        {
            name: "Japanese Encephalitis",
            recommendation: "Consider for longer stays or rural/outdoor travel",
            icon: "🦟",
        },
        {
            name: "Rabies",
            recommendation: "Consider with animal exposure or limited access to care",
            icon: "🐕",
        },
    ],

    Kenya: [
        {
            name: "Hepatitis A",
            recommendation: "Recommended for unvaccinated travelers",
            icon: "🛡️",
        },
        {
            name: "Hepatitis B",
            recommendation: "Recommended for many unvaccinated travelers",
            icon: "💉",
        },
        {
            name: "Typhoid",
            recommendation: "Recommended for most travelers",
            icon: "🦠",
        },
        {
            name: "Yellow Fever",
            recommendation: "Recommended for most travelers to Kenya",
            icon: "🟡",
        },
        {
            name: "Rabies",
            recommendation: "Consider with animal exposure or limited access to care",
            icon: "🐕",
        },
    ],

    "South Africa": [
        {
            name: "Hepatitis A",
            recommendation: "Recommended for unvaccinated travelers",
            icon: "🛡️",
        },
        {
            name: "Hepatitis B",
            recommendation: "Recommended for many unvaccinated travelers",
            icon: "💉",
        },
        {
            name: "Typhoid",
            recommendation: "Consider depending on itinerary and activities",
            icon: "🦠",
        },
        {
            name: "Rabies",
            recommendation: "Consider with animal exposure or limited access to care",
            icon: "🐕",
        },
        {
            name: "Yellow Fever",
            recommendation: "May be required depending on travel history",
            icon: "🟡",
        },
    ],
};

export default function TravelSelect() {
    const {
        travel,
        setTravel,
        setSelectedVaccine,
        setGeneralVaccine,
    } = useFlow();

    const router = useRouter();

    const vaccines =
        COUNTRY_VACCINES[travel.country] ?? [];

    const selectedVaccine =
        travel.vaccines[0] ?? "";

    const handleSelect = (vaccine: string) => {
        setTravel({
            vaccines: [vaccine],
        });

        setSelectedVaccine(vaccine);
        setGeneralVaccine(vaccine);
    };

    const handleAvailability = () => {
        if (!selectedVaccine) {
            return;
        }

        if (!/^\d{6}$/.test(travel.pinCode || "")) {
            return;
        }

        setSelectedVaccine(selectedVaccine);
        setGeneralVaccine(selectedVaccine);

        router.push("/availability");
    };

    return (
        <AppShell>
            <div
                className="max-w-3xl"
                style={{
                    textAlign: "left",
                }}
            >
                {/* HEADER */}

                <p className="text-xs text-teal font-medium tracking-wide mb-2">
                    VAXCONNECT · TRAVEL VACCINATION · STEP 3 OF 3
                </p>

                <h1 className="font-display text-3xl text-ink mb-2">
                    What vaccine do you want to check for your{" "}
                    {travel.country || "destination"} trip?
                </h1>

                <p className="text-sm text-ink/50 mb-7">
                    Travel vaccine recommendations based on your destination.
                </p>

                {/* VACCINES */}

                <div className="mb-7">
                    <div className="space-y-3">
                        {vaccines.map((vaccine) => {
                            const selected =
                                selectedVaccine === vaccine.name;

                            return (
                                <button
                                    key={vaccine.name}
                                    type="button"
                                    onClick={() =>
                                        handleSelect(vaccine.name)
                                    }
                                    style={{
                                        textAlign: "left",
                                    }}
                                    className={`
                                        w-full
                                        block
                                        rounded-xl
                                        border
                                        px-5
                                        py-4
                                        transition-all
                                        duration-150
                                        ${
                                        selected
                                            ? "border-teal bg-teal/5 shadow-sm"
                                            : "border-line bg-white/40 hover:border-teal/40 hover:bg-white/70"
                                    }
                                    `}
                                >
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns:
                                                "48px minmax(0, 1fr) 32px",
                                            alignItems: "center",
                                            columnGap: "16px",
                                            width: "100%",
                                            textAlign: "left",
                                        }}
                                    >
                                        {/* ICON */}

                                        <div
                                            style={{
                                                width: "44px",
                                                height: "44px",
                                                borderRadius: "9999px",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                background: selected
                                                    ? "rgba(45, 125, 111, 0.10)"
                                                    : "rgba(0, 0, 0, 0.035)",
                                                fontSize: "19px",
                                            }}
                                        >
                                            {vaccine.icon}
                                        </div>

                                        {/* NAME + RECOMMENDATION */}

                                        <div
                                            style={{
                                                minWidth: 0,
                                                textAlign: "left",
                                            }}
                                        >
                                            <p
                                                style={{
                                                    textAlign: "left",
                                                    margin: 0,
                                                    fontSize: "15px",
                                                    lineHeight: "20px",
                                                    fontWeight: 600,
                                                }}
                                                className={
                                                    selected
                                                        ? "text-teal"
                                                        : "text-ink"
                                                }
                                            >
                                                {vaccine.name}
                                            </p>

                                            <p
                                                style={{
                                                    textAlign: "left",
                                                    margin: "4px 0 0",
                                                    fontSize: "12px",
                                                    lineHeight: "17px",
                                                }}
                                                className="text-ink/45"
                                            >
                                                {vaccine.recommendation}
                                            </p>
                                        </div>

                                        {/* TICK */}

                                        <div
                                            style={{
                                                width: "26px",
                                                height: "26px",
                                                borderRadius: "9999px",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                border: selected
                                                    ? "1px solid #2d7d6f"
                                                    : "1px solid rgba(0,0,0,0.20)",
                                                background: selected
                                                    ? "#2d7d6f"
                                                    : "transparent",
                                            }}
                                        >
                                            {selected && (
                                                <svg
                                                    width="14"
                                                    height="14"
                                                    viewBox="0 0 20 20"
                                                    fill="none"
                                                    aria-hidden="true"
                                                >
                                                    <path
                                                        d="M4 10.5L8 14.5L16 6"
                                                        stroke="white"
                                                        strokeWidth="2.4"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                </svg>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* SELECTED VACCINE / PIN / CONTINUE */}

                {selectedVaccine && (
                    <div
                        className="border border-teal/20 bg-teal/5 rounded-xl px-6 py-5"
                        style={{
                            textAlign: "left",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "flex-end",
                                justifyContent: "space-between",
                                gap: "24px",
                            }}
                        >
                            <div
                                style={{
                                    textAlign: "left",
                                    flex: 1,
                                }}
                            >
                                <p className="text-[11px] text-teal font-medium uppercase tracking-wide mb-1">
                                    SELECTED VACCINE
                                </p>

                                <p className="font-display text-xl text-ink">
                                    {selectedVaccine}
                                </p>

                                <p className="text-xs text-ink/45 mt-1">
                                    Check nearby providers, pricing and
                                    appointment requirements.
                                </p>

                                {/* PIN CODE */}

                                <div className="mt-4">
                                    <label
                                        htmlFor="travel-pin"
                                        className="block text-[11px] text-teal font-medium uppercase tracking-wide mb-2"
                                    >
                                        PIN CODE
                                    </label>

                                    <input
                                        id="travel-pin"
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={6}
                                        placeholder="Enter 6-digit PIN"
                                        value={travel.pinCode || ""}
                                        onChange={(e) => {
                                            const value =
                                                e.target.value
                                                    .replace(/\D/g, "")
                                                    .slice(0, 6);

                                            setTravel({
                                                pinCode: value,
                                            });
                                        }}
                                        className="w-full max-w-[220px] border border-line bg-white/60 rounded-md px-3 py-2.5 text-sm text-ink outline-none focus:border-teal"
                                    />
                                </div>
                            </div>

                            <button
                                type="button"
                                disabled={
                                    !/^\d{6}$/.test(
                                        travel.pinCode || ""
                                    )
                                }
                                onClick={handleAvailability}
                                className="shrink-0 bg-teal text-white rounded-lg px-6 py-3 text-sm font-medium hover:bg-teal-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                Check Availability →
                            </button>
                        </div>
                    </div>
                )}

                {/* NOTE */}

                <p className="text-[11px] text-ink/35 leading-relaxed mt-6">
                    Travel vaccine recommendations can vary based on
                    itinerary, duration, activities, previous vaccinations,
                    and individual circumstances.
                </p>
            </div>
        </AppShell>
    );
}