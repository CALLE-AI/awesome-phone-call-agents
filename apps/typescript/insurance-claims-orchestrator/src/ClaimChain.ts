// src/ClaimChain.ts
// Core reusable orchestrator class — domain-agnostic, under 150 lines.
// Copy this for any multi-call workflow that needs call-to-call state passing.

export type CallOutcome =
  | "completed"
  | "voicemail"
  | "no_answer"
  | "refused"
  | "unclear";

export interface CallStep {
  id: string;
  dependsOn?: string;
  taskText: (ctx: ChainContext) => string;
  resultSchema: object;
  retryOnOutcome?: CallOutcome[];
  maxRetries: number;
}

export interface ChainContext {
  phone: string;
  results: Record<string, object>;
}

export interface ChainResult {
  completed: boolean;
  steps: Record<
    string,
    {
      callId: string;
      outcome: CallOutcome;
      structured_result: object | null;
      attempts: number;
    }
  >;
  humanReviewRequired: boolean;
  humanReviewReason?: string;
}

export class ClaimChain {
  private steps: CallStep[] = [];

  addStep(step: CallStep): this {
    this.steps.push(step);
    return this;
  }

  async execute(
    phone: string,
    caller: (
      phone: string,
      task: string,
      schema: object
    ) => Promise<{
      callId: string;
      outcome: CallOutcome;
      structured_result: object | null;
    }>,
    dryRun = true
  ): Promise<ChainResult> {
    const ctx: ChainContext = { phone, results: {} };
    const stepResults: ChainResult["steps"] = {};

    for (const step of this.steps) {
      if (step.dependsOn) {
        const dep = stepResults[step.dependsOn];
        if (!dep || dep.outcome !== "completed") {
          return {
            completed: false,
            steps: stepResults,
            humanReviewRequired: true,
            humanReviewReason: `Step "${step.dependsOn}" did not complete — blocked "${step.id}"`,
          };
        }
      }

      const task = step.taskText(ctx);
      let attempts = 0;
      let lastResult = {
        callId: "",
        outcome: "unclear" as CallOutcome,
        structured_result: null as object | null,
      };

      do {
        attempts++;

        if (dryRun) {
          const masked = phone.slice(0, 4) + "*".repeat(Math.max(0, phone.length - 4));
          console.log(`[DRY-RUN] Step: ${step.id} | Phone: ${masked}`);
          console.log(`[DRY-RUN] Task preview:\n${task.slice(0, 200)}...`);
          lastResult = {
            callId: `dry-run-${step.id}-${attempts}`,
            outcome: "completed",
            structured_result: null,
          };
          break;
        }

        lastResult = await caller(phone, task, step.resultSchema);

        if (!step.retryOnOutcome?.includes(lastResult.outcome)) break;
      } while (attempts < step.maxRetries);

      stepResults[step.id] = {
        callId: lastResult.callId,
        outcome: lastResult.outcome,
        structured_result: lastResult.structured_result,
        attempts,
      };

      if (lastResult.outcome === "completed" && lastResult.structured_result) {
        ctx.results[step.id] = lastResult.structured_result;
      }
    }

    const allCompleted = this.steps.every(
      (s) => stepResults[s.id]?.outcome === "completed"
    );

    return {
      completed: allCompleted,
      steps: stepResults,
      humanReviewRequired: !allCompleted,
      humanReviewReason: allCompleted
        ? undefined
        : "One or more steps did not reach completed status",
    };
  }
}
