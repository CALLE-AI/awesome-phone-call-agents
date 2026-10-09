
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFlow } from "@/context/flow-context";

type Message = {
    role: "user" | "assistant";
    content: string;
};

const KNOWN_VACCINES = [
    "COVID-19",
    "COVID",
    "Polio",
    "OPV",
    "IPV",
    "HPV",
    "MMR",
    "Hepatitis B",
    "Rabies",
    "Influenza",
    "Flu",
    "Typhoid",
    "BCG",
    "OPV",
    "DPT",
    "Measles",
    "Rotavirus",
];

function detectVaccine(text: string) {
    const lower = text.toLowerCase();

    const found = KNOWN_VACCINES.find((vaccine) =>
        lower.includes(vaccine.toLowerCase())
    );

    // Common natural-language aliases.
    if (!found) {
        if (
            lower.includes("polio shot") ||
            lower.includes("polio vaccine") ||
            lower.includes("polio vaccination")
        ) {
            return "Polio";
        }

        if (
            lower.includes("flu shot") ||
            lower.includes("flu vaccine") ||
            lower.includes("flu vaccination")
        ) {
            return "Influenza";
        }
    }

    if (!found) return "";

    if (found === "COVID") {
        return "COVID-19";
    }

    if (found === "Flu") {
        return "Influenza";
    }

    if (found === "OPV" || found === "IPV") {
        return "Polio";
    }

    return found;
}

function detectPin(text: string) {
    const match = text.match(/\b\d{6}\b/);
    return match ? match[0] : "";
}

function detectPerson(text: string) {
    const lower = text.toLowerCase();

    if (
        lower.includes("myself") ||
        lower.includes("for me") ||
        lower.includes("for myself")
    ) {
        return "Myself";
    }

    const sonAge = text.match(
        /\b(\d{1,2})\s*(?:year|years|yr|yrs)[ -]*old\b.*\bson\b/i
    );

    if (
        lower.includes("my son") ||
        lower.includes("for my son")
    ) {
        return sonAge
            ? `My son (${sonAge[1]} years old)`
            : "My son";
    }

    const daughterAge = text.match(
        /\b(\d{1,2})\s*(?:year|years|yr|yrs)[ -]*old\b.*\bdaughter\b/i
    );

    if (
        lower.includes("my daughter") ||
        lower.includes("for my daughter")
    ) {
        return daughterAge
            ? `My daughter (${daughterAge[1]} years old)`
            : "My daughter";
    }

    const childAge = text.match(
        /\b(\d{1,2})\s*(?:year|years|yr|yrs)[ -]*old\b/i
    );

    if (
        lower.includes("my child") ||
        lower.includes("for my child")
    ) {
        return childAge
            ? `My child (${childAge[1]} years old)`
            : "My child";
    }

    return "";
}

function looksLikeInformationQuestion(text: string) {
    const lower = text.toLowerCase();

    const informationWords = [
        "what is",
        "what are",
        "what's",
        "tell me about",
        "can you tell me",
        "can i",
        "can adults",
        "is it safe",
        "should i",
        "how does",
        "how do",
        "why",
        "side effect",
        "side effects",
        "dose",
        "doses",
        "booster",
        "schedule",
        "protect",
        "protection",
        "safe",
        "safety",
        "work",
        "works",
        "information",
        "explain",
    ];

    return informationWords.some((phrase) =>
        lower.includes(phrase)
    );
}

