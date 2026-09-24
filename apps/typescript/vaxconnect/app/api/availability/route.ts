
import { NextResponse } from "next/server";
import { CalleClient } from "@call-e/calle";

const DEMO_PIN = "560001";

type TranscriptTurn = {
    speaker?: string;
    text?: string;
};

type AvailabilityResult = {
    available: boolean;
    price: string;
    appointment_required: string;
    earliest_availability: string;
};

function extractAvailability(result: any): AvailabilityResult {
    const recipient = result?.recipients?.[0];
    const attempt = recipient?.attempts?.[0];

    const turns =
        (attempt?.transcriptTurns ?? []) as TranscriptTurn[];

    let available = false;
    let price = "Not provided";
    let appointmentRequired = "Unknown";
    let earliestAvailability = "Not provided";

    for (let i = 0; i < turns.length; i++) {
        const current = turns[i];

        if (
            current.speaker !== "bot" ||
            !current.text
        ) {
            continue;
        }

        const question =
            current.text.toLowerCase();

        let answer = "";

        for (let j = i + 1; j < turns.length; j++) {
            const nextTurn = turns[j];

            if (
                nextTurn?.speaker === "user" &&
                nextTurn.text
            ) {
                answer = nextTurn.text.trim();
                break;
            }
        }

        if (!answer) {
            continue;
        }

        const answerLower =
            answer.toLowerCase();

        if (
            question.includes("currently available")
        ) {
            if (
                answerLower.includes("not available") ||
                answerLower.includes("unavailable") ||
                answerLower === "no" ||
                answerLower.startsWith("no ")
            ) {
                available = false;
            } else if (
                answerLower.includes("available") ||
                answerLower === "yes" ||
                answerLower.startsWith("yes ")
            ) {
                available = true;
            }
        }

        if (
            question.includes("what is the price")
        ) {
            const priceMatch =
                answer.match(
                    /₹\s?[\d,]+(?:\.\d+)?|Rs\.?\s?[\d,]+(?:\.\d+)?|(?:INR\s*)?[\d,]+(?:\.\d+)?\s*(?:rupees|rs\.?)/i
                );

            price =
                priceMatch?.[0] ??
                answer;
        }

        if (
            question.includes("appointment required") ||
            question.includes("walk-in")
        ) {
            if (
                answerLower.includes("walk-in") ||
                answerLower.includes("walk in") ||
                answerLower.includes("no appointment") ||
                answerLower.includes("without an appointment")
            ) {
                appointmentRequired = "Walk-in";
            } else if (
                answerLower.includes("appointment") ||
                answerLower === "yes" ||
                answerLower.startsWith("yes ")
            ) {
                appointmentRequired = "Yes";
            } else {
                appointmentRequired = answer;
            }
        }

        if (
            question.includes(
                "earliest available"
            )
        ) {
            earliestAvailability =
                answer;
        }
    }

    /*
     * Fallback to CALL-E summary if transcript
     * parsing missed anything.
     */

    const summary =
        typeof result?.summary === "string"
            ? result.summary
            : "";

    const summaryLower =
        summary.toLowerCase();

    if (
        !available &&
        summaryLower.includes("available") &&
        !summaryLower.includes(
            "not available"
        ) && !summaryLower.includes(
            "unavailable"
        )
    ) {
        available = true;
    }
    if (price === "Not provided") {
        const summaryPrice =
            summary.match(
                /₹\s?[\d,]+(?:\.\d+)?|Rs\.?\s?[\d,]+(?:\.\d+)?|(?:INR\s*)?[\d,]+(?:\.\d+)?\s*(?:rupees|rs\.?)/i
            );

        if (summaryPrice) {
            price =
                summaryPrice[0];
        }
    }

    if (
        appointmentRequired === "Unknown"
    ) {
        if (
            summaryLower.includes(
                "appointment is required"
            ) ||
            summaryLower.includes(
                "appointment required"
            )
        ) {
            appointmentRequired =
                "Yes";
        } else if (
            summaryLower.includes(
                "walk-in"
            ) ||
            summaryLower.includes(
                "walk in"
            )
        ) {
            appointmentRequired =
                "Walk-in";
        }
    }

    if (
        earliestAvailability ===
        "Not provided"
    ) {
        const timeMatch =
            summary.match(
                /(?:tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)[^.]*/i
            );

        if (timeMatch) {
            earliestAvailability =
                timeMatch[0].trim();
        }
    }

    return {
        available,
        price,
        appointment_required:
        appointmentRequired,
        earliest_availability:
        earliestAvailability,
    };
}

