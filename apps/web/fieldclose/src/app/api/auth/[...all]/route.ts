export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAuthRequest(request);
}

export async function POST(request: Request) {
  return handleAuthRequest(request);
}

async function handleAuthRequest(request: Request) {
  const { auth } = await import("@/auth");
  return auth.handler(request);
}
