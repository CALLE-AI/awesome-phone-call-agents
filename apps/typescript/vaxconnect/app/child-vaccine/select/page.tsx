"use client";

import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { useFlow } from "@/context/flow-context";

const VACCINES = [
    {
        name: "BCG",
        schedule: "At birth",
        icon: "🫁",
    },
    {
        name: "OPV",
        schedule: "Birth, 6, 10 & 14 weeks",
        icon: "💧",
    },
    {
        name: "DPT",
        schedule: "16–24 months & 5–6 years",
        icon: "💉",
    },
    {
        name: "Hepatitis B",
        schedule: "Birth dose within 24 hours",
        icon: "🛡️",
    },
    {
        name: "Measles",
        schedule: "9–12 months & 16–24 months",
        icon: "🦠",
    },
    {
        name: "Rotavirus",
        schedule: "6, 10 & 14 weeks",
        icon: "🧬",
    },
];

function getChildAge(dob: string) {
    if (!dob) {
        return "";
    }

    const birthDate = new Date(dob);
    const today = new Date();

    if (
        Number.isNaN(birthDate.getTime()) ||
        birthDate > today
    ) {
        return "";
    }

    let years =
        today.getFullYear() -
        birthDate.getFullYear();

    let months =
        today.getMonth() -
        birthDate.getMonth();

    let days =
        today.getDate() -
        birthDate.getDate();

    if (days < 0) {
        months -= 1;

        const previousMonth = new Date(
            today.getFullYear(),
            today.getMonth(),
            0
        );

        days += previousMonth.getDate();
    }

    if (months < 0) {
        years -= 1;
        months += 12;
    }

    if (years === 0 && months === 0) {
        const totalDays = Math.floor(
            (today.getTime() -
                birthDate.getTime()) /
            (1000 * 60 * 60 * 24)
        );

        const weeks = Math.floor(
            totalDays / 7
        );

        const remainingDays =
            totalDays % 7;

        if (weeks === 0) {
            return `${remainingDays} ${
                remainingDays === 1
                    ? "day"
                    : "days"
            } old`;
        }

        if (remainingDays === 0) {
            return `${weeks} ${
                weeks === 1
                    ? "week"
                    : "weeks"
            } old`;
        }

        return `${weeks} ${
            weeks === 1
                ? "week"
                : "weeks"
        } and ${remainingDays} ${
            remainingDays === 1
                ? "day"
                : "days"
        } old`;
    }

    const parts: string[] = [];

    if (years > 0) {
        parts.push(
            `${years} ${
                years === 1
                    ? "year"
                    : "years"
            }`
        );
    }

    if (months > 0) {
        parts.push(
            `${months} ${
                months === 1
                    ? "month"
                    : "months"
            }`
        );
    }

    if (
        years === 0 &&
        months === 0 &&
        days > 0
    ) {
        parts.push(
            `${days} ${
                days === 1
                    ? "day"
                    : "days"
            }`
        );
    }

    return `${parts.join(" and ")} old`;
}