async function makeAvailabilityCall(
    client: CalleClient,
    demoPhone: string,
    vaccine: string,
    pinCode: string
) {
    /*
     * PIN is intentionally NOT mentioned to the provider.
     *
     * VaxConnect collects the PIN from the user for the
     * application's search flow. The provider only needs
     * to answer vaccine availability questions.
     */

    const task = `
You are calling a vaccination provider on behalf of VaxConnect.

    This is an AVAILABILITY enquiry only.

    DO NOT make an appointment.
    DO NOT book anything.
    DO NOT provide medical advice.

    Vaccine requested:
    ${vaccine}

Ask the provider these four questions, one at a time, and wait for a clear answer to each:

    1. Ask: "Is the ${vaccine} vaccine currently available right now? Please answer yes or no."
2. Ask: "What is the exact price per dose? Please state the amount clearly in Indian rupees, for example, 700 rupees." If the answer is unclear, ask: "Could you please repeat the exact price in rupees?"
3. Ask: "Is an appointment required, or is walk-in vaccination allowed? Please clearly state which one." If unclear, ask the provider to clarify.
4. Ask: "What is the earliest available vaccination date and time? Please state the date and time clearly." If unclear, ask the provider to repeat the earliest date and time.

    Do not move to the next question until the current answer is clear enough to record.

    IMPORTANT:
- Do not mention or ask about a PIN code.
- Only report information the provider actually gives you.
- Never guess availability.
- Never guess the price.
- Never guess appointment requirements.
- Never guess dates or times.
- If the provider does not know an answer, report it as unknown.
- Do not make or confirm an appointment.
- This call is only an availability enquiry.

    After collecting the information, thank the provider and end the call.
    `;

    return await client.calls.createAndWait(
        {
            task,

            recipients: [
                {
                    phones: [demoPhone],
                    region: "IN",
                    locale: "en-IN",
                },
            ],

            metadata: {
                application: "vaxconnect",
                operation: "availability",
                vaccine,
                pinCode,
            },
        },
        {
            idempotencyKey:
                `vaxconnect-availability-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`,
        }
    );
}

