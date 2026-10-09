import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest) {
    return NextResponse.json(
        {
            ok: false,
            error: "CALL-E MCP run is disabled.",
        },
        { status: 403 }
    );
}
