// GET /api/matters — matter types for the form and the review page (labels, blurbs, per-type field names)
import { json } from "../_lib.js";
import { mattersForClient } from "../_matters.js";

export async function onRequestGet() {
  return json({ matters: mattersForClient() }, 200, { "cache-control": "public, max-age=300" });
}
