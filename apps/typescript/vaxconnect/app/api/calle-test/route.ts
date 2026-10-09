import { NextResponse } from "next/server";
import { CalleClient } from "@call-e/calle";
import { guardOperatorAndRealCalls, guardRecipient } from "@/lib/calle/security";
import { maskErrorForLog, maskStructuredResult } from "@/lib/calle/mask";

const apiKey = process.env.CALLE_API_KEY;

const client = apiKey
    ? new CalleClient({
        apiKey,
    })
    : null;

export async function POST(req: Request) {
    try {
        // Protect the real-call endpoint and require real calls to be
        // explicitly enabled (no-call default).
        const authGate = guardOperatorAndRealCalls(req);

        if (authGate) {
            return authGate;
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

        const recipientGate = guardRecipient(phone);

        if (recipientGate) {
            return recipientGate;
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
            result: maskStructuredResult(call.structuredResult),
            task_completed: call.taskCompleted,
            confidence: call.completionConfidence,
        });
    } catch (error) {
        console.error("CALL-E call failed:", maskErrorForLog(error));

        return NextResponse.json(
            {
                ok: false,
                error: "CALL-E call failed",
            },
            { status: 500 }
        );
    }
}