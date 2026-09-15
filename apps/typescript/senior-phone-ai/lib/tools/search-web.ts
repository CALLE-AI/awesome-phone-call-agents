export const WEB_SEARCH_MODEL = "gpt-5.6-luna";
export const WEB_SEARCH_TIMEOUT_MS = 25_000;
export const MAX_SEARCH_ANSWER_LENGTH = 4_000;

export type WebSearchSource = Readonly<{ title: string; url: string }>;
export type WebSearchResult = Readonly<{
  answer: string;
  correlationId: string;
  query: string;
  retrievedAt: string;
  sources: WebSearchSource[];
  status: "completed";
}>;

export function describeWebSearchProviderError(value: unknown): string {
  if (!value || typeof value !== "object") return "provider_error";
  const record = value as Record<string, unknown>;
  if (typeof record.status === "number" && Number.isInteger(record.status)) {
    return `provider_http_${record.status}`;
  }
  if (typeof record.code === "string" && /^[a-z0-9_.-]{1,64}$/iu.test(record.code)) {
    return record.code;
  }
  if (typeof record.name === "string" && /^[a-z][a-z0-9]{0,63}$/iu.test(record.name)) {
    return `provider_${record.name.toLowerCase()}`;
  }
  const constructorName = value.constructor?.name;
  if (typeof constructorName === "string" && /^[a-z][a-z0-9]{0,63}$/iu.test(constructorName)) {
    return `provider_${constructorName.toLowerCase()}`;
  }
  return "provider_error";
}

export function parseSearchRequest(value: unknown): { correlationId: string; query: string } {
  if (!value || typeof value !== "object") throw new Error("Search request must be an object");
  const record = value as Record<string, unknown>;
  const query = typeof record.query === "string" ? record.query.trim() : "";
  const correlationId = typeof record.correlationId === "string" ? record.correlationId : "";
  if (query.length < 3 || query.length > 800) throw new Error("Search query must contain 3 to 800 characters");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(correlationId)) {
    throw new Error("Search correlation ID must be a UUID v4");
  }
  return { correlationId, query };
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function extractWebSearchSources(output: unknown): WebSearchSource[] {
  const cited = new Map<string, WebSearchSource>();
  const discovered = new Map<string, WebSearchSource>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const url = safeUrl(record.url);
    if (url) {
      const rawTitle = typeof record.title === "string" ? record.title.trim() : "Source";
      const source = { title: rawTitle.slice(0, 160) || "Source", url };
      if (record.type === "url_citation") cited.set(url, source);
      else if (!discovered.has(url)) discovered.set(url, source);
    }
    Object.values(record).forEach(visit);
  };
  visit(output);
  return [...cited.values(), ...discovered.values()]
    .filter((source, index, sources) => sources.findIndex((item) => item.url === source.url) === index)
    .slice(0, 5);
}

export function createWebSearchResult(input: {
  answer: string;
  correlationId: string;
  query: string;
  retrievedAt?: string;
  sources: WebSearchSource[];
}): WebSearchResult {
  const rawAnswer = input.answer.trim();
  const clipped = rawAnswer.slice(0, MAX_SEARCH_ANSWER_LENGTH - 1);
  const boundary = Math.max(clipped.lastIndexOf("\n"), clipped.lastIndexOf(". "), clipped.lastIndexOf(" "));
  const answer = rawAnswer.length <= MAX_SEARCH_ANSWER_LENGTH
    ? rawAnswer
    : `${clipped.slice(0, Math.max(boundary, 1)).trimEnd()}…`;
  if (!answer) throw new Error("Search returned no answer");
  return {
    answer,
    correlationId: input.correlationId,
    query: input.query,
    retrievedAt: input.retrievedAt ?? new Date().toISOString(),
    sources: input.sources.slice(0, 5),
    status: "completed",
  };
}
