import type { Bar } from "./rank";

export type Request = {
  prompt: string; // what the user typed
  goal: string; // instruction for the phone agent
  bar: Bar; // what to optimize
  category: string; // OSM shop tag, e.g. "hairdresser", "car_repair"
  location: string | null; // city / area name, if given
  budget: number | null; // target price, if the user gave one
};

// Pull a target price out of the request, e.g. "under $40", "less than 30",
// "$25 budget". Returns null if none is stated.
export function parseBudget(prompt: string): number | null {
  const m = prompt.match(/(?:under|below|less than|max|budget|around|about|for)\s*\$?\s*(\d{1,5})/i)
    ?? prompt.match(/\$\s*(\d{1,5})/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Strip any budget/target price out of the request, so the opening pitch talks
// about the service only and never reveals the customer's budget upfront.
export function stripBudget(prompt: string): string {
  const cleaned = prompt
    .replace(/\b(?:under|below|less than|max|budget|around|about|for)\s*\$?\s*\d{1,5}\b/gi, "")
    .replace(/\$\s*\d{1,5}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || prompt;
}

function buildGoal(prompt: string): string {
  const service = stripBudget(prompt);
  return (
    `You are calling a local business on behalf of a customer. Introduce yourself ` +
    `as calling on the customer's behalf, then ask their price for ${service}, whether ` +
    `they can do it, and how soon. Do not mention any budget or target price yet.`
  );
}

// Fallback parser: no LLM needed. Guesses bar from intent words.
function ruleBased(prompt: string): Request {
  const p = prompt.toLowerCase();
  let bar: Bar = "value"; // default: best overall deal
  if (/\b(soon|soonest|fast|fastest|quick|quickest|asap|now|earliest)\b/.test(p)) bar = "soonest";
  else if (/\b(cheap|cheapest|budget|lowest|affordable)\b/.test(p)) bar = "cheapest";
  return { prompt, goal: buildGoal(prompt), bar, category: "hairdresser", location: null, budget: parseBudget(prompt) };
}

// Groq (OpenAI-compatible) structured extraction.
async function llmParse(prompt: string): Promise<Request | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Extract fields from a request to call local businesses. Reply ONLY with JSON " +
              '{"category": string, "location": string|null, "bar": "value"|"cheapest"|"soonest"}. ' +
              "category is an OpenStreetMap shop/amenity tag such as hairdresser, car_repair, " +
              "bakery, florist, restaurant. bar is what the user cares about most: " +
              '"cheapest" if they stress price, "soonest" if they stress speed, otherwise "value" ' +
              "(the best overall deal).",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    const j = (await res.json()) as any;
    const data = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
    const bar: Bar =
      data.bar === "soonest" ? "soonest" : data.bar === "cheapest" ? "cheapest" : "value";

    return {
      prompt,
      goal: buildGoal(prompt),
      bar,
      category: typeof data.category === "string" ? data.category : "hairdresser",
      location: typeof data.location === "string" ? data.location : null,
      budget: parseBudget(prompt),
    };
  } catch {
    return null;
  }
}

// Parse a natural request. Uses the LLM if a key is set, else rule-based.
export async function parseRequest(prompt: string): Promise<Request> {
  return (await llmParse(prompt)) ?? ruleBased(prompt);
}
