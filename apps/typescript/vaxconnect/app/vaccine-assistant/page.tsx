"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { useFlow } from "@/context/flow-context";

type Message = {
    role: "user" | "assistant";
    content: string;
};

const DEMO_VACCINES = [
    {
        name: "COVID-19",
        icon: "🦠",
    },
    {
        name: "HPV",
        icon: "🧬",
    },
    {
        name: "MMR",
        icon: "💉",
    },
    {
        name: "Rabies",
        icon: "🐕",
    },
    {
        name: "Influenza",
        icon: "💉",
    },
    {
        name: "Hepatitis B",
        icon: "🩺",
    },
    {
        name: "Polio",
        icon: "🧒",
    },
];

function cleanGeminiResponse(text: string) {
    return text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/^###\s*/gm, "")
        .replace(/^##\s*/gm, "")
        .replace(/^#\s*/gm, "")
        .replace(/^---$/gm, "")
        .trim();
}

export default function VaccineAssistantPage() {
    const router = useRouter();

    /*
     * --------------------------------------------------
     * VAXCONNECT FLOW STATE
     * --------------------------------------------------
     */

    const {
        child,
        travel,
        setGeneralVaccine,
        setGeneralPinCode,
        setSelectedVaccine: setSelectedVaccineContext,
    } = useFlow();

    /*
     * --------------------------------------------------
     * DIRECT VACCINE FLOW
     * --------------------------------------------------
     *
     * This local state controls what is highlighted
     * on this page.
     *
     * The Context state is separately updated whenever
     * a vaccine is selected so the Availability page
     * receives the exact same vaccine.
     */

    const [selectedVaccine, setSelectedVaccine] =
        useState("");

    const [directPinCode, setDirectPinCode] =
        useState("");

    function handleSelectVaccine(vaccine: string) {
        // Update this page
        setSelectedVaccine(vaccine);

        // Update global VaxConnect flow
        setSelectedVaccineContext(vaccine);

        // Keep general vaccine profile in sync
        setGeneralVaccine(vaccine);

        // Clear PIN when switching vaccines
        setDirectPinCode("");
    }

    function handleAvailability() {
        if (
            !selectedVaccine ||
            !/^\d{6}$/.test(directPinCode)
        ) {
            return;
        }

        // Make absolutely sure the global state contains
        // the vaccine currently selected on this page.
        setSelectedVaccineContext(selectedVaccine);
        setGeneralVaccine(selectedVaccine);

        // Save the direct Vaccine Hub PIN
        // into the shared VaxConnect flow.
        setGeneralPinCode(directPinCode);

        router.push("/availability");
    }

    /*
     * --------------------------------------------------
     * AI FLOW
     * --------------------------------------------------
     */

    const [message, setMessage] = useState("");

    const [messages, setMessages] =
        useState<Message[]>([]);

    const [aiVaccine, setAiVaccine] =
        useState("");

    const [person, setPerson] =
        useState("");

    const [pinCode, setPinCode] =
        useState("");

    const [loading, setLoading] =
        useState(false);

    function addAssistantMessage(content: string) {
        setMessages((current) => [
            ...current,
            {
                role: "assistant",
                content,
            },
        ]);
    }

    async function askGemini(customMessage?: string) {
        const text =
            customMessage?.trim() ||
            message.trim();

        if (!text || loading) {
            return;
        }

        const newMessages: Message[] = [
            ...messages,
            {
                role: "user",
                content: text,
            },
        ];

        setMessages(newMessages);
        setMessage("");
        setLoading(true);

        try {
            const res = await fetch(
                "/api/gemini",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        messages: newMessages,

                        profile: {
                            child,
                            travel,
                        },

                        intake: {
                            vaccine: aiVaccine,
                            person,
                            pinCode,
                        },
                    }),
                }
            );

            const data = await res.json();

            if (!res.ok) {
                throw new Error(
                    data.error ||
                    "Something went wrong"
                );
            }

            const detectedVaccine =
                typeof data.vaccine === "string"
                    ? data.vaccine.trim()
                    : "";

            const detectedPerson =
                typeof data.person === "string"
                    ? data.person.trim()
                    : "";

            const detectedPin =
                typeof data.pinCode === "string"
                    ? data.pinCode.trim()
                    : "";

            if (detectedVaccine) {
                setAiVaccine(detectedVaccine);
            }

            if (detectedPerson) {
                setPerson(detectedPerson);
            }

            if (detectedPin) {
                setPinCode(detectedPin);
            }

            addAssistantMessage(
                cleanGeminiResponse(
                    data.response ||
                    "I have the information needed to continue."
                )
            );
        } catch (error) {
            console.error(
                "Chat error:",
                error
            );

            addAssistantMessage(
                "I'm having trouble connecting right now. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

    function handleAiAvailability() {
        if (!aiVaccine) {
            return;
        }

        /*
         * The AI flow also writes into the SAME
         * global vaccine state used by Availability.
         */

        setSelectedVaccineContext(aiVaccine);
        setGeneralVaccine(aiVaccine);

        // Save the AI PIN into the same shared
        // general PIN state used by Vaccine Hub.
        setGeneralPinCode(pinCode);

        router.push("/availability");
    }

    const aiReadyForAvailability =
        Boolean(
            aiVaccine &&
            person &&
            pinCode
        );

    /*
     * --------------------------------------------------
     * UI
     * --------------------------------------------------
     */

    return (
        <AppShell>
            {/* HEADER */}

            <div className="mb-8">
                <p className="text-xs text-teal font-medium tracking-wide mb-2">
                    VAXCONNECT · VACCINE HUB
                </p>

                <h1 className="font-display text-3xl text-ink mb-2">
                    Vaccine Hub
                </h1>

                <p className="text-sm text-ink/60 max-w-2xl leading-relaxed">
                    Choose a vaccine directly to find
                    providers, or use VaxConnect AI
                    separately for vaccination questions
                    and assistance.
                </p>
            </div>

            {/* DIRECT VACCINE FLOW */}

            <section className="mb-10">
                <div className="mb-4">
                    <p className="text-xs text-ink/40 uppercase tracking-wide mb-1">
                        FIND A VACCINE
                    </p>

                    <h2 className="font-display text-xl text-ink">
                        Select a vaccine
                    </h2>

                    <p className="text-xs text-ink/50 mt-1">
                        Select a vaccine when you already
                        know what you need.
                    </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-3xl">
                    {DEMO_VACCINES.map(
                        (vaccine) => {
                            const isSelected =
                                selectedVaccine ===
                                vaccine.name;

                            return (
                                <button
                                    key={vaccine.name}
                                    onClick={() =>
                                        handleSelectVaccine(
                                            vaccine.name
                                        )
                                    }
                                    className={`group text-left border rounded-xl p-4 transition-colors ${
                                        isSelected
                                            ? "border-teal bg-teal/5"
                                            : "border-line bg-white/50 hover:border-teal hover:bg-white/70"
                                    }`}
                                >
                                    <div className="text-lg mb-2">
                                        {vaccine.icon}
                                    </div>

                                    <p
                                        className={`text-sm font-medium transition-colors ${
                                            isSelected
                                                ? "text-teal"
                                                : "text-ink group-hover:text-teal"
                                        }`}
                                    >
                                        {vaccine.name}
                                    </p>

                                    <p className="text-xs text-ink/45 mt-1">
                                        {isSelected
                                            ? "Selected"
                                            : "Select vaccine"}
                                    </p>
                                </button>
                            );
                        }
                    )}
                </div>

                {/* SELECTED VACCINE */}

                {selectedVaccine && (
                    <div className="mt-5 max-w-3xl border border-teal/30 bg-teal/5 rounded-xl p-5">
                        <p className="text-xs text-teal font-medium tracking-wide mb-2">
                            SELECTED VACCINE
                        </p>

                        <div className="flex flex-col gap-4">
                            <div>
                                <p className="font-display text-xl text-ink">
                                    💉 {selectedVaccine}
                                </p>

                                <p className="text-sm text-ink/55 mt-1">
                                    Find nearby providers
                                    and check vaccination
                                    availability.
                                </p>
                            </div>

                            <div>
                                <label
                                    htmlFor="direct-vaccine-pin"
                                    className="block text-[10px] text-ink/40 uppercase tracking-wide mb-2"
                                >
                                    PIN CODE
                                </label>

                                <input
                                    id="direct-vaccine-pin"
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={directPinCode}
                                    onChange={(e) =>
                                        setDirectPinCode(
                                            e.target.value
                                                .replace(/\D/g, "")
                                                .slice(0, 6)
                                        )
                                    }
                                    placeholder="Enter 6-digit PIN"
                                    className="w-full max-w-xs border border-line rounded-md px-3 py-2.5 text-sm bg-white/70 outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
                                />
                            </div>

                            <div>
                                <button
                                    onClick={
                                        handleAvailability
                                    }
                                    disabled={
                                        !/^\d{6}$/.test(
                                            directPinCode
                                        )
                                    }
                                    className="bg-teal text-white rounded-md px-5 py-2.5 text-sm font-medium hover:bg-teal-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Check Availability →
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </section>

            {/* AI */}

            <section className="max-w-3xl">
                <div className="border border-teal/30 bg-teal/5 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-9 h-9 rounded-full bg-teal/10 flex items-center justify-center text-base">
                            🤖
                        </div>

                        <div>
                            <p className="text-xs text-teal font-medium tracking-wide">
                                VAXCONNECT AI
                            </p>

                            <h2 className="font-display text-xl text-ink">
                                Your vaccination assistant
                            </h2>
                        </div>
                    </div>

                    <p className="text-sm text-ink/60 mb-5 leading-relaxed">
                        Ask questions about vaccines,
                        doses, boosters, side effects,
                        schedules, or travel requirements.
                        You can also tell the AI that you
                        want to get a vaccine and it can
                        help you continue to availability.
                    </p>

                    {/* CHAT MESSAGES */}

                    {messages.length > 0 && (
                        <div className="space-y-4 mb-5 max-h-[420px] overflow-y-auto pr-1">
                            {messages.map(
                                (
                                    msg,
                                    index
                                ) => (
                                    <div
                                        key={index}
                                        className={
                                            msg.role ===
                                            "user"
                                                ? "flex justify-end"
                                                : "flex justify-start"
                                        }
                                    >
                                        <div
                                            className={`max-w-[85%] rounded-xl px-4 py-3 ${
                                                msg.role ===
                                                "user"
                                                    ? "bg-teal text-white"
                                                    : "border border-line bg-white/70 text-ink"
                                            }`}
                                        >
                                            <p
                                                className={`text-[11px] font-medium mb-1 ${
                                                    msg.role ===
                                                    "user"
                                                        ? "text-white/70"
                                                        : "text-teal"
                                                }`}
                                            >
                                                {msg.role ===
                                                "user"
                                                    ? "YOU"
                                                    : "VAXCONNECT AI"}
                                            </p>

                                            <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                                {
                                                    msg.content
                                                }
                                            </p>
                                        </div>
                                    </div>
                                )
                            )}

                            {loading && (
                                <div className="flex justify-start">
                                    <div className="border border-line bg-white/70 rounded-xl px-4 py-3">
                                        <p className="text-xs text-ink/50">
                                            VaxConnect AI is thinking...
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* CHAT INPUT */}

                    <div className="flex gap-3">
                        <input
                            type="text"
                            value={message}
                            onChange={(e) =>
                                setMessage(
                                    e.target.value
                                )
                            }
                            onKeyDown={(e) => {
                                if (
                                    e.key ===
                                    "Enter"
                                ) {
                                    e.preventDefault();
                                    askGemini();
                                }
                            }}
                            placeholder="Ask VaxConnect AI anything..."
                            className="flex-1 border border-line rounded-md px-4 py-3 text-sm bg-white/70 outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
                        />

                        <button
                            onClick={() =>
                                askGemini()
                            }
                            disabled={
                                loading ||
                                !message.trim()
                            }
                            className="px-5 py-3 rounded-md bg-teal text-white text-sm font-medium disabled:opacity-50 hover:bg-teal-dark transition-colors"
                        >
                            {loading
                                ? "Thinking..."
                                : "Ask"}
                        </button>
                    </div>

                    {/* AI EXAMPLES */}

                    {messages.length ===
                        0 && (
                            <div className="mt-4">
                                <p className="text-[10px] text-ink/40 uppercase tracking-wide mb-2">
                                    Try asking
                                </p>

                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() =>
                                            askGemini(
                                                "Tell me about the HPV vaccine"
                                            )
                                        }
                                        className="text-xs border border-line bg-white/50 rounded-full px-3 py-1.5 text-ink/60 hover:border-teal hover:text-teal transition-colors"
                                    >
                                        What is HPV?
                                    </button>

                                    <button
                                        onClick={() =>
                                            askGemini(
                                                "Tell me all about the polio vaccine"
                                            )
                                        }
                                        className="text-xs border border-line bg-white/50 rounded-full px-3 py-1.5 text-ink/60 hover:border-teal hover:text-teal transition-colors"
                                    >
                                        Polio vaccine
                                    </button>

                                    <button
                                        onClick={() =>
                                            askGemini(
                                                "What are common vaccine side effects?"
                                            )
                                        }
                                        className="text-xs border border-line bg-white/50 rounded-full px-3 py-1.5 text-ink/60 hover:border-teal hover:text-teal transition-colors"
                                    >
                                        Common side effects
                                    </button>

                                    <button
                                        onClick={() =>
                                            askGemini(
                                                "I want to get an HPV vaccine for myself. My PIN code is 560001."
                                            )
                                        }
                                        className="text-xs border border-line bg-white/50 rounded-full px-3 py-1.5 text-ink/60 hover:border-teal hover:text-teal transition-colors"
                                    >
                                        Find an HPV vaccine
                                    </button>
                                </div>
                            </div>
                        )}

                    {/* AI VACCINATION REQUEST */}

                    {aiVaccine && (
                        <div className="mt-6 border-t border-line pt-5">
                            <p className="text-xs text-ink/40 mb-3 tracking-wide">
                                AI VACCINATION REQUEST
                            </p>

                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <div className="border border-line rounded-md px-3 py-3 bg-white/40">
                                    <p className="text-[10px] text-ink/40 mb-1">
                                        VACCINE
                                    </p>

                                    <p className="text-sm font-medium text-ink">
                                        💉 {aiVaccine}
                                    </p>
                                </div>

                                <div className="border border-line rounded-md px-3 py-3 bg-white/40">
                                    <p className="text-[10px] text-ink/40 mb-1">
                                        FOR
                                    </p>

                                    <p className="text-sm font-medium text-ink">
                                        👤{" "}
                                        {person ||
                                            "Not provided"}
                                    </p>
                                </div>

                                <div className="border border-line rounded-md px-3 py-3 bg-white/40 col-span-2">
                                    <p className="text-[10px] text-ink/40 mb-1">
                                        PIN CODE
                                    </p>

                                    <p className="text-sm font-medium text-ink">
                                        📍{" "}
                                        {pinCode ||
                                            "Not provided"}
                                    </p>
                                </div>
                            </div>

                            {aiReadyForAvailability && (
                                <div className="border-t border-line pt-4">
                                    <p className="text-sm text-ink/60 mb-4 leading-relaxed">
                                        I have the
                                        information needed
                                        to check nearby
                                        providers for{" "}
                                        <strong className="text-ink">
                                            {aiVaccine}
                                        </strong>
                                        .
                                    </p>

                                    <button
                                        onClick={
                                            handleAiAvailability
                                        }
                                        disabled={
                                            loading
                                        }
                                        className="bg-teal text-white rounded-md px-5 py-2.5 text-sm font-medium hover:bg-teal-dark disabled:opacity-50 transition-colors"
                                    >
                                        Check Availability →
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {/* DISCLAIMER */}

            <div className="mt-8 max-w-3xl border border-line bg-white/30 rounded-xl p-5">
                <p className="text-xs font-medium text-ink/60 mb-2">
                    About VaxConnect AI
                </p>

                <p className="text-xs text-ink/50 leading-relaxed">
                    VaxConnect AI provides general
                    vaccination information and helps
                    coordinate provider availability. It
                    does not diagnose medical conditions or
                    replace advice from a qualified
                    healthcare professional.
                </p>
            </div>
        </AppShell>
    );
}