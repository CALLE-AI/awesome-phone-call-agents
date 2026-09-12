import { config, type DialConfig } from '@dial/config';
import { GeminiTaskInterpreter, InterpreterUnavailableError, type TaskInterpreter } from './interpreter.js';
import { GeminiQuestionGenerator, type QuestionGenerator } from './questions.js';

export * from './interpreter.js';
export * from './questions.js';
export * from './domains.js';

/**
 * Resolves the interpreter. There is deliberately no rule-based fallback: a
 * hard-coded classifier pretending to be language understanding would be the
 * exact shortcut section 41 forbids. Without a key, task creation fails with a
 * precise, actionable message instead of quietly degrading.
 */
export function resolveInterpreter(cfg: DialConfig = config()): TaskInterpreter {
  if (!cfg.llm.configured) throw new InterpreterUnavailableError();
  return new GeminiTaskInterpreter(cfg.llm.apiKey, cfg.llm.model, cfg.llm.fallbackModels);
}

export function isInterpreterConfigured(cfg: DialConfig = config()): boolean {
  return cfg.llm.configured;
}

/**
 * The intake question generator. Null when no model is configured — intake is
 * an enhancement, and its absence must not stop a task from running.
 */
export function resolveQuestionGenerator(cfg: DialConfig = config()): QuestionGenerator | null {
  if (!cfg.llm.configured) return null;
  return new GeminiQuestionGenerator(cfg.llm.apiKey, cfg.llm.model, cfg.llm.fallbackModels);
}
