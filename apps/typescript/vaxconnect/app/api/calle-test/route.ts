import { NextResponse } from "next/server";
import { CalleClient } from "@call-e/calle";

const apiKey = process.env.CALLE_API_KEY;
const internalSecret = process.env.CALLE_INTERNAL_SECRET;

const realCallsEnabled =
    process.env.CALLE_ENABLE_REAL_CALLS === "true";

const allowedRecipients = new Set(
    (process.env.CALLE_ALLOWED_RECIPIENTS ?? "")
        .split(",")
        .map((phone) => phone.trim())
        .filter(Boolean)
);

const client = apiKey
    ? new CalleClient({
        apiKey,
    })
    : null;

function isValidE164(phone: string): boolean {
    return /^\+[1-9]\d{7,14}$/.test(phone);
}

export async function POST(req: Request) {
    try {
        // Protect the real-call endpoint and private call results.
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
                { status: 401 }
            );
        }

        // Real calls are disabled unless explicitly enabled.
        if (!realCallsEnabled) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Real CALL-E calls are disabled.",
                },
                { status: 403 }
            );
        }

        if (!client) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "CALL-E is not configured.",
                },
                { status: 500 }
            );
        }

        const { phone, vaccine } = await req.json();

        if (!phone || !vaccine) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "phone and vaccine are required",
                },
                { status: 400 }
            );
        }

        if (
            typeof phone !== "string" ||
            !isValidE164(phone)
        ) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Recipient must be a valid E.164 phone number.",
                },
                { status: 400 }
            );
        }

        if (!allowedRecipients.has(phone)) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Recipient is not authorized for real calls.",
                },
                { status: 403 }
            );
        }

        const call = await client.calls.createAndWait({
            task: `Call the recipient and ask about the availability of the vaccine "${vaccine}".

Explain that you are calling on behalf of VaxConnect to verify vaccine availability.

Ask:
1. Is the vaccine currently available?
2. What is the price, if they provide one?
3. Is an appointment required?
4. What is the earliest available appointment or vaccination time?

Do not provide medical advice. Only collect the provider's information.`,

            recipients: [
                {
                    phones: [phone],
                },
            ],

            resultSchema: {
                type: "object",
                required: [
                    "available",
                    "price",
                    "appointment_required",
                    "earliest_availability",
                ],
                properties: {
                    available: {
                        type: "string",
                        enum: ["yes", "no", "unknown"],
                    },
                    price: {
                        type: "string",
                    },
                    appointment_required: {
                        type: "string",
                        enum: ["yes", "no", "unknown"],
                    },
                    earliest_availability: {
                        type: "string",
                    },
                },
                additionalProperties: false,
            },
        });

        return NextResponse.json({
            ok: true,
            status: call.status,
            result: call.structuredResult,
            task_completed: call.taskCompleted,
            confidence: call.completionConfidence,
        });
    } catch (error) {
        console.error("CALL-E call failed.");

        return NextResponse.json(
            {
                ok: false,
                error: "CALL-E call failed",
            },
            { status: 500 }
        );
    }
}