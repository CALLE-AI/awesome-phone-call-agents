import { hasLiveCallConfiguration } from "@/lib/live-call-security";

export function GET() {
  return Response.json(
    {
      demoAvailable: true,
      liveAvailable: hasLiveCallConfiguration(process.env),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
