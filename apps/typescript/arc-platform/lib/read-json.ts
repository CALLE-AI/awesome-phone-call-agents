/**
 * Read a JSON API response without ever surfacing a parse error to the user.
 *
 * Two things can put a non-JSON body on the wire even though every route of
 * ours returns JSON:
 *
 *   - a serverless function that exceeds its `maxDuration` is killed before
 *     any of our code runs, and Vercel serves its own page; and
 *   - middleware can redirect an unauthenticated request to /sign-in, which
 *     answers with HTML.
 *
 * Both used to reach `JSON.parse` and surface as
 * `Unexpected token 'A', "An error o"...` or `Unexpected token '<'` - a V8
 * diagnostic presented as if it were the call's outcome. This returns a
 * result the caller can branch on instead, with a message written for the
 * person reading it.
 */

import { deepMaskPhones } from "./mask";
export interface JsonRead<T> {
  /** True only for a 2xx response that parsed as JSON. */
  ok: boolean;
  status: number;
  data: T | null;
  /** User-facing text. Null when `data` parsed, whatever the status. */
  error: string | null;
}

/** What to say when the body was not JSON at all. The status is the only
 *  honest signal available, so the wording turns on it. */
function nonJsonMessage(status: number): string {
  if (status === 504 || status === 408) {
    return "The server took too long to answer. If a call did start, it will still appear in the call history.";
  }
  if (status === 401 || status === 403) {
    return "Your session has expired. Reload the page and sign in again.";
  }
  if (status >= 500) {
    return `The server returned an unexpected response (${status}). Nothing was recorded — please try again.`;
  }
  return `The server returned an unexpected response (${status}).`;
}

export async function readJson<T = unknown>(res: Response): Promise<JsonRead<T>> {
  /* Defensive by design: a helper whose whole job is to stop an exception
     reaching the user must not become a new source of one. Anything that is
     not a well-formed Response falls through to the JSON attempt below rather
     than throwing on a missing `headers`. */
  const type = res.headers?.get?.("content-type") ?? "";
  if (type && !type.toLowerCase().includes("application/json")) {
    /* Read and discard the body so the connection closes cleanly, and log the
       first of it - the platform's own words are useful to us, never to the
       user. */
    const body = await res.text().catch(() => "");
    /* A provider's HTML error page can quote the request, destination and
       all. Masked before it is written down. */
    if (body) console.warn(`Non-JSON response (${res.status}):`, deepMaskPhones(body.slice(0, 200)));
    return { ok: false, status: res.status, data: null, error: nonJsonMessage(res.status) };
  }
  try {
    const data = (await res.json()) as T;
    return { ok: res.ok, status: res.status, data, error: null };
  } catch {
    /* Content-Type claimed JSON and the body was not - truncated or empty. */
    return { ok: false, status: res.status, data: null, error: nonJsonMessage(res.status) };
  }
}