export async function POST(
    request: Request
) {
    try {
        const body =
            await request.json();

        const vaccine =
            typeof body.vaccine === "string" &&
            body.vaccine.trim()
                ? body.vaccine.trim()
                : "";

        const pinCode =
            typeof body.pinCode === "string" &&
            body.pinCode.trim()
                ? body.pinCode.trim()
                : DEMO_PIN;

        if (!vaccine) {
            return NextResponse.json(
                {
                    error:
                        "Vaccine is required",
                },
                { status: 400 }
            );
        }

        const apiKey =
            process.env.CALLE_API_KEY;

        const demoPhone =
            process.env.DEMO_PROVIDER_PHONE;

        if (!apiKey) {
            return NextResponse.json(
                {
                    error:
                        "CALLE_API_KEY is not configured",
                },
                { status: 500 }
            );
        }

        if (!demoPhone) {
            return NextResponse.json(
                {
                    error:
                        "DEMO_PROVIDER_PHONE is not configured",
                },
                { status: 500 }
            );
        }

        if (
            !/^\+[1-9]\d{7,14}$/.test(
                demoPhone
            )
        ) {
            return NextResponse.json(
                {
                    error:
                        "DEMO_PROVIDER_PHONE must be a valid E.164 phone number.",
                },
                { status: 500 }
            );
        }

        const client =
            new CalleClient({
                apiKey,
            });

        /*
         * FIRST ATTEMPT
         */

        console.log(
            "========== CALL-E AVAILABILITY ATTEMPT 1 =========="
        );

        let result =
            await makeAvailabilityCall(
                client,
                demoPhone,
                vaccine,
                pinCode
            );

        console.log(
            JSON.stringify(
                result,
                null,
                2
            )
        );

        /*
         * If CALL-E fails before the conversation starts,
         * retry the phone call once.
         *
         * This specifically handles intermittent 404/408
         * connection/no-answer failures.
         */

        if (
            result.status === "failed"
        ) {
            const failureCode =
                result.failureCode ??
                result.recipients?.[0]
                    ?.attempts?.[0]
                    ?.failureCode ??
                null;

            console.log(
                `CALL-E first attempt failed with ${failureCode}. Retrying once...`
            );

            /*
             * Small delay before retry.
             */

            await new Promise(
                (resolve) =>
                    setTimeout(
                        resolve,
                        2000
                    )
            );

            console.log(
                "========== CALL-E AVAILABILITY ATTEMPT 2 =========="
            );

            result =
                await makeAvailabilityCall(
                    client,
                    demoPhone,
                    vaccine,
                    pinCode
                );

            console.log(
                JSON.stringify(
                    result,
                    null,
                    2
                )
            );
        }

        console.log(
            "========== FINAL CALL-E AVAILABILITY RESULT =========="
        );

        console.log(
            JSON.stringify(
                result,
                null,
                2
            )
        );

        console.log(
            "======================================================="
        );

        /*
         * If both attempts failed, return the real
         * CALL-E failure to the frontend.
         */

        if (
            result.status === "failed"
        ) {
            return NextResponse.json(
                {
                    error:
                        "CALL-E call failed after retry.",

                    call: {
                        id:
                            result.id ??
                            null,

                        status:
                            result.status ??
                            null,

                        failureCode:
                            result.failureCode ??
                            result
                                .recipients?.[0]
                                ?.attempts?.[0]
                                ?.failureCode ??
                            null,

                        failureMessage:
                            result.failureMessage ??
                            result
                                .recipients?.[0]
                                ?.attempts?.[0]
                                ?.failureMessage ??
                            null,

                        summary:
                            result.summary ??
                            null,
                    },
                },
                { status: 502 }
            );
        }

        if (
            result.status !==
            "completed" ||
            !result.taskCompleted
        ) {
            return NextResponse.json(
                {
                    error:
                        "CALL-E did not complete the availability enquiry.",

                    call: {
                        id:
                            result.id ??
                            null,

                        status:
                            result.status ??
                            null,

                        taskCompleted:
                            result.taskCompleted ??
                            null,

                        summary:
                            result.summary ??
                            null,
                    },
                },
                { status: 502 }
            );
        }

        /*
         * CALL-E completed successfully.
         *
         * Extract the answers from the actual
         * conversation.
         */

        const liveResult =
            extractAvailability(
                result
            );

        /*
         * REAL CALL-E PROVIDER
         */

        const providers = [
            {
                hospital:
                    "Sunset Hospitals (Demo)",

                provider_id:
                    "calle-live-provider",

                available:
                liveResult.available,

                price:
                liveResult.price,

                appointment_required:
                liveResult.appointment_required,

                earliest_availability:
                liveResult.earliest_availability,

                source:
                    "CALL-E VERIFIED" as const,
            },

            /*
             * DEMO PROVIDER
             *
             * Not contacted.
             */

            {
                hospital:
                    "Demo Vaccination Centre",

                provider_id:
                    "demo-vaccination-centre",

                available: true,

                price: "₹700",

                appointment_required:
                    "Yes",

                earliest_availability:
                    "Tomorrow, 11:30 AM",

                source:
                    "DEMO PROVIDER" as const,
            },

            /*
             * DEMO PROVIDER
             *
             * Not contacted.
             */

            {
                hospital:
                    "Demo Community Clinic",

                provider_id:
                    "demo-community-clinic",

                available: false,

                price: "—",

                appointment_required:
                    "—",

                earliest_availability:
                    "Currently unavailable",

                source:
                    "DEMO PROVIDER" as const,
            },
        ];

        return NextResponse.json({
            vaccine,

            pinCode,

            providers,

            call: {
                id:
                    result.id ??
                    null,

                status:
                    result.status ??
                    null,

                taskCompleted:
                    result.taskCompleted ??
                    null,

                summary:
                    result.summary ??
                    null,
            },
        });
    } catch (error) {
        console.error(
            "========== CALL-E AVAILABILITY EXCEPTION =========="
        );

        console.error(error);

        console.error(
            "===================================================="
        );

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to execute CALL-E availability enquiry",
            },
            { status: 500 }
        );
    }
}