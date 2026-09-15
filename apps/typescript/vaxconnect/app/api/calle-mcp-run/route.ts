import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
    try {
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

        const command =
            `npx @call-e/cli call run ` +
            `--plan-id "${planId}" ` +
            `--confirm-token "${confirmToken}" ` +
            `--json`;

        console.log("Running CALL-E MCP run");

        const { stdout, stderr } = await execAsync(command, {
            cwd: process.cwd(),
            timeout: 180000,
            windowsHide: true,
        });

        if (stderr) {
            console.log("CALL-E CLI:", stderr);
        }

        let result: unknown;

        try {
            result = JSON.parse(stdout);
        } catch {
            return NextResponse.json(
                {
                    ok: false,
                    error: "CALL-E returned non-JSON output",
                    raw: stdout,
                    stderr,
                },
                { status: 500 }
            );
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error("CALL-E MCP run error:", error);

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
