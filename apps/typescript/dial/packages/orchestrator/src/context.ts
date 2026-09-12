import type { Db } from '@dial/database';
import type { DialConfig } from '@dial/config';
import type { CallProvider } from '@dial/calle';
import type { TaskInterpreter, QuestionGenerator } from '@dial/ai';
import type { DiscoveryService } from '@dial/search';
import type { TaskState } from '@dial/schemas';

/**
 * Everything the pipeline needs, injected rather than imported.
 *
 * This is what makes the orchestration testable without a network: a test
 * supplies a fake provider and a stub interpreter, while production supplies the
 * real CALL-E client and the real model. Neither knows about the other.
 */
export interface OrchestratorContext {
  db: Db;
  config: DialConfig;
  provider: CallProvider;
  discovery: DiscoveryService;
  /** Null when LLM_API_KEY is absent; task creation then fails loudly. */
  interpreter: TaskInterpreter | null;
  /**
   * Generates the intake questions. Null disables the step entirely — unlike
   * the interpreter, its absence is not fatal.
   */
  questionGenerator?: QuestionGenerator | null;
  /** Pushes a state change to connected web/mobile clients. */
  publish: (taskId: string, event: RealtimeEvent) => void;
}

export interface RealtimeEvent {
  type: 'state' | 'event' | 'call' | 'result';
  taskId: string;
  state?: TaskState;
  message?: string;
  at: string;
}
