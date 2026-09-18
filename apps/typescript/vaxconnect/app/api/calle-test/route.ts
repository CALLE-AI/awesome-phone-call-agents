console.log("CALL-E API key loaded:", !!process.env.CALLE_API_KEY);
console.log(
    "CALL-E API key prefix:",
    process.env.CALLE_API_KEY?.slice(0, 8)
);


import { NextResponse } from "next/server";
import { CalleClient } from "@call-e/calle";

const apiKey = process.env.CALLE_API_KEY;

console.log("CALL-E API key loaded:", !!apiKey);
console.log("CALL-E API key prefix:", apiKey?.slice(0, 8));

const client = new CalleClient({
    apiKey: apiKey!,
});

export async function POST(req: Request) {
    try {
        const { phone, vaccine } = await req.json();

        if (!phone || !vaccine) {
            return NextResponse.json(
                { error: "phone and vaccine are required" },
                { status: 400 }
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

        const recipient = call.recipients[0];
        const attempt = recipient?.attempts[0];

        return NextResponse.json({
            call_id: call.id,
            status: call.status,

            result: call.structuredResult,
            summary: call.summary,
            task_completed: call.taskCompleted,
            confidence: call.completionConfidence,
            evidence: call.evidence,

            failure_code: call.failureCode,
            failure_message: call.failureMessage,

            recipient_status: recipient?.status,
            recipient_id: recipient?.id,

            attempt_id: attempt?.id,
            attempt_status: attempt?.status,
            provider_call_id: attempt?.providerCallId,
            attempt_failure_code: attempt?.failureCode,
            attempt_failure_message: attempt?.failureMessage,
            attempt_summary: attempt?.summary,
            transcript: attempt?.transcriptTurns,
        });
    } catch (error) {
        console.error("CALL-E error:", error);

        return NextResponse.json(
            {
                error: "CALL-E call failed",
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}