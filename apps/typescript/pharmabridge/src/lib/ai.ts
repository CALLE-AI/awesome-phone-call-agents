// Optional real-time AI helpers over OpenAI-compatible endpoints (Groq first, then Cerebras). They
// only turn free text into form fields for the operator to review, and reword verified facts for
// sharing. They never decide availability, never pick a drug or blood group on their own, and never
// touch the CALL-E briefs or results.

interface Provider {
  name: string;
  url: string;
  key: string;
  /** Configured model first, then fallbacks, because hosted model names are retired often. */
  models: string[];
}

const unique = (values: Array<string | undefined>) => [...new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v)))];

// Remembers the model that last answered for each provider, so retired models are skipped next time.
const holder = globalThis as unknown as { __pharmabridgeAiModels?: Map<string, string> };
const workingModels = (holder.__pharmabridgeAiModels ??= new Map());

function providers(): Provider[] {
  const list: Provider[] = [];
  const groqModels = unique([process.env.GROQ_MODEL, "openai/gpt-oss-120b", "llama-3.1-8b-instant"]);
  [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY2].forEach((key, i) => {
    if (key?.trim()) list.push({ name: i === 0 ? "Groq" : "Groq (backup key)", url: "https://api.groq.com/openai/v1/chat/completions", key: key.trim(), models: groqModels });
  });
  if (process.env.CEREBRAS_API_KEY?.trim()) {
    list.push({
      name: "Cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      key: process.env.CEREBRAS_API_KEY.trim(),
      models: unique([process.env.CEREBRAS_MODEL, "gpt-oss-120b", "llama3.1-8b"]),
    });
  }
  return list;
}

export function aiProvider(): string | null {
  const first = providers()[0];
  return first ? `${first.name.replace(" (backup key)", "")} · ${workingModels.get(first.name) ?? first.models[0]}` : null;
}

/** Runs one JSON-mode chat completion, falling through models and providers on errors or rate limits. */
export async function chatJson(system: string, user: string): Promise<{ data: unknown; provider: string }> {
  let lastError: unknown = new Error("No AI provider is configured.");
  for (const p of providers()) {
    const remembered = workingModels.get(p.name);
    const models = remembered ? unique([remembered, ...p.models]) : p.models;
    for (const model of models) {
      try {
        const res = await fetch(p.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 404 || res.status === 400) {
          lastError = new Error(`${p.name} rejected model ${model} (HTTP ${res.status})`);
          continue; // retired or unsupported model: try the next one
        }
        if (!res.ok) {
          lastError = new Error(`${p.name} returned HTTP ${res.status}`);
          break; // auth or rate limit: try the next provider
        }
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const data = JSON.parse(json.choices?.[0]?.message?.content ?? "");
        workingModels.set(p.name, model);
        return { data, provider: `${p.name.replace(" (backup key)", "")} · ${model}` };
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI request failed.");
}
