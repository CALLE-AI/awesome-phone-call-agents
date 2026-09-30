import { NextResponse } from "next/server";

import { CalleApiError, CalleClient } from "asheard/calle";
import { normalizeCallsApi, say } from "asheard/disposition";
import { publicCallView } from "asheard/reconciler";

import { deepMask } from "@/lib/mask";

/**
 * Door one. You paste a key, this fetches the call.
 *
 * The key arrives in a header, is used for one request, and is never written
 * anywhere. Not to a database, not to a cookie, not to a log line. There is no
 * account to attach it to and nothing here that outlives the response.
 *
 * It is also read only, structurally rather than by promise. The only two
 * things this route can do with a key are check it and fetch a call by id.
 * `createCall` exists on the client and is deliberately not reachable from any
 * route in this app, because a web page that can dial a phone by accident is a
 * web page that will.
 */

/** The header the key travels in. Never a query parameter, which would end up in logs. */
const KEY_HEADER = "x-calle-key";

interface Body {
  action?: unknown;
  callId?: unknown;
}

function keyProblem(error: CalleApiError): string | null {
  if (error.status === 401 || error.status === 403) {
    return "That key was refused. Check you copied the whole thing, including the iams_live_ prefix.";
  }
  return null;
}

/** Every response is masked on the way out, whatever it carries. */
function json(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(deepMask(body), init);
}

export async function POST(request: Request): Promise<NextResponse> {
  const apiKey = request.headers.get(KEY_HEADER)?.trim() ?? "";

  if (apiKey === "") {
    return json({ error: "No key on the request." }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "Malformed request." }, { status: 400 });
  }

  const client = new CalleClient({ apiKey });

  if (body.action === "verify") {
    // Reads a call id that cannot exist. A 404 back means the key was accepted
    // and nothing was created. Their own Dify plugin checks a key the same way.
    const result = await client.verifyCredentials();
    return json(result, { status: result.ok ? 200 : 401 });
  }

  if (typeof body.callId !== "string" || body.callId.trim() === "") {
    return json({ error: "Give it a call id." }, { status: 400 });
  }

  try {
    const payload = await client.getCall(body.callId.trim());

    // The Calls API has no way to say whether a result schema was sent with the
    // original request, and this fetch happens long after that request is gone.
    // So `result_schema_requested` stays unset, and a null result reads as
    // `not_requested` rather than as a missing result. Claiming a schema was
    // asked for would be inventing a fact about somebody else's call.
    const disposition = normalizeCallsApi(payload);

    // The call as the page may see it: an allowlisted projection, never the
    // payload, which carries destinations and transcripts.
    return json({ payload: publicCallView(payload), disposition, spoken: say(disposition) });
  } catch (error) {
    if (error instanceof CalleApiError) {
      const problem = keyProblem(error);
      if (problem) return json({ error: problem }, { status: 401 });

      if (error.code === "not_found") {
        return json(
          {
            error:
              "No call with that id on this key. The Calls API has no endpoint that lists your calls, so there is no way to go looking for it from here.",
          },
          { status: 404 },
        );
      }

      return json({ error: `${error.code}: ${error.message}` }, { status: 502 });
    }

    return json(
      { error: "Could not reach CALL-E. That is a connection problem, not a call problem." },
      { status: 502 },
    );
  }
}
