"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { useFlow } from "@/context/flow-context";

type Provider = {
    hospital: string;
    provider_id: string;
    available: boolean;
    price: string;
    appointment_required: string;
    earliest_availability: string;
    source: "CALL-E VERIFIED" | "DEMO PROVIDER";
};

export default function AvailabilityPage() {
    const router = useRouter();

    const {
        child,
        travel,
        generalPinCode,
        selectedVaccine,
        setSelectedProvider,
    } = useFlow();

    const [providers, setProviders] =
        useState<Provider[]>([]);

    const [calling, setCalling] =
        useState(false);

    const [called, setCalled] =
        useState(false);

    const [error, setError] =
        useState("");

    async function handleCallProviders() {
        if (!selectedVaccine || calling) {
            return;
        }

        /*
         * Determine which PIN belongs to the current flow.
         *
         * Child flow    → child.pinCode
         * Travel flow   → travel.pinCode
         * Vaccine Hub   → generalPinCode
         * AI flow       → generalPinCode
         */

        const pinCode =
            generalPinCode ||
            travel.pinCode ||
            child.pinCode ||
            "";

        if (!/^\d{6}$/.test(pinCode)) {
            setError(
                "A valid 6-digit PIN code is required."
            );
            return;
        }

        setCalling(true);
        setError("");

        try {
            const res = await fetch(
                "/api/availability",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",
                    },

                    body: JSON.stringify({
                        vaccine: selectedVaccine,
                        pinCode,
                    }),
                }
            );

            const data =
                await res.json();

            if (!res.ok) {
                throw new Error(
                    data.details ||
                    data.error ||
                    "Availability enquiry failed."
                );
            }

            setProviders(
                data.providers || []
            );

            setCalled(true);
        } catch (error) {
            console.error(
                "Availability enquiry error:",
                error
            );

            setError(
                error instanceof Error
                    ? error.message
                    : "Unable to check availability."
            );
        } finally {
            setCalling(false);
        }
    }

    function handleBook(
        provider: Provider
    ) {
        if (!provider.available) {
            return;
        }

        setSelectedProvider({
            hospital:
            provider.hospital,

            price:
            provider.price,

            appointment_required:
            provider.appointment_required,

            earliest_availability:
            provider.earliest_availability,
        });

        router.push(
            "/appointment"
        );
    }

    /*
     * No vaccine selected.
     */

    if (!selectedVaccine) {
        return (
            <AppShell>
                <div className="mb-8">
                    <p className="text-xs text-teal font-medium tracking-wide mb-2">
                        VAXCONNECT · AVAILABILITY
                    </p>

                    <h1 className="font-display text-2xl text-ink mb-2">
                        Check Availability
                    </h1>

                    <p className="text-sm text-ink/60">
                        No vaccine has been selected yet.
                    </p>
                </div>

                <button
                    onClick={() =>
                        router.push(
                            "/vaccine-assistant"
                        )
                    }
                    className="bg-teal text-white rounded-md px-5 py-2.5 text-sm font-medium hover:bg-teal-dark"
                >
                    Choose a Vaccine →
                </button>
            </AppShell>
        );
    }

    return (
        <AppShell>
            {/* HEADER */}

            <div className="mb-8">
                <p className="text-xs text-teal font-medium tracking-wide mb-2">
                    VAXCONNECT · AVAILABILITY
                </p>

                <h1 className="font-display text-3xl text-ink mb-2">
                    Check Availability
                </h1>

                <p className="text-sm text-ink/60 max-w-2xl leading-relaxed">
                    Let VaxConnect contact a provider
                    and check availability for your
                    selected vaccine.
                </p>
            </div>

            {/* SELECTED VACCINE */}

            <div className="max-w-4xl border border-teal/30 bg-teal/5 rounded-xl p-6 mb-6">
                <p className="text-xs text-teal font-medium tracking-wide mb-3">
                    SELECTED VACCINE
                </p>

                <div className="flex items-center justify-between gap-5">
                    <div>
                        <h2 className="font-display text-2xl text-ink">
                            💉 {selectedVaccine}
                        </h2>

                        <p className="text-sm text-ink/55 mt-1">
                            VaxConnect will use CALL-E
                            to make a live availability
                            enquiry.
                        </p>
                    </div>

                    {!called && (
                        <button
                            onClick={
                                handleCallProviders
                            }
                            disabled={calling}
                            className="shrink-0 bg-teal text-white rounded-md px-5 py-3 text-sm font-medium hover:bg-teal-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {calling
                                ? "CALL-E is calling…"
                                : "Call to Check Availability →"}
                        </button>
                    )}
                </div>
            </div>

            {/* CALLING */}

            {calling && (
                <div className="max-w-4xl border border-teal/30 bg-teal/5 rounded-xl p-5 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-teal/10 flex items-center justify-center">
                            📞
                        </div>

                        <div>
                            <p className="text-sm font-medium text-ink">
                                CALL-E is contacting the
                                provider…
                            </p>

                            <p className="text-xs text-ink/50 mt-1">
                                Checking availability,
                                price, appointment
                                requirements, and earliest
                                vaccination time.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* ERROR */}

            {error && (
                <div className="max-w-4xl border border-red-200 bg-red-50 rounded-xl p-5 mb-6">
                    <p className="text-sm font-medium text-red-700 mb-1">
                        Availability enquiry failed
                    </p>

                    <p className="text-xs text-red-600/80 leading-relaxed">
                        {error}
                    </p>

                    <button
                        onClick={
                            handleCallProviders
                        }
                        disabled={calling}
                        className="mt-4 border border-red-200 bg-white rounded-md px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                        Try Again
                    </button>
                </div>
            )}

            {/* RESULTS */}

            {called &&
                providers.length > 0 && (
                    <section className="max-w-4xl">
                        <div className="mb-4">
                            <p className="text-xs text-ink/40 uppercase tracking-wide mb-1">
                                PROVIDER RESULTS
                            </p>

                            <h2 className="font-display text-xl text-ink">
                                {selectedVaccine} availability
                            </h2>

                            <p className="text-xs text-ink/50 mt-1">
                                One provider was verified
                                through a live CALL-E
                                enquiry. The other
                                providers are clearly
                                marked as demo providers.
                            </p>
                        </div>

                        <div className="border border-line rounded-xl overflow-hidden bg-white/40">
                            {/* TABLE HEADER */}

                            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1.3fr_1.5fr_1.2fr] gap-4 px-5 py-3 border-b border-line bg-paper-dim">
                                <p className="text-[10px] text-ink/40 uppercase tracking-wide">
                                    Provider
                                </p>

                                <p className="text-[10px] text-ink/40 uppercase tracking-wide">
                                    Availability
                                </p>

                                <p className="text-[10px] text-ink/40 uppercase tracking-wide">
                                    Price
                                </p>

                                <p className="text-[10px] text-ink/40 uppercase tracking-wide">
                                    Appointment
                                </p>

                                <p className="text-[10px] text-ink/40 uppercase tracking-wide">
                                    Earliest
                                </p>

                                <p className="text-[10px] text-ink/40 uppercase tracking-wide">
                                    Action
                                </p>
                            </div>

                            {/* ROWS */}

                            {providers.map(
                                (
                                    provider,
                                    index
                                ) => (
                                    <div
                                        key={
                                            provider.provider_id
                                        }
                                        className={`grid md:grid-cols-[2fr_1fr_1fr_1.3fr_1.5fr_1.2fr] gap-4 px-5 py-5 ${
                                            index <
                                            providers.length -
                                            1
                                                ? "border-b border-line"
                                                : ""
                                        }`}
                                    >
                                        {/* PROVIDER */}

                                        <div>
                                            <p className="text-sm font-medium text-ink">
                                                🏥{" "}
                                                {
                                                    provider.hospital
                                                }
                                            </p>

                                            <span
                                                className={`inline-flex mt-2 text-[9px] font-medium tracking-wide rounded-full px-2 py-1 ${
                                                    provider.source ===
                                                    "CALL-E VERIFIED"
                                                        ? "bg-teal/10 text-teal"
                                                        : "bg-ink/5 text-ink/45"
                                                }`}
                                            >
                                                {
                                                    provider.source
                                                }
                                            </span>
                                        </div>

                                        {/* AVAILABILITY */}

                                        <div>
                                            <p
                                                className={`text-sm font-medium ${
                                                    provider.available
                                                        ? "text-emerald-700"
                                                        : "text-red-600"
                                                }`}
                                            >
                                                {provider.available
                                                    ? "● Available"
                                                    : "● Unavailable"}
                                            </p>
                                        </div>

                                        {/* PRICE */}

                                        <div>
                                            <p className="text-sm font-medium text-ink">
                                                {
                                                    provider.price
                                                }
                                            </p>
                                        </div>

                                        {/* APPOINTMENT */}

                                        <div>
                                            <p className="text-sm text-ink/70">
                                                {
                                                    provider.appointment_required
                                                }
                                            </p>
                                        </div>

                                        {/* EARLIEST */}

                                        <div>
                                            <p className="text-sm text-ink/70">
                                                {
                                                    provider.earliest_availability
                                                }
                                            </p>
                                        </div>

                                        {/* ACTION */}

                                        <div>
                                            {provider.available ? (
                                                <button
                                                    onClick={() =>
                                                        handleBook(
                                                            provider
                                                        )
                                                    }
                                                    className="bg-teal text-white rounded-md px-3 py-2 text-xs font-medium hover:bg-teal-dark transition-colors"
                                                >
                                                    Book Appointment
                                                </button>
                                            ) : (
                                                <span className="text-xs text-ink/35">
                                                    Not available
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )
                            )}
                        </div>

                        {/* DISCLOSURE */}

                        <div className="mt-4 border border-line bg-white/30 rounded-lg p-4">
                            <p className="text-xs text-ink/50 leading-relaxed">
                                <strong className="text-ink/70">
                                    Demo disclosure:
                                </strong>{" "}
                                <strong className="text-teal">
                                    CALL-E VERIFIED
                                </strong>{" "}
                                represents the live
                                provider response returned
                                by CALL-E.{" "}
                                <strong>
                                    DEMO PROVIDER
                                </strong>{" "}
                                rows are demonstration
                                data and were not contacted.
                            </p>
                        </div>
                    </section>
                )}

            {/* BEFORE CALL */}

            {!called &&
                !calling &&
                !error && (
                    <div className="max-w-4xl border border-line bg-white/30 rounded-xl p-6">
                        <div className="flex items-start gap-4">
                            <div className="w-9 h-9 rounded-full bg-teal/10 flex items-center justify-center shrink-0">
                                📞
                            </div>

                            <div>
                                <p className="text-sm font-medium text-ink mb-1">
                                    Ready to check providers?
                                </p>

                                <p className="text-xs text-ink/50 leading-relaxed">
                                    Click{" "}
                                    <strong className="text-ink/70">
                                        Call to Check
                                        Availability
                                    </strong>{" "}
                                    to start the live
                                    CALL-E enquiry.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
        </AppShell>
    );
}