export default function ChildSelect() {
    const router = useRouter();

    const {
        child,
        setChild,
        setSelectedVaccine,
        setGeneralVaccine,
    } = useFlow();

    const selectedVaccine =
        child.vaccines[0] || "";

    const childAge = getChildAge(
        child.dob
    );

    function selectVaccine(
        vaccine: string
    ) {
        setChild({
            vaccines: [vaccine],
        });

        setSelectedVaccine(vaccine);
        setGeneralVaccine(vaccine);
    }

    function handleAvailability() {
        if (!selectedVaccine) {
            return;
        }

        setSelectedVaccine(
            selectedVaccine
        );

        setGeneralVaccine(
            selectedVaccine
        );

        router.push("/availability");
    }

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
                    VAXCONNECT · CHILD VACCINATION · STEP 3 OF 3
                </p>

                <h1 className="font-display text-3xl text-ink mb-2">
                    Choose a vaccine
                </h1>

                <p className="text-sm text-ink/55 mb-7">
                    Select the vaccine you want to check
                    availability for.
                </p>

                {/* CHILD AGE */}

                <div
                    className="border border-teal/20 bg-teal/5 rounded-xl px-6 py-5 mb-8"
                    style={{
                        textAlign: "left",
                    }}
                >
                    <div className="flex items-center gap-4">

                        <div className="w-14 h-14 rounded-full bg-teal/10 flex items-center justify-center text-2xl shrink-0">
                            👶
                        </div>

                        <div
                            style={{
                                textAlign: "left",
                            }}
                        >
                            <p className="text-xs text-teal font-medium uppercase tracking-wide mb-1">
                                YOUR CHILD IS
                            </p>

                            <p className="font-display text-2xl text-teal">
                                {childAge ||
                                    "Age unavailable"}
                            </p>

                            <p className="text-xs text-ink/45 mt-1">
                                Based on the date of birth
                                you provided.
                            </p>
                        </div>

                    </div>
                </div>

                {/* VACCINES */}

                <div className="mb-7">

                    <h2 className="font-display text-xl text-ink mb-1">
                        Select one vaccine
                    </h2>

                    <p className="text-xs text-ink/45 mb-4">
                        Schedule shown according to
                        India's National Immunization
                        Schedule.
                    </p>

                    <div className="space-y-3">

                        {VACCINES.map(
                            (vaccine) => {
                                const selected =
                                    selectedVaccine ===
                                    vaccine.name;

                                return (
                                    <button
                                        key={
                                            vaccine.name
                                        }
                                        type="button"
                                        onClick={() =>
                                            selectVaccine(
                                                vaccine.name
                                            )
                                        }
                                        style={{
                                            textAlign:
                                                "left",
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
                                                display:
                                                    "grid",
                                                gridTemplateColumns:
                                                    "48px minmax(0, 1fr) 32px",
                                                alignItems:
                                                    "center",
                                                columnGap:
                                                    "16px",
                                                width: "100%",
                                                textAlign:
                                                    "left",
                                            }}
                                        >

                                            {/* ICON */}

                                            <div
                                                style={{
                                                    width:
                                                        "44px",
                                                    height:
                                                        "44px",
                                                    borderRadius:
                                                        "9999px",
                                                    display:
                                                        "flex",
                                                    alignItems:
                                                        "center",
                                                    justifyContent:
                                                        "center",
                                                    background:
                                                        selected
                                                            ? "rgba(45, 125, 111, 0.10)"
                                                            : "rgba(0, 0, 0, 0.035)",
                                                    fontSize:
                                                        "19px",
                                                }}
                                            >
                                                {
                                                    vaccine.icon
                                                }
                                            </div>

                                            {/* NAME + SCHEDULE */}

                                            <div
                                                style={{
                                                    minWidth:
                                                        0,
                                                    textAlign:
                                                        "left",
                                                }}
                                            >
                                                <p
                                                    style={{
                                                        textAlign:
                                                            "left",
                                                        margin:
                                                            0,
                                                        fontSize:
                                                            "15px",
                                                        lineHeight:
                                                            "20px",
                                                        fontWeight:
                                                            600,
                                                    }}
                                                    className={
                                                        selected
                                                            ? "text-teal"
                                                            : "text-ink"
                                                    }
                                                >
                                                    {
                                                        vaccine.name
                                                    }
                                                </p>

                                                <p
                                                    style={{
                                                        textAlign:
                                                            "left",
                                                        margin:
                                                            "4px 0 0",
                                                        fontSize:
                                                            "12px",
                                                        lineHeight:
                                                            "17px",
                                                    }}
                                                    className="text-ink/45"
                                                >
                                                    {
                                                        vaccine.schedule
                                                    }
                                                </p>
                                            </div>

                                            {/* TICK */}

                                            <div
                                                style={{
                                                    width:
                                                        "26px",
                                                    height:
                                                        "26px",
                                                    borderRadius:
                                                        "9999px",
                                                    display:
                                                        "flex",
                                                    alignItems:
                                                        "center",
                                                    justifyContent:
                                                        "center",
                                                    border:
                                                        selected
                                                            ? "1px solid #2d7d6f"
                                                            : "1px solid rgba(0,0,0,0.20)",
                                                    background:
                                                        selected
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
                            }
                        )}

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
                                display:
                                    "flex",
                                alignItems:
                                    "flex-end",
                                justifyContent:
                                    "space-between",
                                gap: "24px",
                            }}
                        >

                            <div
                                style={{
                                    textAlign:
                                        "left",
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
                                    Check nearby providers,
                                    pricing and appointment
                                    requirements.
                                </p>

                                {/* PIN CODE */}

                                <div className="mt-4">
                                    <label
                                        htmlFor="child-pin"
                                        className="block text-[11px] text-teal font-medium uppercase tracking-wide mb-2"
                                    >
                                        PIN CODE
                                    </label>

                                    <input
                                        id="child-pin"
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={6}
                                        placeholder="Enter 6-digit PIN"
                                        value={child.pinCode || ""}
                                        onChange={(e) => {
                                            const value =
                                                e.target.value
                                                    .replace(
                                                        /\D/g,
                                                        ""
                                                    )
                                                    .slice(
                                                        0,
                                                        6
                                                    );

                                            setChild({
                                                pinCode:
                                                value,
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
                                        child.pinCode || ""
                                    )
                                }
                                onClick={
                                    handleAvailability
                                }
                                className="shrink-0 bg-teal text-white rounded-lg px-6 py-3 text-sm font-medium hover:bg-teal-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                Check Availability →
                            </button>

                        </div>

                    </div>
                )}

                {/* NOTE */}

                <p className="text-[11px] text-ink/35 leading-relaxed mt-6">
                    Schedule information follows
                    India's National Immunization
                    Schedule. A healthcare professional
                    can advise on catch-up doses and
                    individual circumstances.
                </p>

            </div>
        </AppShell>
    );
}