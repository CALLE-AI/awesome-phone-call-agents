import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
    try {
        const { runId } = await req.json();

        if (!runId) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "runId is required",
                },
                { status: 400 }
            );
        }

        const command =
            `npx @call-e/cli call status ` +
            `--run-id "${runId}" ` +
            `--json`;

        console.log("Running CALL-E MCP get_call_run");

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
        console.error("CALL-E MCP status error:", error);

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