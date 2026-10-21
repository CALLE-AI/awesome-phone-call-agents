import { GoogleGenAI, Type, ThinkingLevel, type Schema } from '@google/genai';
import { clarifyingQuestionSchema, type ClarifyingQuestion, type DialTask } from '@dial/schemas';
import { sanitizeExternalText, UNTRUSTED_CONTENT_POLICY, wrapUntrusted } from '@dial/domain';
import { logger, timed } from '@dial/observability';

/**
 * The intake step: a handful of questions asked once, before any work starts.
 *
 * This is not the model interrupting whenever something occurs to it — that is
 * suppressed elsewhere, deliberately. These are generated once, capped at five,
 * and every one has to earn its place by changing either *who gets called* or
 * *what they get asked*. A question whose answer would change neither is noise,
 * and the user can skip the whole step regardless.
 */

export interface QuestionGeneratorInput {
  instruction: string;
  task: DialTask;
}

export interface QuestionGenerator {
  readonly name: string;
  generate(input: QuestionGeneratorInput): Promise<ClarifyingQuestion[]>;
}

const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 5;

const OUTPUT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      description: `Between ${MIN_QUESTIONS} and ${MAX_QUESTIONS} questions.`,
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.STRING,
            description: 'Short snake_case identifier, e.g. "device_model".',
          },
          question: {
            type: Type.STRING,
            description: 'The question, addressed to the customer in plain language.',
          },
          why: {
            type: Type.STRING,
            description: 'Six words or fewer on what this changes. e.g. "Affects the price quoted".',
          },
          options: {
            type: Type.ARRAY,
            description: 'Up to 5 likely answers, offered as one-tap choices. May be empty.',
            items: { type: Type.STRING },
          },
          required: {
            type: Type.BOOLEAN,
            description: 'True only if the call is close to pointless without it.',
          },
        },
        required: ['id', 'question', 'why', 'options', 'required'],
        propertyOrdering: ['id', 'question', 'why', 'options', 'required'],
      },
    },
  },
  required: ['questions'],
};

const SYSTEM_PROMPT = `You prepare a short intake questionnaire for Dial, a service that telephones businesses on a customer's behalf.

${UNTRUSTED_CONTENT_POLICY}

Dial has already understood the request. Your job is to ask the ${MIN_QUESTIONS}-${MAX_QUESTIONS} questions that would most improve the outcome.

A good question changes one of exactly two things:
  1. WHO gets called — a brand, a type of business, an area, how far the customer will travel.
  2. WHAT they get asked — the specific model, the fault, the date and time, the party size, the budget, the trade-offs the customer cares about.

Rules:
- Ask what the business will inevitably ask, so Dial can answer instead of calling back. For a phone repair that is the exact model and what is broken.
- Ask about trade-offs the customer alone can decide: cheapest versus fastest, original parts versus cheaper equivalents, today versus this week.
- Offer likely answers in "options" wherever a short list covers most cases. Prefer concrete values ("iPhone 13", "Cracked screen") over vague ones ("Other").
- Keep each question under fifteen words. One idea per question.
- NEVER ask for anything Dial already knows from the request — check it before asking.
- NEVER ask for personal or sensitive details: no full name, address, date of birth, account numbers, card details, medical history.
- NEVER ask which businesses to call, how many to call, or anything about how Dial works. That is Dial's job.
- Mark "required" true only when the call would be close to pointless without an answer. Usually that is at most one question, often none.

Return only the structured object.`;

export class GeminiQuestionGenerator implements QuestionGenerator {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;
  private readonly models: string[];

  constructor(apiKey: string, model: string, fallbackModels: string[] = []) {
    this.client = new GoogleGenAI({ apiKey });
    this.models = [model, ...fallbackModels.filter((m) => m && m !== model)];
  }

  async generate(input: QuestionGeneratorInput): Promise<ClarifyingQuestion[]> {
    const known = {
      objective: input.task.objective,
      domain: input.task.domain,
      lookingFor: input.task.searchQuery,
      location: input.task.location?.raw ?? null,
      budget: input.task.constraints.budget,
      date: input.task.constraints.date,
      time: input.task.constraints.timeWindow?.earliest ?? null,
      partySize: input.task.constraints.partySize,
      alreadyKnown: input.task.constraints.additional,
    };

    const prompt = [
      'What Dial already understands about this request (do NOT ask about any of it again):',
      JSON.stringify(known, null, 2).slice(0, 1500),
      '',
      'The customer wrote:',
      wrapUntrusted('customer request', input.instruction, 1000),
    ].join('\n');

    for (const model of this.models) {
      try {
        const response = await timed('ai.questions', { model }, async () =>
          this.client.models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction: SYSTEM_PROMPT,
              responseMimeType: 'application/json',
              responseSchema: OUTPUT_SCHEMA,
              temperature: 0.2,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              maxOutputTokens: 4000,
            },
          }),
        );

        if (response.promptFeedback?.blockReason) return [];
        const text = response.text;
        if (!text) continue;

        return parseQuestions(text);
      } catch (error) {
        const status = (error as { status?: number })?.status;
        logger.warn('question generation failed', { model, status: status ?? null });
        // Overloaded models are worth retrying elsewhere; anything else is not.
        if (![429, 500, 502, 503, 504, undefined].includes(status)) break;
      }
    }

    // Intake is an enhancement, not a gate. If it cannot be produced, the task
    // proceeds without it rather than failing.
    return [];
  }
}

/** Exported for testing: validates, sanitises and caps whatever came back. */
export function parseQuestions(text: string): ClarifyingQuestion[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }

  const list = (raw as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const out: ClarifyingQuestion[] = [];

  for (const entry of list) {
    const parsed = clarifyingQuestionSchema.safeParse({
      ...(entry as object),
      // Model output is external text: sanitise before it is ever rendered.
      question: sanitizeExternalText((entry as { question?: unknown })?.question, 200),
      why: sanitizeExternalText((entry as { why?: unknown })?.why, 120) || null,
      options: Array.isArray((entry as { options?: unknown })?.options)
        ? ((entry as { options: unknown[] }).options)
            .map((o) => sanitizeExternalText(o, 80))
            .filter(Boolean)
            .slice(0, 6)
        : [],
    });
    if (!parsed.success) continue;

    const question = parsed.data;
    if (!question.question) continue;
    // Duplicate ids would collide when answers are keyed on them.
    if (seen.has(question.id)) continue;
    seen.add(question.id);

    out.push(question);
    if (out.length >= MAX_QUESTIONS) break;
  }

  // Fewer than the minimum is fine — better a short questionnaire than padding
  // it with questions that change nothing.
  return out;
}
