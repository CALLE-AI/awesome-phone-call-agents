/**
 * Evidence binding.
 *
 * The extraction proposes; the transcript decides. A question counts as
 * answered only when a callee turn supports it, and only when that turn came
 * after the caller actually asked. An answer nobody can be quoted saying comes
 * back as `null` — and if the provider claimed one anyway, that is recorded
 * against the provider's name rather than silently adopted.
 */

import type { BoundAnswer, Question, Turn } from './types';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'do', 'does', 'did', 'you', 'your', 'i', 'we',
  'to', 'for', 'of', 'on', 'at', 'in', 'and', 'or', 'can', 'could', 'would',
  'please', 'hello', 'hi', 'am', 'be', 'it', 'this', 'that', 'have', 'has',
  'with', 'what', 'when', 'how', 'if', 'any', 'there', 'they', 'me', 'my',
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function overlap(a: string, b: string): number {
  const wordsA = new Set(contentWords(a));
  const wordsB = contentWords(b);
  if (wordsA.size === 0 || wordsB.length === 0) return 0;
  const hits = wordsB.filter((w) => wordsA.has(w)).length;
  return hits / wordsA.size;
}

/** A callee turn that declines to answer is not an answer. */
const NON_ANSWER =
  /^\s*(?:er+|um+|uh+|hmm+|hold on|one moment|just a (?:sec|moment|minute)|bear with me|let me (?:check|see|look))\b/i;

const ASK_THRESHOLD = 0.34;

/**
 * Find the caller turn that asked this question.
 *
 * Where one caller turn puts two things to the callee, the answer belongs to
 * the one asked last — so the *latest* clause is what gets matched.
 */
function findAskIndex(turns: Turn[], question: Question): number {
  let best = -1;
  let bestScore = ASK_THRESHOLD;

  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    if (turn.speaker !== 'caller') continue;

    const clauses = turn.text.split(/(?<=[.?!])\s+/).filter(Boolean);
    const lastClauseFirst = [...clauses].reverse();

    for (const clause of lastClauseFirst) {
      const score = overlap(question.ask, clause);
      if (score >= bestScore) {
        bestScore = score;
        best = i;
        break;
      }
    }
  }

  return best;
}

export interface ProviderClaim {
  question_id: string;
  answer: string;
}

export function bindAnswers(
  questions: Question[],
  turns: Turn[],
  providerClaims: ProviderClaim[] = [],
): BoundAnswer[] {
  return questions.map((question) => {
    const claim = providerClaims.find((c) => c.question_id === question.id);
    const askIndex = findAskIndex(turns, question);

    const base: BoundAnswer = {
      question_id: question.id,
      question: question.ask,
      answer: null,
      supporting_turn: null,
      provider_claimed_unsupported: false,
    };

    if (askIndex === -1) {
      return {
        ...base,
        provider_claimed_unsupported: Boolean(claim),
      };
    }

    for (let i = askIndex + 1; i < turns.length; i += 1) {
      const turn = turns[i];
      if (turn.speaker === 'caller') {
        // The caller moved on; anything later answers a different question.
        break;
      }
      if (NON_ANSWER.test(turn.text)) continue;

      return {
        ...base,
        answer: claim?.answer ?? turn.text,
        supporting_turn: turn.text,
      };
    }

    return {
      ...base,
      provider_claimed_unsupported: Boolean(claim),
    };
  });
}

/** Which budget lines the caller actually spent. */
export function disclosedFromBudget(turns: Turn[], budget: string[]): string[] {
  const callerSpeech = turns
    .filter((t) => t.speaker === 'caller')
    .map((t) => t.text)
    .join(' ');

  return budget.filter((item) => overlap(item, callerSpeech) >= 0.5);
}
