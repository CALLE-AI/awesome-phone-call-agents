/**
 * Request file loading and validation.
 *
 * Two checks here are not ordinary validation. A disclosure item that looks like
 * a card number or a password is refused outright and a question that carries a
 * personal detail nobody authorized is refused before any call can be placed.
 */

import { readFileSync } from "node:fs";
import { blocking, forbiddenDisclosure, unauthorizedFindings } from "./disclosure.js";
import type {
  AnswerShape,
  AuthorizedWindow,
  CommitmentMode,
  DisclosureItem,
  ErrandQuestion,
  ErrandRequest,
  Policy,
  PolicyInput,
} from "./types.js";

export class ConfigError extends Error {}

const E164 = /^\+[1-9]\d{6,14}$/;
const ID = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const ERRAND_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
const LANGUAGE = /^[a-z]{2}(?:-[A-Za-z0-9]{2,8})*$/;

export const LIMITS = {
  perCallTimeoutSeconds: { min: 60, max: 600, default: 300 },
  minConfidence: { min: 0, max: 1, default: 0.5 },
  maxDisclosure: 6,
  maxQuestions: 4,
  maxWindows: 4,
  questionLength: 160,
  goalLength: 200,
} as const;

const COMMITMENTS: CommitmentMode[] = ["none", "slot_within_windows", "confirm_existing"];

function requireString(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigError(`${field} must be a non-empty string.`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new ConfigError(`${field} must be ${max} characters or fewer.`);
  }
  return text;
}

function requireNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ConfigError(`${field} must be a number.`);
  }
  if (value < min || value > max) {
    throw new ConfigError(`${field} must be between ${min} and ${max}. Received ${value}.`);
  }
  return value;
}

function resolvePolicy(input: PolicyInput | undefined): Policy {
  const policy = input ?? {};
  const language = policy.language === undefined ? "en-US" : requireString(policy.language, "policy.language", 12);
  if (!LANGUAGE.test(language)) {
    throw new ConfigError(`policy.language must be a BCP 47 tag such as en-US. Received ${language}.`);
  }
  const leaveVoicemail = policy.leave_voicemail ?? false;
  if (typeof leaveVoicemail !== "boolean") {
    throw new ConfigError("policy.leave_voicemail must be true or false.");
  }
  return {
    language,
    leaveVoicemail,
    perCallTimeoutSeconds:
      policy.per_call_timeout_seconds === undefined
        ? LIMITS.perCallTimeoutSeconds.default
        : requireNumber(
            policy.per_call_timeout_seconds,
            "policy.per_call_timeout_seconds",
            LIMITS.perCallTimeoutSeconds.min,
            LIMITS.perCallTimeoutSeconds.max,
          ),
    minConfidence:
      policy.min_confidence === undefined
        ? LIMITS.minConfidence.default
        : requireNumber(policy.min_confidence, "policy.min_confidence", LIMITS.minConfidence.min, LIMITS.minConfidence.max),
  };
}

function validateDisclosure(value: unknown): DisclosureItem[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ConfigError("disclosure must be an array.");
  }
  if (value.length > LIMITS.maxDisclosure) {
    throw new ConfigError(
      `disclosure lists ${value.length} items. ${LIMITS.maxDisclosure} is the cap: a delegated errand should need a handful of details, not a file.`,
    );
  }
  const items = value.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new ConfigError(`disclosure[${index}] must be an object.`);
    }
    const entry = raw as Record<string, unknown>;
    const key = requireString(entry.key, `disclosure[${index}].key`, 40);
    if (!ID.test(key)) {
      throw new ConfigError(`disclosure[${index}].key must be a lowercase slug.`);
    }
    const item: DisclosureItem = {
      key,
      label: requireString(entry.label, `disclosure[${index}].label`, 60),
      value: requireString(entry.value, `disclosure[${index}].value`, 120),
    };
    const refusal = forbiddenDisclosure(item);
    if (refusal !== null) {
      throw new ConfigError(`disclosure[${index}]: ${refusal}`);
    }
    return item;
  });
  if (new Set(items.map((item) => item.key)).size !== items.length) {
    throw new ConfigError("disclosure keys must be unique.");
  }
  return items;
}

function validateQuestions(value: unknown, disclosure: DisclosureItem[]): ErrandQuestion[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigError("questions must list at least one question.");
  }
  if (value.length > LIMITS.maxQuestions) {
    throw new ConfigError(
      `questions lists ${value.length}. ${LIMITS.maxQuestions} is the cap, because a phone call is not an interview.`,
    );
  }
  const questions = value.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new ConfigError(`questions[${index}] must be an object.`);
    }
    const entry = raw as Record<string, unknown>;
    const id = requireString(entry.id, `questions[${index}].id`, 40);
    if (!ID.test(id)) {
      throw new ConfigError(`questions[${index}].id must be a lowercase slug.`);
    }
    const text = requireString(entry.text, `questions[${index}].text`, LIMITS.questionLength);
    const shape = entry.answer === undefined ? "text" : entry.answer;
    if (shape !== "text" && shape !== "yes_no" && shape !== "datetime") {
      throw new ConfigError(`questions[${index}].answer must be text, yes_no or datetime.`);
    }
    const answer: AnswerShape = shape;
    // A question is spoken out loud, so it goes through the same check as the script.
    const findings = blocking(unauthorizedFindings(text, disclosure, `questions[${index}].text`));
    if (findings.length > 0) {
      throw new ConfigError(
        `questions[${index}].text contains a detail nobody authorized (${findings
          .map((finding) => finding.kind)
          .join(", ")}). Put it in disclosure if the callee may hear it or take it out.`,
      );
    }
    return { id, text, answer };
  });
  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new ConfigError("question ids must be unique.");
  }
  return questions;
}

