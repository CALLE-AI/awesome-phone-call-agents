import OpenAI from "openai";

// Lazily constructed: the OpenAI client throws synchronously if apiKey is
// missing/empty, and we want that to be caught by classifyEmail's try/catch
// (falling back to defaults) rather than crashing at module load time.
let openrouter: OpenAI | undefined;

function getOpenRouterClient(): OpenAI {
  if (!openrouter) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    console.log(
      `[openrouter] constructing client; OPENROUTER_API_KEY length: ${apiKey?.length ?? 0}`
    );
    openrouter = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey,
    });
  }
  return openrouter;
}

// NOTE: "google/gemini-2.0-flash-001" has been retired from OpenRouter's
// catalog (calls returned 404 "No endpoints found for
// google/gemini-2.0-flash-001"). google/gemini-2.5-flash is the current
// stable flash-tier equivalent as of this writing.
const CLASSIFICATION_MODEL = "google/gemini-2.5-flash";

function buildSystemPrompt(): string {
  const todayIso = new Date().toISOString();

  return `You classify emails for a voice assistant that reads updates aloud to someone who is blind or elderly. Given an email's subject and body, classify it and return JSON only, with exactly these fields and no others:

{
  "category": one of "bill" | "loan" | "government" | "insurance" | "promotional" | "other",
  "urgency": one of "high" | "medium" | "low",
  "summary": a one-sentence plain-language summary suitable for reading aloud to someone who is blind or elderly, avoiding jargon,
  "dueDate": an ISO date string (YYYY-MM-DD) if the email mentions a specific due date, otherwise null
}

Today's date is ${todayIso}. If the email mentions a due date without stating a year, infer the year using today's date: assume the nearest upcoming occurrence of that month/day (i.e. if that month/day has already passed this year, use next year; otherwise use this year).

Return only the JSON object. No commentary, no markdown formatting.`;
}

export interface EmailClassification {
  category: string;
  urgency: string;
  summary: string;
  dueDate: string | null;
  // True when this is a fallback result (API call or parsing failed),
  // rather than a real classification from the model.
  classificationFailed: boolean;
}

function fallbackClassification(subject: string): EmailClassification {
  return {
    category: "other",
    urgency: "low",
    summary: subject,
    dueDate: null,
    classificationFailed: true,
  };
}

/**
 * Classifies an email's subject/body via OpenRouter, returning a category,
 * urgency, plain-language summary, and due date (if any). Falls back to
 * sensible defaults if the API call fails or returns unparseable JSON, so
 * callers never have to handle a thrown error here.
 */
export async function classifyEmail(
  subject: string,
  body: string
): Promise<EmailClassification> {
  console.log(`[classifyEmail] called for subject: "${subject}"`);

  try {
    const completion = await getOpenRouterClient().chat.completions.create({
      model: CLASSIFICATION_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: `Subject: ${subject}\n\nBody: ${body}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      throw new Error("OpenRouter returned an empty response");
    }

    const parsed = JSON.parse(content) as Partial<EmailClassification>;

    return {
      category: parsed.category ?? "other",
      urgency: parsed.urgency ?? "low",
      summary: parsed.summary ?? subject,
      dueDate: parsed.dueDate ?? null,
      classificationFailed: false,
    };
  } catch (error) {
    console.error(
      `[classifyEmail] API call failed for "${subject}", falling back to defaults. Raw error:`,
      error
    );
    return fallbackClassification(subject);
  }
}