function cleanGeminiResponse(text: string) {
    return text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/^###\s*/gm, "")
        .replace(/^##\s*/gm, "")
        .replace(/^#\s*/gm, "")
        .replace(/^---$/gm, "")
        .trim();
}

export default function VaccineChat() {
    const router = useRouter();

    const {
        child,
        travel,
        setGeneralVaccine,
    } = useFlow();

    const [message, setMessage] = useState("");
    const [messages, setMessages] = useState<Message[]>([]);

    const [selectedVaccine, setSelectedVaccine] =
        useState("");

    const [person, setPerson] = useState("");
    const [pinCode, setPinCode] = useState("");

    const [loading, setLoading] = useState(false);

    function addAssistantMessage(content: string) {
        setMessages((current) => [
            ...current,
            {
                role: "assistant",
                content,
            },
        ]);
    }

    function handleLocalFlow(
        vaccine: string,
        currentPerson: string,
        currentPin: string
    ) {
        if (!vaccine) {
            addAssistantMessage(
                "Sure. What vaccine are you looking for?"
            );
            return;
        }

        if (!currentPerson) {
            addAssistantMessage(
                `Got it — ${vaccine}. Who is the vaccine for?`
            );
            return;
        }

        if (!currentPin) {
            addAssistantMessage(
                "Thanks. What's your 6-digit PIN code so I can check nearby providers?"
            );
            return;
        }

        addAssistantMessage(
            `Got it. I have the information needed to check nearby providers for ${vaccine}.`
        );
    }

    async function askGemini() {
        if (!message.trim() || loading) return;

        const userMessage = message.trim();

        const detectedVaccine =
            detectVaccine(userMessage);

        const detectedPerson =
            detectPerson(userMessage);

        const detectedPin =
            detectPin(userMessage);

        const nextVaccine =
            detectedVaccine || selectedVaccine;

        const nextPerson =
            detectedPerson || person;

        const nextPin =
            detectedPin || pinCode;

        if (detectedVaccine) {
            setSelectedVaccine(detectedVaccine);
            setGeneralVaccine(detectedVaccine);
        }

        if (detectedPerson) {
            setPerson(detectedPerson);
        }

        if (detectedPin) {
            setPinCode(detectedPin);
        }

        const newMessages: Message[] = [
            ...messages,
            {
                role: "user",
                content: userMessage,
            },
        ];

        setMessages(newMessages);
        setMessage("");

        /*
         * BASIC INTAKE
         *
         * These messages do not use Gemini.
         * This protects the Gemini quota and keeps
         * the core demo flow reliable.
         */
        if (
            !looksLikeInformationQuestion(userMessage)
        ) {
            handleLocalFlow(
                nextVaccine,
                nextPerson,
                nextPin
            );

            return;
        }

        /*
         * INFORMATION QUESTIONS
         *
         * Gemini is used only when the user is
         * actually asking for vaccine information.
         */
        setLoading(true);

        try {
            const res = await fetch("/api/gemini", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messages: newMessages,

                    profile: {
                        child,
                        travel,
                    },

                    intake: {
                        vaccine: nextVaccine,
                        person: nextPerson,
                        pinCode: nextPin,
                    },
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(
                    data.error ||
                    "Something went wrong"
                );
            }

            addAssistantMessage(
                cleanGeminiResponse(
                    data.response ||
                    "I couldn't generate an answer right now."
                )
            );
        } catch (error) {
            console.error(
                "Gemini information error:",
                error
            );

            addAssistantMessage(
                "I can't access detailed vaccine information right now, but I can still help you check provider availability."
            );
        } finally {
            setLoading(false);
        }
    }

    function handleAvailability() {
        if (!selectedVaccine) return;

        setGeneralVaccine(selectedVaccine);

        router.push("/availability");
    }

    const readyForAvailability =
        Boolean(
            selectedVaccine &&
            person &&
            pinCode
        );

    return (
        <div>
            <p className="text-sm text-ink/60 mb-4">
                Tell VaxConnect what vaccine you need,
                who it is for, and your PIN code. You can
                also ask questions about the vaccine.
            </p>

            {messages.length > 0 && (
                <div className="space-y-4 mb-5 max-h-[420px] overflow-y-auto pr-1">
                    {messages.map((msg, index) => (
                        <div
                            key={index}
                            className={
                                msg.role === "user"
                                    ? "flex justify-end"
                                    : "flex justify-start"
                            }
                        >
                            <div
                                className={`max-w-[85%] rounded-xl px-4 py-3 ${
    msg.role === "user"
        ? "bg-teal text-white"
        : "border border-line bg-white/60 text-ink"
}`}
                            >
                                <p
                                    className={`text-[11px] font-medium mb-1 ${
    msg.role === "user"
        ? "text-white/70"
        : "text-teal"
}`}
                                >
                                    {msg.role === "user"
                                        ? "YOU"
                                        : "VAXCONNECT AI"}
                                </p>

                                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                    {msg.content}
                                </p>
                            </div>
                        </div>
                    ))}

                    {loading && (
                        <div className="flex justify-start">
                            <div className="border border-line bg-white/60 rounded-xl px-4 py-3">
                                <p className="text-xs text-ink/50">
                                    VaxConnect AI is thinking...
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="flex gap-3">
                <input
                    type="text"
                    value={message}
                    onChange={(e) =>
                        setMessage(e.target.value)
                    }
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            askGemini();
                        }
                    }}
                    placeholder="Ask about a vaccine..."
                    className="flex-1 border border-line rounded-md px-4 py-3 text-sm bg-white/70 outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
                />

                <button
                    onClick={askGemini}
                    disabled={
                        loading ||
                        !message.trim()
                    }
                    className="px-5 py-3 rounded-md bg-teal text-white text-sm font-medium disabled:opacity-50"
                >
                    {loading
                        ? "Thinking..."
                        : "Ask"}
                </button>
            </div>

            {messages.length === 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                    <button
                        onClick={() =>
                            setMessage(
                                "I want a rabies vaccine for my 15 year old son"
                            )
                        }
                        className="text-xs border border-line rounded-full px-3 py-1.5 text-ink/60 hover:border-teal hover:text-teal transition-colors"
                    >
                        Rabies for my son
                    </button>

                    <button
                        onClick={() =>
                            setMessage(
                                "I want a COVID-19 vaccine for myself"
                            )
                        }
                        className="text-xs border border-line rounded-full px-3 py-1.5 text-ink/60 hover:border-teal hover:text-teal transition-colors"
                    >
                        COVID-19 for myself
                    </button>
                </div>
            )}

            {selectedVaccine && (
                <div className="mt-5 border-t border-line pt-5">
                    <p className="text-xs text-ink/40 mb-3">
                        VACCINATION REQUEST
                    </p>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="border border-line rounded-md px-3 py-2.5 bg-white/30">
                            <p className="text-[10px] text-ink/40 mb-1">
                                VACCINE
                            </p>

                            <p className="text-sm font-medium text-ink">
                                💉 {selectedVaccine}
                            </p>
                        </div>

                        <div className="border border-line rounded-md px-3 py-2.5 bg-white/30">
                            <p className="text-[10px] text-ink/40 mb-1">
                                FOR
                            </p>

                            <p className="text-sm font-medium text-ink">
                                👤{" "}
                                {person ||
                                    "Not provided"}
                            </p>
                        </div>

                        <div className="border border-line rounded-md px-3 py-2.5 bg-white/30 col-span-2">
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

                    {readyForAvailability && (
                        <div className="border-t border-line pt-4">
                            <p className="text-sm text-ink/60 mb-4">
                                I have what I need to
                                check nearby providers
                                for{" "}
                                <strong className="text-ink">
                                    {selectedVaccine}
                                </strong>
                                .
                            </p>

                            <button
                                onClick={
                                    handleAvailability
                                }
                                disabled={loading}
                                className="bg-teal text-paper rounded-md px-5 py-2.5 text-sm font-medium hover:bg-teal-dark disabled:opacity-50"
                            >
                                Check Availability →
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}


