import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";

/**
 * Every /api route (including the /simulate/* triggers) requires this
 * bearer token. Without it, anyone who can reach the server could read
 * contact phone numbers/transcripts or place live calls when dry-run is
 * disabled.
 */
export const requireApiKey: RequestHandler = (request, response, next) => {
  const header = request.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!constantTimeEquals(provided, env.ADMIN_API_KEY)) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
};

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Compare bufB against itself when lengths differ so this branch takes
  // roughly the same time as the equal-length case, rather than returning
  // immediately and leaking the expected key length via timing.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufB, bufB);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
