import { getCalleCapabilities } from "../runtime";

export async function GET() {
  return Response.json(getCalleCapabilities(), {
    headers: { "cache-control": "no-store" },
  });
}
