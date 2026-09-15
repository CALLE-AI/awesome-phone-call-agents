import { NextResponse } from "next/server";

import { deepMaskPhones } from "./mask";

/**
 * Guarantee a JSON body on every path out of a route handler.
 *
 * A route that throws before reaching its own catch - `auth()` was the one
 * that mattered here, since it sat outside the try block in all three call
 * routes - never returns JSON at all. Next hands the error to the platform,
 * and on Vercel the client receives an error page whose body begins
 * "An error occurred with this application.". `res.json()` then throws
 * `Unexpected token 'A', "An error o"... is not valid JSON`, and that V8
 * message was being shown to users as though it were the reason the call
 * failed.
 *
 * NOTE: this cannot catch a function TIMEOUT. When Vercel kills the
 * invocation no JavaScript of ours runs at all, so the platform page is
 * returned regardless. The client-side guard in `readJson` is what covers
 * that case; the two are complementary, not alternatives.
 */
export function withJson<T extends unknown[]>(
  handler: (...args: T) => Promise<Response>
) {
  return async (...args: T): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Unhandled route error:", deepMaskPhones(message));
      return NextResponse.json({ error: message || "Server error" }, { status: 500 });
    }
  };
}
