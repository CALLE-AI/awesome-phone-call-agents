// Deterministic synthesis of transcripts, structured results, and evidence.
// Everything here is seeded from the call id, so a scenario always replays the
// same way. No network access, no credentials, no real calls.

/** @param {string} text @returns {number} */
export function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Small deterministic PRNG (mulberry32) so results are reproducible per call.
 * @param {number} seed @returns {() => number} */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {() => number} rng @param {number} min @param {number} max @returns {number} */
function pickIndex(rng, max) {
  return Math.min(max - 1, Math.floor(rng() * max));
}

const USER_CONFIRMATIONS = [
  "Yes, that works for me.",
  "Yes, I can do that.",
  "Sure, that is fine.",
  "Yes, I confirm.",
];

const USER_NEGATIONS = [
  "No, that does not work for me.",
  "Sorry, I cannot do that.",
];

const BOT_GREETINGS = [
  "Hi, I am an AI assistant calling on behalf of the task requester.",
  "Hello, this is an AI assistant calling about a request.",
];

const BOT_CLOSINGS = [
  "Thank you. Just to confirm, I have recorded your answer.",
  "Thanks for confirming. Have a good day.",
];

/**
 * First sentence of the task text, quoted into the transcript so the goal and
 * the transcript stay visibly connected.
 * @param {string} task @returns {string} */
function taskSummary(task) {
  const first = String(task).split(/(?<=[.!?])\s/)[0] ?? String(task);
  const trimmed = first.trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}

/**
 * @param {string} task
 * @param {() => number} rng
 * @param {"confirm" | "decline"} mode
 * @returns {{ offset_seconds: number, speaker: "bot" | "user", text: string }[]}
 */
export function synthTranscript(task, rng, mode = "confirm") {
  const summary = taskSummary(task);
  const greeting = BOT_GREETINGS[pickIndex(rng, BOT_GREETINGS.length)];
  const pool = mode === "confirm" ? USER_CONFIRMATIONS : USER_NEGATIONS;
  const userLine = pool[pickIndex(rng, pool.length)];
  const closing = BOT_CLOSINGS[pickIndex(rng, BOT_CLOSINGS.length)];
  return [
    { offset_seconds: 0, speaker: "bot", text: `${greeting} The request is: ${summary}` },
    { offset_seconds: 4, speaker: "user", text: userLine },
    { offset_seconds: 8, speaker: "bot", text: closing },
  ];
}

/**
 * Fill a JSON-schema-like object with deterministic synthetic values.
 * Only `properties` / `required` are honored; unknown keywords are ignored.
 * @param {unknown} schema
 * @param {() => number} rng
 * @returns {Record<string, unknown> | null}
 */
export function fillSchema(schema, rng) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, definition] of Object.entries(properties)) {
    if (!definition || typeof definition !== "object") continue;
    const def = /** @type {Record<string, unknown>} */ (definition);
    if (Array.isArray(def.enum) && def.enum.length > 0) {
      out[key] = def.enum[pickIndex(rng, def.enum.length)];
    } else if (def.type === "integer") {
      out[key] = 1;
    } else if (def.type === "number") {
      out[key] = 1.5;
    } else if (def.type === "boolean") {
      out[key] = true;
    } else {
      out[key] = `synthetic_${key}_${Math.floor(rng() * 1000).toString().padStart(3, "0")}`;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Evidence strings must quote turns the recipient actually spoke, so clients
 * that verify evidence anchoring against the transcript find a real match.
 * @param {{ offset_seconds: number, speaker: string, text: string }[]} transcript
 * @returns {string[]}
 */
export function synthEvidence(transcript) {
  const userTurns = transcript.filter((turn) => turn.speaker === "user");
  if (userTurns.length === 0) return [];
  return userTurns.slice(0, 2).map((turn) => `The recipient said: "${turn.text}"`);
}
