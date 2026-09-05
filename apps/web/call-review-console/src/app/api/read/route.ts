import { NextResponse } from "next/server";

import { detectSurface, normalize, say, UnknownSurfaceError } from "asheard/disposition";

/**
 * Read one payload and say what it means.
 *
 * This is door three. No key, no account, nothing kept. You hand it the JSON
 * a CALL-E surface gave you and it hands back the three axes with the
 * provenance on each one.
 *
 * It refuses rather than guesses. A payload that does not clearly belong to a
 * known surface comes back as a 422 saying so, because picking the closest
 * looking mapping table produces a confident answer that happens to be false.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "That is not JSON. Paste the whole response object, brackets and all." },
      { status: 400 },
    );
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return NextResponse.json(
      { error: "Expected one call object. An array of them is not something this reads yet." },
      { status: 400 },
    );
  }

  try {
    const disposition = normalize(payload as Record<string, unknown>);
    return NextResponse.json({ disposition, spoken: say(disposition) });
  } catch (error) {
    if (error instanceof UnknownSurfaceError) {
      return NextResponse.json(
        {
          error:
            "This does not look like a Calls API call, a Goal Run, or an MCP run. Rather than guess which one it is and read it with the wrong table, nothing has been read.",
          detected: detectSurface(payload as Record<string, unknown>),
        },
        { status: 422 },
      );
    }
    throw error;
  }
}
