
import { NextResponse } from "next/server";
import { CalleClient } from "@call-e/calle";

const client = new CalleClient({
    apiKey: process.env.CALLE_API_KEY!,
});
const internalSecret = process.env.CALLE_INTERNAL_SECRET;

const realCallsEnabled =
    process.env.CALLE_ENABLE_REAL_CALLS === "true";

const allowedRecipients = new Set(
    (process.env.CALLE_ALLOWED_RECIPIENTS ?? "")
        .split(",")
        .map((phone) => phone.trim())
        .filter(Boolean)
);

function isValidE164(phone: string): boolean {
    return /^\+[1-9]\d{7,14}$/.test(phone);
}

/*
 * Extract all transcript turns.
 */
function getTranscriptTurns(call: any): any[] {
    return (
        call.recipients?.[0]?.attempts?.[0]
            ?.transcriptTurns || []
    );
}

/*
 * Convert transcript turns into plain text.
 */
function getTranscriptText(call: any): string {
    const turns = getTranscriptTurns(call);

    return turns
        .map((turn: any) => {
            if (typeof turn === "string") {
                return turn;
            }

            return (
                turn.text ||
                turn.transcript ||
                turn.content ||
                ""
            );
        })
        .filter(Boolean)
        .join("\n");
}

/*
 * Determine whether the PROVIDER explicitly confirmed
 * the booking.
 *
 * We prefer provider/user transcript turns over the
 * CALL-E summary because the summary may describe what
 * the bot attempted rather than what the provider actually
 * confirmed.
 */
function extractBookingResult(
    call: any,
    transcriptTurns: any[]
) {
    /*
     * CALL-E transcript speaker labels can vary. Prefer clearly identified
     * provider-side turns, but fall back to the actual CALL-E summary/
     * transcript when those labels are unavailable.
     */
    const providerTurns = transcriptTurns
        .filter((turn: any) => {
            if (typeof turn !== "object" || !turn) {
                return false;
            }

            const speaker = String(
                turn.speaker ||
                turn.role ||
                turn.source ||
                ""
            ).toLowerCase();

            return (
                speaker === "user" ||
                speaker === "recipient" ||
                speaker === "provider" ||
                speaker === "callee"
            );
        })
        .map((turn: any) =>
            String(
                turn.text ||
                turn.transcript ||
                turn.content ||
                ""
            )
        )
        .filter(Boolean);

    const providerText = providerTurns.join(" ").toLowerCase();

    /*
     * If CALL-E does not expose the provider with one of the expected
     * speaker labels, use the call summary as the provider response.
     *
     * Example returned response:
     * "Hello. Yes. Available. Booked."
     */
    const fallbackText =
        String(call.summary || "").trim().toLowerCase() ||
        getTranscriptText(call).trim().toLowerCase();

    const confirmationText =
        providerText || fallbackText;

    /*
     * Strong provider-side confirmation phrases.
     */
    const confirmedPatterns = [
        "appointment is booked",
        "appointment has been booked",
        "appointment is confirmed",
        "appointment has been confirmed",
        "booking is confirmed",
        "booking has been confirmed",
        "appointment booked",
        "appointment confirmed",
        "yes, it is booked",
        "yes it is booked",
        "it is booked",
        "it's booked",
        "booking is booked",
        "yes, booked",
        "yes booked",
        "yes, the appointment is confirmed",
        "yes the appointment is confirmed",
        "yes, confirmed",
        "yes confirmed",
    ];

    /*
     * Strong provider-side rejection phrases.
     */
    const notBookedPatterns = [
        "cannot book",
        "can't book",
        "cannot schedule",
        "can't schedule",
        "unable to book",
        "unable to schedule",
        "no appointment",
        "no availability",
        "not available",
        "appointment is not available",
        "appointment isn't available",
        "appointment is unavailable",
        "we cannot",
        "we can't",
        "not booked",
        "not confirmed",
        "unable to confirm",
    ];

    const confirmed =
        confirmedPatterns.some((pattern) =>
            confirmationText.includes(pattern)
        ) ||
        /*
         * Natural short confirmations such as:
         * "Hello. Yes. Available. Booked."
         *
         * Only use these when we have a fallback provider response,
         * not when the full agent transcript merely mentions the word.
         */
        (
            !providerText &&
            /\bbooked\b/i.test(confirmationText) &&
            !/\bnot\s+booked\b/i.test(confirmationText)
        ) ||
        (
            !providerText &&
            /\bconfirmed\b/i.test(confirmationText) &&
            !/\bnot\s+confirmed\b/i.test(confirmationText)
        );

    const notBooked =
        notBookedPatterns.some((pattern) =>
            confirmationText.includes(pattern)
        );

    let booked:
        | "yes"
        | "no"
        | "unknown" = "unknown";

    let status:
        | "confirmed"
        | "not_booked"
        | "unknown" = "unknown";

    if (confirmed && !notBooked) {
        booked = "yes";
        status = "confirmed";
    } else if (notBooked && !confirmed) {
        booked = "no";
        status = "not_booked";
    }

    /*
     * Look for a confirmed date/time in the provider response where possible.
     */
    let confirmedDate = "";
    let confirmedTime = "";

    const fullText = confirmationText;

    const timeMatch = fullText.match(
        /\b(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:am|pm)?\b/i
    );

    if (timeMatch) {
        confirmedTime = timeMatch[0];
    }

    /*
     * The provider's actual response is more trustworthy than the
     * summary when we have a provider-labelled transcript. Otherwise
     * return the CALL-E summary/transcript that triggered the fallback.
     */
    const providerMessage =
        providerTurns.length > 0
            ? providerTurns.join(" ")
            : call.summary ||
            getTranscriptText(call) ||
            "No provider response was returned.";

    return {
        booked,
        status,
        confirmed_date: confirmedDate,
        confirmed_time: confirmedTime,
        provider_message: providerMessage,
    };
}

