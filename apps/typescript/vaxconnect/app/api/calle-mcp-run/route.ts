import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
    try {
        const authHeader = req.headers.get("authorization");
        const expectedSecret = process.env.CALLE_INTERNAL_SECRET;

        if (
            !expectedSecret ||
            authHeader !== `Bearer ${expectedSecret}`
        ) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Unauthorized",
                },
                { status: 401 }
            );
        }

        const { planId, confirmToken } = await req.json();

        if (!planId || !confirmToken) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "planId and confirmToken are required",
                },
                { status: 400 }
            );
        }

        const npxCommand =
            process.platform === "win32"
                ? "npx.cmd"
                : "npx";

        await execFileAsync(
            npxCommand,
            [
                "@call-e/cli",
                "call",
                "run",
                "--plan-id",
                planId,
                "--confirm-token",
                confirmToken,
                "--json",
            ],
            {
                cwd: process.cwd(),
                timeout: 180000,
                windowsHide: true,
                shell: false,
            }
        );

        return NextResponse.json({
            ok: true,
            status: "completed",
        });
    } catch {
        console.error("CALL-E MCP run failed.");

        return NextResponse.json(
            {
                ok: false,
                error: "CALL-E MCP run failed.",
            },
            { status: 500 }
        );
    }
}