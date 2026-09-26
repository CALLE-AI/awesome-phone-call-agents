import { handleDispatch } from "./controller";

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json(
      { code: "invalid_json", message: "The request body must be valid JSON." },
      { status: 400 },
    );
  }

  return handleDispatch(input);
}
