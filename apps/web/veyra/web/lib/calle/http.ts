export class CallHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CallHttpError";
  }
}

const MAX_BODY_BYTES = 32_000;

export async function readCallJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new CallHttpError(415, "content-type must be application/json");
  }

  const advertisedLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_BODY_BYTES) {
    throw new CallHttpError(413, "request body is too large");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new CallHttpError(413, "request body is too large");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new CallHttpError(400, "request body must be valid JSON");
  }
}