function validateWindows(value: unknown, commitment: CommitmentMode): AuthorizedWindow[] {
  const windows = value === undefined ? [] : value;
  if (!Array.isArray(windows)) {
    throw new ConfigError("authorized_windows must be an array.");
  }
  if (commitment === "slot_within_windows" && windows.length === 0) {
    throw new ConfigError(
      "goal.commitment is slot_within_windows, so authorized_windows must say which times may be accepted.",
    );
  }
  if (windows.length > LIMITS.maxWindows) {
    throw new ConfigError(`authorized_windows lists ${windows.length}. ${LIMITS.maxWindows} is the cap.`);
  }
  return windows.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new ConfigError(`authorized_windows[${index}] must be an object.`);
    }
    const entry = raw as Record<string, unknown>;
    const from = requireString(entry.from, `authorized_windows[${index}].from`, 40);
    const to = requireString(entry.to, `authorized_windows[${index}].to`, 40);
    for (const [field, text] of [["from", from], ["to", to]] as const) {
      if (!ISO_WITH_OFFSET.test(text)) {
        throw new ConfigError(
          `authorized_windows[${index}].${field} must be ISO 8601 with an offset, for example 2026-08-13T09:00:00-07:00.`,
        );
      }
    }
    if (Date.parse(from) >= Date.parse(to)) {
      throw new ConfigError(`authorized_windows[${index}] must start before it ends.`);
    }
    return { from, to };
  });
}

export function parseRequest(input: unknown): ErrandRequest {
  if (typeof input !== "object" || input === null) {
    throw new ConfigError("The errand file must contain a JSON object.");
  }
  const raw = input as Record<string, unknown>;
  const errandId = requireString(raw.errand_id, "errand_id", 64);
  if (!ERRAND_ID.test(errandId)) {
    throw new ConfigError("errand_id must be 3 to 64 characters of letters, digits, dot, dash or underscore.");
  }

  if (typeof raw.on_behalf_of !== "object" || raw.on_behalf_of === null) {
    throw new ConfigError("on_behalf_of must be an object.");
  }
  const behalf = raw.on_behalf_of as Record<string, unknown>;
  const onBehalfOf = {
    name: requireString(behalf.name, "on_behalf_of.name", 80),
    reason_for_delegation: requireString(behalf.reason_for_delegation, "on_behalf_of.reason_for_delegation", 160),
  };

  if (typeof raw.callee !== "object" || raw.callee === null) {
    throw new ConfigError("callee must be an object.");
  }
  const calleeRaw = raw.callee as Record<string, unknown>;
  const phone = requireString(calleeRaw.phone, "callee.phone", 20);
  if (!E164.test(phone)) {
    throw new ConfigError(`callee.phone must be E.164, for example +14155550122. Received ${phone}.`);
  }
  const callee = {
    name: requireString(calleeRaw.name, "callee.name", 80),
    phone,
    published_source: requireString(calleeRaw.published_source, "callee.published_source"),
    ...(calleeRaw.region === undefined ? {} : { region: requireString(calleeRaw.region, "callee.region", 8) }),
  };

  if (typeof raw.goal !== "object" || raw.goal === null) {
    throw new ConfigError("goal must be an object.");
  }
  const goalRaw = raw.goal as Record<string, unknown>;
  const commitment = goalRaw.commitment === undefined ? "none" : goalRaw.commitment;
  if (!COMMITMENTS.includes(commitment as CommitmentMode)) {
    throw new ConfigError(`goal.commitment must be one of ${COMMITMENTS.join(", ")}.`);
  }
  const goal = {
    summary: requireString(goalRaw.summary, "goal.summary", LIMITS.goalLength),
    commitment: commitment as CommitmentMode,
  };

  const disclosure = validateDisclosure(raw.disclosure);
  const questions = validateQuestions(raw.questions, disclosure);
  const authorizedWindows = validateWindows(raw.authorized_windows, goal.commitment);
  const policy = resolvePolicy(raw.policy as PolicyInput | undefined);

  return { errandId, onBehalfOf, callee, goal, disclosure, questions, authorizedWindows, policy };
}

export function loadRequest(path: string): ErrandRequest {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(`Cannot read errand file ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`Errand file ${path} is not valid JSON: ${(error as Error).message}`);
  }
  return parseRequest(parsed);
}
