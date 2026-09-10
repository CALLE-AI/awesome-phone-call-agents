import type { WebSearchResult } from "./search-web";

export async function requestWebSearch(
  query: string,
  correlationId: string,
  fetcher: typeof fetch = fetch,
): Promise<WebSearchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 28_000);
  try {
    const response = await fetcher("/api/tools/search-web", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, correlationId }),
      cache: "no-store",
      signal: controller.signal,
    });
    const body = (await response.json()) as WebSearchResult | { error?: string };
    if (!response.ok || !("status" in body) || body.status !== "completed") {
      throw new Error("error" in body && body.error ? body.error : "Web search failed");
    }
    if (body.correlationId !== correlationId) throw new Error("Web search correlation mismatch");
    return body;
  } finally {
    clearTimeout(timeout);
  }
}
