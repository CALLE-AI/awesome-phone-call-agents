export async function GET() {
  return Response.json({
    status: "ok",
    database: "configured",
    call_provider: "fake",
    live_calls_enabled: false,
    external_calls_created: 0,
  });
}
