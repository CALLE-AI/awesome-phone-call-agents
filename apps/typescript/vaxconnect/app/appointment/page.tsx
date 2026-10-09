
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { useFlow } from "@/context/flow-context";
import { addCallHistory } from "@/context/call-history";

type BookingResult = {
    booked?: string;
    status?: string;
    confirmed_date?: string;
    confirmed_time?: string;
    provider_message?: string;
};

export default function AppointmentPage() {
    const router = useRouter();

    const {
        selectedVaccine,
        selectedProvider,
    } = useFlow();

    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [date, setDate] = useState("");
    const [time, setTime] = useState("");

    const [booking, setBooking] = useState(false);
    const [booked, setBooked] = useState(false);
    const [bookingResult, setBookingResult] =
        useState<BookingResult | null>(null);
    const [error, setError] = useState("");

    const canBook =
        Boolean(
            selectedVaccine &&
            selectedProvider &&
            name.trim() &&
            phone.trim() &&
            date &&
            time
        );

    async function handleBooking() {
        if (!canBook || booking) return;

        setBooking(true);
        setError("");

        try {
            const res = await fetch(
                "/api/appointment",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",
                    },

                    body: JSON.stringify({
                        patientName: name.trim(),
                        patientPhone: phone.trim(),

                        vaccine: selectedVaccine,

                        hospital:
                        selectedProvider!.hospital,

                        preferredDate: date,
                        preferredTime: time,
                    }),
                }
            );

            const data = await res.json();

            if (!res.ok) {
                throw new Error(
                    data.details ||
                    data.error ||
                    "Appointment booking failed."
                );
            }

            const result =
                data.booking_result as BookingResult;

            setBookingResult(result);

            /*
             * Only mark the appointment as booked
             * when CALL-E/provider explicitly confirms it.
             */
            if (result?.booked === "yes") {
                addCallHistory({
                    type: "appointment",

                    vaccine:
                    selectedVaccine,

                    hospital:
                    selectedProvider!.hospital,

                    status:
                        "Appointment Booked",

                    summary:
                        `Appointment Booked — ${selectedVaccine} at ${selectedProvider!.hospital}. ` +
                        `Patient: ${name.trim()}. Phone: ${phone.trim()}. ` +
                        `Date: ${result.confirmed_date || date}. ` +
                        `Time: ${result.confirmed_time || time}. ` +
                        `CALL-E provider confirmation received.`,
                });

                setBooked(true);
            } else {
                setError(
                    result?.provider_message ||
                    "The provider did not confirm the appointment."
                );
            }
        } catch (error) {
            console.error(
                "Appointment booking error:",
                error
            );

            setError(
                error instanceof Error
                    ? error.message
                    : "Unable to book the appointment."
            );
        } finally {
            setBooking(false);
        }
    }

    if (
        !selectedVaccine ||
        !selectedProvider
    ) {
        return (
            <AppShell>
                <div className="mb-8">
                    <p className="text-xs text-teal font-medium mb-2">
                        VAXCONNECT
                    </p>

                    <h1 className="font-display text-2xl text-ink mb-2">
                        Book Appointment
                    </h1>

                    <p className="text-sm text-ink/60">
                        No provider has been selected yet.
                    </p>
                </div>

                <button
                    onClick={() =>
                        router.push(
                            "/dashboard"
                        )
                    }
                    className="bg-teal text-white rounded-md px-5 py-2.5 text-sm font-medium hover:bg-teal-dark"
                >
                    Return to Dashboard →
                </button>
            </AppShell>
        );
    }

    /*
     * SUCCESS
     */
    if (booked) {
        const confirmedDate =
            bookingResult?.confirmed_date ||
            date;

        const confirmedTime =
            bookingResult?.confirmed_time ||
            time;

        return (
            <AppShell>
                <div className="max-w-2xl">
                    <div className="border border-emerald-200 bg-emerald-50/60 rounded-xl p-7">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4 text-lg">
                            ✓
                        </div>

                        <p className="text-xs text-emerald-700 font-medium mb-2">
                            APPOINTMENT BOOKED
                        </p>

                        <h1 className="font-display text-2xl text-ink mb-5">
                            Your appointment is confirmed
                        </h1>

                        <div className="border border-line bg-white/70 rounded-lg p-5 space-y-4 mb-5">
                            <div>
                                <p className="text-xs text-ink/40">
                                    VACCINE
                                </p>

                                <p className="text-sm font-medium text-ink">
                                    💉{" "}
                                    {
                                        selectedVaccine
                                    }
                                </p>
                            </div>

                            <div>
                                <p className="text-xs text-ink/40">
                                    PROVIDER
                                </p>

                                <p className="text-sm font-medium text-ink">
                                    🏥{" "}
                                    {
                                        selectedProvider.hospital
                                    }
                                </p>
                            </div>

                            <div>
                                <p className="text-xs text-ink/40">
                                    PATIENT
                                </p>

                                <p className="text-sm font-medium text-ink">
                                    👤 {name}
                                </p>
                            </div>

                            <div>
                                <p className="text-xs text-ink/40">
                                    PHONE
                                </p>

                                <p className="text-sm font-medium text-ink">
                                    📞 {phone}
                                </p>
                            </div>

                            <div>
                                <p className="text-xs text-ink/40">
                                    CONFIRMED TIME
                                </p>

                                <p className="text-sm font-medium text-ink">
                                    📅{" "}
                                    {
                                        confirmedDate
                                    }{" "}
                                    ·{" "}
                                    {
                                        confirmedTime
                                    }
                                </p>
                            </div>
                        </div>

                        <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 mb-6">
                            <p className="text-xs text-emerald-800 leading-relaxed">
                                ✓ The provider confirmed the
                                appointment through CALL-E.
                            </p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() =>
                                    router.push(
                                        "/history"
                                    )
                                }
                                className="bg-teal text-white rounded-md px-5 py-2.5 text-sm font-medium hover:bg-teal-dark"
                            >
                                View Booking History →
                            </button>

                            <button
                                onClick={() =>
                                    router.push(
                                        "/dashboard"
                                    )
                                }
                                className="border border-line rounded-md px-5 py-2.5 text-sm font-medium text-ink/70 hover:border-teal hover:text-teal"
                            >
                                Dashboard
                            </button>
                        </div>
                    </div>
                </div>
            </AppShell>
        );
    }

    return (
        <AppShell>
            <div className="mb-8">
                <p className="text-xs text-teal font-medium mb-2">
                    VAXCONNECT · APPOINTMENT
                </p>

                <h1 className="font-display text-2xl text-ink mb-2">
                    Book Appointment
                </h1>

                <p className="text-sm text-ink/60 max-w-2xl">
                    Review the provider and enter the
                    information needed to book your
                    vaccination appointment.
                </p>
            </div>

            <div className="max-w-2xl space-y-5">
                {/* Provider */}
                <div className="border border-teal/30 bg-teal/5 rounded-xl p-6">
                    <p className="text-xs text-teal font-medium mb-4">
                        SELECTED PROVIDER
                    </p>

                    <div className="space-y-4">
                        <div>
                            <p className="text-xs text-ink/40 mb-1">
                                VACCINE
                            </p>

                            <p className="text-base font-medium text-ink">
                                💉{" "}
                                {
                                    selectedVaccine
                                }
                            </p>
                        </div>

                        <div>
                            <p className="text-xs text-ink/40 mb-1">
                                PROVIDER
                            </p>

                            <p className="text-base font-medium text-ink">
                                🏥{" "}
                                {
                                    selectedProvider.hospital
                                }
                            </p>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <p className="text-xs text-ink/40 mb-1">
                                    PRICE
                                </p>

                                <p className="text-sm font-medium text-ink">
                                    {
                                        selectedProvider.price
                                    }
                                </p>
                            </div>

                            <div>
                                <p className="text-xs text-ink/40 mb-1">
                                    EARLIEST
                                </p>

                                <p className="text-sm font-medium text-ink">
                                    {
                                        selectedProvider.earliest_availability
                                    }
                                </p>
                            </div>

                            <div>
                                <p className="text-xs text-ink/40 mb-1">
                                    APPOINTMENT
                                </p>

                                <p className="text-sm font-medium text-ink">
                                    {
                                        selectedProvider.appointment_required
                                    }
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Patient details */}
                <div className="border border-line bg-white/40 rounded-xl p-6">
                    <p className="text-xs text-teal font-medium mb-1">
                        APPOINTMENT DETAILS
                    </p>

                    <h2 className="font-display text-lg text-ink mb-5">
                        Who should we book this for?
                    </h2>

                    <div className="space-y-4">
                        <label className="block">
                            <span className="block text-sm text-ink/70 mb-1.5">
                                Patient name
                            </span>

                            <input
                                type="text"
                                value={name}
                                onChange={(e) =>
                                    setName(
                                        e.target.value
                                    )
                                }
                                placeholder="Full name"
                                className="w-full border border-line rounded-md px-3 py-2.5 text-sm bg-white/70 outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
                            />
                        </label>

                        <label className="block">
                            <span className="block text-sm text-ink/70 mb-1.5">
                                Phone number
                            </span>

                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) =>
                                    setPhone(
                                        e.target.value
                                    )
                                }
                                placeholder="Phone number"
                                className="w-full border border-line rounded-md px-3 py-2.5 text-sm bg-white/70 outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
                            />
                        </label>

                        <div className="grid grid-cols-2 gap-4">
                            <label className="block">
                                <span className="block text-sm text-ink/70 mb-1.5">
                                    Preferred date
                                </span>

                                <input
                                    type="date"
                                    value={date}
                                    onChange={(e) =>
                                        setDate(
                                            e.target.value
                                        )
                                    }
                                    min={
                                        new Date()
                                            .toISOString()
                                            .split(
                                                "T"
                                            )[0]
                                    }
                                    className="w-full border border-line rounded-md px-3 py-2.5 text-sm bg-white/70 outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
                                />
                            </label>

                            <label className="block">
                                <span className="block text-sm text-ink/70 mb-1.5">
                                    Preferred time
                                </span>

                                <input
                                    type="time"
                                    value={time}
                                    onChange={(e) =>
                                        setTime(
                                            e.target.value
                                        )
                                    }
                                    className="w-full border border-line rounded-md px-3 py-2.5 text-sm bg-white/70 outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
                                />
                            </label>
                        </div>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className="border border-red-200 bg-red-50 rounded-lg p-4">
                        <p className="text-sm font-medium text-red-700 mb-1">
                            Appointment not confirmed
                        </p>

                        <p className="text-xs text-red-600/80 leading-relaxed">
                            {error}
                        </p>
                    </div>
                )}

                {/* CALL-E confirmation */}
                <div className="border border-line bg-white/30 rounded-xl p-6">
                    <p className="text-sm text-ink/60 leading-relaxed mb-5">
                        When you confirm, VaxConnect will use
                        CALL-E to call the selected provider and
                        attempt to book this appointment. Your
                        appointment will only be marked as booked
                        if the provider explicitly confirms it.
                    </p>

                    <button
                        onClick={handleBooking}
                        disabled={
                            !canBook ||
                            booking
                        }
                        className="bg-teal text-white rounded-md px-5 py-2.5 text-sm font-medium hover:bg-teal-dark disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {booking
                            ? "CALL-E is calling provider…"
                            : "Confirm & Book Appointment →"}
                    </button>
                </div>
            </div>
        </AppShell>
    );
}
