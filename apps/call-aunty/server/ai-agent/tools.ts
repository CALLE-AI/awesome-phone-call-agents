import type { AgentToolName, ToolInvocation } from "./types";

export type ToolContext = {
  contactId: string;
  dryRun: boolean;
  approved: boolean;
};

type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => unknown;

type RegisteredTool = {
  name: AgentToolName;
  sensitive: boolean;
  handler: ToolHandler;
};

export class ToolRegistry {
  private readonly tools = new Map<AgentToolName, RegisteredTool>();

  register(name: AgentToolName, sensitive: boolean, handler: ToolHandler): void {
    this.tools.set(name, { name, sensitive, handler });
  }

  isSensitive(name: AgentToolName): boolean {
    return this.tools.get(name)?.sensitive ?? false;
  }

  invoke(name: AgentToolName, args: Record<string, unknown>, ctx: ToolContext): ToolInvocation {
    const tool = this.tools.get(name);
    if (!tool) {
      return { name, args, status: "blocked", result: { error: "unknown-tool" } };
    }
    if (tool.sensitive && !ctx.approved) {
      return { name, args, status: "pending_approval" };
    }
    return { name, args, status: "executed", result: tool.handler(args, ctx) };
  }
}

export function registerSafeBuiltins(registry: ToolRegistry): ToolRegistry {
  registry.register("recall_memory", false, () => ({ memories: [], redacted: true }));
  registry.register("record_survey_answer", false, (args) => ({
    questionId: String(args.questionId ?? "open"),
    stored: true,
  }));
  registry.register("request_callback", false, (args) => ({
    window: String(args.window ?? "afternoon"),
    queued: true,
  }));
  registry.register("draft_call_plan", false, () => ({
    purpose: "follow_up_after_check_in",
    dryRun: true,
  }));
  registry.register("place_outbound_call", true, (_args, ctx) => ({
    status: "queued",
    dryRun: ctx.dryRun,
    provider: "demo",
  }));
  registry.register("escalate_operator", false, () => ({ queued: true, priority: "urgent" }));
  return registry;
}
