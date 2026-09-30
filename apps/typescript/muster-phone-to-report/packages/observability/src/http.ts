import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

const TRACE_HEADER_NAMES = ["traceparent", "tracestate"] as const;

export async function runSystemHealthHttpSpan<T>(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  operation: () => Promise<T>,
): Promise<T> {
  const carrier: Record<string, string> = {};
  for (const name of TRACE_HEADER_NAMES) {
    const value = headers[name];
    if (typeof value === "string") carrier[name] = value;
  }
  const extracted = propagation.extract(ROOT_CONTEXT, carrier);
  return await context.with(
    extracted,
    async () =>
      await trace.getTracer("@muster/api").startActiveSpan(
        "GET /api/v1/system/health",
        {
          kind: SpanKind.SERVER,
          attributes: {
            "http.request.method": "GET",
            "http.route": "/api/v1/system/health",
          },
        },
        async (span) => {
          try {
            return await operation();
          } catch (error: unknown) {
            if (error instanceof Error) span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        },
      ),
  );
}
