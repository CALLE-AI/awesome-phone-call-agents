import { hasLiveCallConfiguration } from "@/lib/live-security";

export function GET() {
  return Response.json(
    { demoAvailable: true, liveAvailable: hasLiveCallConfiguration(process.env) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
