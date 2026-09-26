import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { guardOperatorAndRealCalls, guardRecipient } from "@/lib/calle/security";

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
    try {
        // Operator authorization + no-call default, same gate used by
        // every other route that can trigger a real CALL-E call.
        const authGate = guardOperatorAndRealCalls(req);

        if (authGate) {
            return authGate;
        }

        const { planId, confirmToken, phone } = await req.json();

        if (!planId || !confirmToken) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "planId and confirmToken are required",
                },
                { status: 400 }
            );
        }

        /*
         * The recipient the plan will actually dial isn't visible to
         * this route, so the caller must also state it here and it is
         * checked against the same authorized-recipient allow-list as
         * every other call path before the plan is executed.
         */
        const recipientGate = guardRecipient(phone);

        if (recipientGate) {
            return recipientGate;
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