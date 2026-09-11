const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function envValue(name: string): string | undefined {
  const value = (process.env as Record<string, string | undefined>)[name];
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function geminiApiKey(): string | null {
  return envValue("GEMINI_API_KEY") || null;
}

export function geminiConfigured(): boolean {
  return Boolean(geminiApiKey());
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    return JSON.parse(fenced);
  }
}

export async function generateGeminiJson<T = unknown>(prompt: string, timeoutMs = 20_000): Promise<T | null> {
  const key = geminiApiKey();
  if (!key) return null;

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok) {
    console.warn(`[sundials] Gemini ${GEMINI_MODEL} returned ${res.status}`);
    return null;
  }
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = body.candidates?.[0]?.content?.parts || [];
  const text = [...parts].reverse().find((part) => part.text?.trim())?.text;
  if (!text) return null;
  try {
    return parseJsonText(text) as T;
  } catch {
    return null;
  }
}
