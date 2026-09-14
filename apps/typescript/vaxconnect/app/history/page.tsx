"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/app-shell";
import {
    CallHistoryRecord,
    getCallHistory,
} from "@/context/call-history";

export default function HistoryPage() {
    const [history, setHistory] =
        useState<CallHistoryRecord[]>([]);

    useEffect(() => {
        setHistory(getCallHistory());
    }, []);

    return (
        <AppShell>
            <div className="mb-8">
                <p className="text-xs text-teal font-medium tracking-wide mb-2">
                    VAXCONNECT · HISTORY
                </p>

                <h1 className="font-display text-2xl text-ink mb-2">
                    Booking History
                </h1>

                <p className="text-sm text-ink/60">
                    View your recent vaccination
                    appointments and provider coordination.
                </p>
            </div>

            {history.length === 0 ? (
                <div className="border border-line bg-white/40 rounded-md p-8 text-center">
                    <div className="text-4xl mb-3">
                        📋
                    </div>

                    <h2 className="font-display text-lg text-ink mb-2">
                        No booking history yet
                    </h2>

                    <p className="text-sm text-ink/60">
                        Confirmed appointments and
                        provider coordination will appear
                        here.
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    {history.map((record) => (
                        <div
                            key={record.id}
                            className="border border-line bg-white/40 rounded-xl p-5 hover:border-teal transition-colors"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="text-xl">
                                            💉
                                        </span>

                                        <h2 className="font-display text-lg text-ink">
                                            {record.type ===
                                            "appointment"
                                                ? "Vaccination Appointment"
                                                : "Availability Check"}
                                        </h2>
                                    </div>

                                    <p className="text-sm text-ink/70">
                                        💉 {record.vaccine}
                                    </p>

                                    <p className="text-sm text-ink/70">
                                        🏥 {record.hospital}
                                    </p>

                                    {record.type ===
                                        "appointment" &&
                                        record.patientName && (
                                            <p className="text-sm text-ink/70">
                                                👤{" "}
                                                {record.patientName}
                                            </p>
                                        )}

                                    {record.type ===
                                        "appointment" &&
                                        record.patientPhone && (
                                            <p className="text-sm text-ink/70">
                                                📞{" "}
                                                {record.patientPhone}
                                            </p>
                                        )}
                                </div>

                                <span
                                    className={`shrink-0 text-xs rounded-full px-3 py-1 ${
                                        record.status
                                            .toLowerCase()
                                            .includes(
                                                "book"
                                            )
                                            ? "border border-emerald-300 text-emerald-700 bg-emerald-50"
                                            : "border border-teal text-teal"
                                    }`}
                                >
                                    {record.status}
                                </span>
                            </div>

                            <div className="border-t border-line mt-4 pt-4">
                                <p className="text-xs text-ink/40">
                                    {new Date(
                                        record.createdAt
                                    ).toLocaleString()}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </AppShell>
    );
}