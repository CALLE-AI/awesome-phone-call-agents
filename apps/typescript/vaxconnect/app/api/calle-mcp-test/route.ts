import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
    try {
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

        const goal = `
You are calling a vaccination provider on behalf of VaxConnect.

This is an AVAILABILITY enquiry ONLY.

DO NOT make an appointment.
DO NOT book anything.
DO NOT provide medical advice.
DO NOT ask for or mention a PIN code.

Vaccine requested:
${vaccine}

Ask the provider these four questions naturally and clearly:

1. Is the ${vaccine} vaccine currently available?
2. What is the price?
3. Is an appointment required, or is walk-in vaccination possible?
4. What is the earliest available vaccination date and time?

Only report information the provider actually gives you.
Never guess availability, price, appointment requirements, dates, or times.
If the provider does not know an answer, mark it UNKNOWN.
If nobody answers, report UNKNOWN for every unanswered field.

IMPORTANT FINAL REPORT:
Before ending the call, after you have collected the provider's answers, produce a short final report using EXACTLY these four labels, each on its own line:

AVAILABILITY: YES
AVAILABILITY: NO
or
AVAILABILITY: UNKNOWN

PRICE: <provider's exact price, or UNKNOWN>

APPOINTMENT: REQUIRED
APPOINTMENT: WALK-IN
or
APPOINTMENT: UNKNOWN

EARLIEST: <provider's exact earliest date/time, or UNKNOWN>

Do not invent values.
Do not put multiple alternatives on the same line.
Thank the provider and end the call.
`;

        const command =
            `npx @call-e/cli call plan ` +
            `--to-phone "${phone}" ` +
            `--goal "${goal
                .replace(/"/g, '\\"')
                .replace(/\r?\n/g, " ")}" ` +
            `--json`;

        console.log("Running CALL-E MCP plan");

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
        console.error("CALL-E MCP plan error:", error);

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
