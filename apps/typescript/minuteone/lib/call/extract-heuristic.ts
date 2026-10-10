import type { JsonSchema } from "./provider";
import type { CallText } from "./extract";

/**
 * No-AI fallback for turning a real call's transcript back into the flat answer shape
 * scoreAnswers()/mapResult() expect (see extract.ts for why this is needed at all: CALL-E's real
 * `extracted` never contains it). Keyword/regex matching against the transcript — no external
 * calls, no credentials. Deliberately a fallback, not the primary path: it's fragile on messy
 * real speech (mis-transcribed words, reordered/re-asked questions) in ways an LLM pass isn't.
 */
export function extractStructuredAnswersHeuristically(
  resultSchema: JsonSchema,
  callText: CallText,
): Record<string, unknown> {
  const turns = parseTranscript(callText.transcript ?? "");
  const userText = turns
    .filter((t) => t.speaker === "USER")
    .map((t) => t.text)
    .join(" ");
  const properties = (resultSchema.properties ?? {}) as Record<string, JsonSchema>;

  const questionFields = Object.entries(properties).filter(([key]) => !META_FIELDS.has(key));
  const answers: Record<string, unknown> = {};
  let answeredCount = 0;

  for (const [key, schema] of questionFields) {
    const value = extractQuestionField(schema, turns);
    answers[key] = value;
    if (value !== null) answeredCount += 1;
  }

  const reachedPerson = turns.some((t) => t.speaker === "USER" && t.text.trim().length > 0);
  const declined = DECLINE_RE.test(userText);
  // Distinguishing "asked to be called back instead of continuing" from an answer that merely
  // mentions a callback time (e.g. best_callback_window) needs real context an LLM has and this
  // doesn't — approximated here as "callback language present, but most questions still went
  // unanswered", so a normal completed conversation isn't mislabeled just because someone asked
  // for a morning callback on the technician visit itself.
  const wantsCallbackLater =
    !declined && CALLBACK_LATER_RE.test(userText) && answeredCount < Math.ceil(questionFields.length / 2);

  return {
    ...answers,
    reached_person: reachedPerson,
    declined_conversation: declined,
    wants_callback_later: wantsCallbackLater,
  };
}

const META_FIELDS = new Set(["reached_person", "declined_conversation", "wants_callback_later"]);

const DECLINE_RE = /\b(not interested|stop calling|don'?t call|remove me|no thanks?,?\s*bye|leave me alone)\b/i;
const CALLBACK_LATER_RE = /\b(call (me )?(back|later|again)|another time|not (a )?good time|busy right now)\b/i;
const AFFIRMATIVE_RE = /\b(yes|yeah|yep|yup|sure|fine|okay|ok|good|works|sounds good|no problem|that works)\b/i;
const NEGATIVE_RE = /\b(no\b|nope|nah|not (really|interested|okay|fine)|can'?t|cannot|won'?t|too (much|high|expensive))\b/i;

interface Turn {
  speaker: "BOT" | "USER";
  text: string;
}

/** Groups consecutive same-speaker transcript lines (e.g. "[00:00:12] BOT: ...") into turns. */
function parseTranscript(transcript: string): Turn[] {
  const lineRe = /^\[\d{2}:\d{2}:\d{2}\]\s*(BOT|USER):\s*(.*)$/;
  const turns: Turn[] = [];

  for (const rawLine of transcript.split("\n")) {
    const line = rawLine.trim();
    const match = line.match(lineRe);
    if (!match) continue;
    const [, speaker, text] = match;

    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) {
      last.text += " " + text;
    } else {
      turns.push({ speaker: speaker as "BOT" | "USER", text });
    }
  }

  return turns;
}

function extractQuestionField(schema: JsonSchema, turns: Turn[]): unknown {
  const prompt = String(schema.description ?? "");
  const botIndex = findBestBotTurnIndex(turns, significantWords(prompt));
  const localAnswer = botIndex >= 0 ? turns[botIndex + 1] : undefined;
  const answerText = localAnswer && localAnswer.speaker === "USER" ? localAnswer.text : "";
  const fallbackText = turns
    .filter((t) => t.speaker === "USER")
    .map((t) => t.text)
    .join(" ");

  const enumValues = schema.enum as string[] | undefined;
  if (enumValues && enumValues.length > 0) {
    return matchEnum(answerText, enumValues) ?? matchEnum(fallbackText, enumValues);
  }

  if (schema.type === "boolean") {
    return matchBoolean(answerText) ?? matchBoolean(fallbackText);
  }

  if (schema.type === "number") {
    const match = answerText.match(/\d+(\.\d+)?/) ?? fallbackText.match(/\d+(\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  return answerText.trim() || null;
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "do", "does", "you", "your", "what", "kind", "of", "to", "for",
  "or", "and", "on", "in", "at", "be", "this", "that", "it", "its", "our", "we", "us", "with",
  "would", "did", "have", "has",
]);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** The BOT turn whose wording best overlaps a question's prompt — that's presumed to be where it was asked. */
function findBestBotTurnIndex(turns: Turn[], promptWords: Set<string>): number {
  let bestIndex = -1;
  let bestScore = 0;

  turns.forEach((turn, index) => {
    if (turn.speaker !== "BOT") return;
    const score = overlapScore(promptWords, significantWords(turn.text));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore > 0 ? bestIndex : -1;
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  let score = 0;
  for (const word of a) if (b.has(word)) score += 1;
  return score;
}

function matchEnum(text: string, options: string[]): string | null {
  const normalized = text.toLowerCase();
  for (const option of options) {
    // Enum values are snake_case config identifiers ("this_week") that nobody actually says out
    // loud ("this week") — match on the spoken phrase, not the literal underscored token.
    const optionPhrase = option.toLowerCase().replace(/_/g, " ");
    if (normalized.includes(optionPhrase)) return option;
  }

  const words = normalized.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  for (const option of options) {
    const optionLower = option.toLowerCase().replace(/_/g, "");
    for (const word of words) {
      if (word.length < 3) continue;
      if (levenshteinDistance(word, optionLower) <= 2) return option;
    }
  }

  return null;
}

function matchBoolean(text: string): boolean | null {
  const negative = NEGATIVE_RE.test(text);
  const affirmative = AFFIRMATIVE_RE.test(text);
  if (negative && !affirmative) return false;
  if (affirmative) return true;
  return null;
}

/** Small edit-distance helper for tolerating real speech-to-text mistakes (e.g. "repay" vs "repair"). */
function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) distances[i][0] = i;
  for (let j = 0; j < cols; j++) distances[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + cost,
      );
    }
  }

  return distances[rows - 1][cols - 1];
}