export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get("authorization");

        if (
            !internalSecret ||
            authHeader !== `Bearer ${internalSecret}`
        ) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Unauthorized",
                },
                {status: 401}
            );
        }

        if (!realCallsEnabled) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Real CALL-E calls are disabled.",
                },
                {status: 403}
            );
        }
        const body = await req.json();

        const {
            patientName,
            patientPhone,
            vaccine,
            hospital,
            preferredDate,
            preferredTime,
        } = body;

        /*
         * Validate the booking information.
         */
        if (
            !patientName ||
            !patientPhone ||
            !vaccine ||
            !hospital ||
            !preferredDate ||
            !preferredTime
        ) {
            return NextResponse.json(
                {
                    error:
                        "Patient name, phone, vaccine, provider, date, and time are required.",
                },
                {status: 400}
            );
        }

        /*
         * This is the SAME authorized demo/test number
         * used for the live CALL-E provider enquiry.
         *
         * We intentionally do not call a real hospital.
         */
        const providerPhone =
            process.env.DEMO_PROVIDER_PHONE;

        if (!providerPhone) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "No provider phone number is configured.",
                },
                {status: 500}
            );
        }

        if (!isValidE164(providerPhone)) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Configured provider number must be a valid E.164 phone number.",
                },
                {status: 400}
            );
        }

        if (!allowedRecipients.has(providerPhone)) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Configured provider number is not authorized for real calls.",
                },
                {status: 403}
            );
        }
        /*
         * ============================================================
         * SECOND CALL-E CALL
         * ============================================================
         *
         * This is the booking call.
         *
         * The availability call happened earlier.
         * This call is intentionally separate and asks the same
         * authorized demo/provider number to book the appointment.
         */
        console.log(
            "============================================================"
        );


        const call = await client.calls.createAndWait(
            {
                task: `
You are an appointment coordinator calling on behalf of VaxConnect.

    You are calling the vaccination provider ${hospital}.

This is a BOOKING request.

    Vaccination:
${vaccine}

Patient name:
    ${patientName}

Patient contact phone number:
    ${patientPhone}

Requested appointment date:
    ${preferredDate}

Requested appointment time:
    ${preferredTime}

Your job is to actually request the appointment from the provider and determine whether the provider confirms that it is booked.

    IMPORTANT:

- Clearly introduce yourself as calling on behalf of VaxConnect.
- Explain that you are calling to book a ${vaccine} vaccination appointment.
- Ask to book the appointment for ${patientName}.
- Give the requested date: ${preferredDate}.
- Give the requested time: ${preferredTime}.
- Confirm the patient's name.
- Confirm the vaccination type.
- If the requested time is available, ask the provider to book it.
- If the requested time is unavailable, ask whether another time on the same date is available.
- If an alternative time is offered, clearly identify it.
- Do not provide medical advice.
- Do not make medical decisions.
- Do not invent availability, prices, dates, times, or policies.
- Do not say that the appointment is booked yourself.
- Do not claim that the appointment is confirmed merely because you requested it.
- The appointment is only considered booked if the PROVIDER explicitly confirms that the booking has been made.
- Before ending the call, ask the provider directly:

    "Just to confirm, is the appointment now booked?"

    - Wait for the provider's answer.
- If the provider says yes or otherwise clearly confirms that the appointment has been booked, acknowledge the confirmation and end the call.
- If the provider says no, clearly acknowledge that the appointment was not booked.
    `,
                recipients: [
                    {
                        phones: [providerPhone],
                        region: "IN",
                        locale: "en-IN",
                    },
                ],
                metadata: {
                    workflow:
                        "vaxconnect-appointment",
                    operation: "booking",
                    vaccine,
                    hospital,
                },
            },
            {
                idempotencyKey:
                    `vaxconnect-booking-${Date.now()}`,
            }
        );
        /*
         * Get transcript.
         */
        const transcriptTurns =
            getTranscriptTurns(call);

        const transcript =
            getTranscriptText(call);

        /*
         * Extract booking confirmation.
         */
        const bookingResult =
            extractBookingResult(
                call,
                transcriptTurns
            );

        /*
         * ============================================================
         * CONNECTION FAILURE
         * ============================================================
         *
         * If CALL-E could not connect, do not pretend that the
         * provider rejected the booking. Report the actual failure.
         */
        if (call.status !== "completed") {
            return NextResponse.json(
                {
                    ok: false,
                    error:
                        "CALL-E could not complete the provider call, so the appointment was not confirmed.",
                    booked: "unknown",
                    booking_result: {
                        booked: "unknown",
                        status: "unknown",
                        confirmed_date: "",
                        confirmed_time: "",
                        provider_message: "",
                    },
                },
                {status: 502}
            );
        }

        /*
         * ============================================================
         * SUCCESSFUL CONNECTION BUT NO BOOKING CONFIRMATION
         * ============================================================
         */
        if (bookingResult.booked !== "yes") {
            return NextResponse.json({
                ok: true,
                status: call.status,
                booked: bookingResult.booked,
                booking_result: bookingResult,
            });
        }
        /*
         * ============================================================
         * CONFIRMED BOOKING
         * ============================================================
         */
        console.log(
            "CALL-E BOOKING CONFIRMED"
        );


        console.log(
            "============================================================"
        );
        return NextResponse.json({
            ok: true,
            status: call.status,
            booked: "yes",
            booking_result: bookingResult,
        });
    } catch (error) {
        console.error("CALL-E appointment request failed.");

        return NextResponse.json(
            {
                ok: false,
                error: "Appointment call failed.",
            },
            { status: 500 }
        );
    }
}

