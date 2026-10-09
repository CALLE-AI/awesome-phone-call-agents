import { NextResponse } from "next/server";
import { getCalleMcpClient } from "@/lib/calle/mcp-client";

export async function GET() {
    try {
        const client = await getCalleMcpClient();

        const result = await client.callTool({
            name: "plan_call",
            arguments: {
                goal: "Call the recipient and ask whether the requested vaccine is available, its price, whether an appointment is required, and the earliest available vaccination time.",
                user_input:
                    "I want to check whether a vaccine is available and find the earliest vaccination appointment.",
            },
        });

        return NextResponse.json({
            ok: true,
            result,
        });
    } catch (error) {
        console.error("CALL-E MCP error:", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : String(error),
            },
            { status: 500 }
        );
    }
}