import { HumanApprovalGate } from "./approval";
import { createIdFactory, createSequenceClock } from "./ids";
import { CallEAgent } from "./runtime";
import { minimizeText, responseFitsChannel } from "./sanitize";
import { registerSafeBuiltins, ToolRegistry } from "./tools";
import type {
  AgentClock,
  AgentHandleResult,
  AgentIdFactory,
  AgentMode,
  AgentRequest,
  AgentTurn,
} from "./types";

export type OrchestratorOptions = {
  mode?: AgentMode;
  tools?: ToolRegistry;
  ids?: AgentIdFactory;
  clock?: AgentClock;
};

export class CallEAIAgentOrchestrator {
  readonly tools: ToolRegistry;
  readonly agent: CallEAgent;
  readonly approvals: HumanApprovalGate;
  private readonly ids: AgentIdFactory;
  private readonly clock: AgentClock;
  private readonly turns: AgentTurn[] = [];
  private readonly pending = new Map<string, AgentRequest>();

  constructor(mode: AgentMode | OrchestratorOptions = "assist", tools?: ToolRegistry) {
    const options: OrchestratorOptions =
      typeof mode === "string" ? { mode, tools } : mode;
    this.ids = options.ids ?? createIdFactory();
    this.clock = options.clock ?? createSequenceClock();
    this.tools = options.tools ?? registerSafeBuiltins(new ToolRegistry());
    this.agent = new CallEAgent({
      agentId: this.ids.next("call-e-ai"),
      mode: options.mode ?? "assist",
      tools: this.tools,
    });
    this.approvals = new HumanApprovalGate(this.ids, this.clock);
  }

  async handle(request: AgentRequest): Promise<AgentHandleResult> {
    if (request.mode) this.agent.setMode(request.mode);
    const turnId = this.ids.next("turn");
    const turn = this.agent.handle(request.message, request.contact, turnId, this.clock.nowIso());
    const explanations = explain(turn);

    if (turn.policy.escalate) {
      turn.handoffId = this.ids.next("handoff");
      explanations.push("operator-handoff-queued");
    }

    if (
      turn.policy.requiresApproval &&
      turn.policy.approvalAction &&
      turn.state !== "blocked" &&
      turn.state !== "refused"
    ) {
      const ticket = this.approvals.request({
        turnId: turn.id,
        contactId: request.contact.id,
        action: turn.policy.approvalAction,
        risk: turn.policy.risk,
        reasons: turn.policy.reasons,
        requiredApprovals: turn.policy.requiredApprovals,
        summary: turn.response.text,
      });
      turn.approvalId = ticket.id;
      this.pending.set(ticket.id, structuredClone(request));
      explanations.push(`approval-gate:${ticket.action}:${ticket.requiredApprovals}`);
    }

    this.turns.push(structuredClone(turn));
    return {
      turn,
      auditId: this.ids.next("audit"),
      explanations,
      handoffId: turn.handoffId,
      approvalId: turn.approvalId,
    };
  }

  async decideApproval(
    ticketId: string,
    operatorId: string,
    decision: "approve" | "deny",
    notes?: string,
  ): Promise<AgentHandleResult> {
    const ticket = this.approvals.decide(ticketId, operatorId, decision, notes);
    const pending = this.pending.get(ticketId);
    if (!pending) {
      throw new Error(`No pending agent request for ${ticketId}`);
    }

    if (ticket.status === "denied" || ticket.status === "expired") {
      const blocked = this.replaceTurn(ticket.turnId, (turn) => {
        turn.state = "blocked";
        turn.tools = turn.tools.map((tool) =>
          tool.status === "pending_approval"
            ? { ...tool, status: "blocked" as const, result: { reason: ticket.status } }
            : tool,
        );
        turn.response = {
          ...turn.response,
          text: "An operator declined this action. No call or extra survey questions will run.",
        };
        return turn;
      });
      return {
        turn: blocked,
        auditId: this.ids.next("audit"),
        explanations: [`approval-${ticket.status}`],
        approvalId: ticket.id,
        handoffId: blocked.handoffId,
      };
    }

    if (ticket.status !== "approved") {
      const current = this.turns.find((turn) => turn.id === ticket.turnId);
      if (!current) throw new Error(`Missing turn ${ticket.turnId}`);
      return {
        turn: structuredClone(current),
        auditId: this.ids.next("audit"),
        explanations: [`approval-pending:${ticket.decisions.length}/${ticket.requiredApprovals}`],
        approvalId: ticket.id,
        handoffId: current.handoffId,
      };
    }

    this.pending.delete(ticketId);
    const resumed = this.agent.handle(
      pending.message,
      pending.contact,
      ticket.turnId,
      this.clock.nowIso(),
      true,
    );
    resumed.approvalId = ticket.id;
    const prior = this.turns.find((turn) => turn.id === ticket.turnId);
    if (prior?.handoffId) resumed.handoffId = prior.handoffId;
    if (resumed.policy.escalate && !resumed.handoffId) {
      resumed.handoffId = this.ids.next("handoff");
    }
    this.replaceTurn(ticket.turnId, () => resumed);
    return {
      turn: resumed,
      auditId: this.ids.next("audit"),
      explanations: ["approval-granted", ...explain(resumed)],
      approvalId: ticket.id,
      handoffId: resumed.handoffId,
    };
  }

  stats() {
    return {
      turns: this.turns.length,
      escalated: this.turns.filter((turn) => turn.state === "escalated").length,
      awaitingApproval: this.turns.filter((turn) => turn.state === "awaiting_approval").length,
      blocked: this.turns.filter((turn) => turn.state === "blocked").length,
      refused: this.turns.filter((turn) => turn.state === "refused").length,
      pendingApprovals: this.approvals.pending().length,
    };
  }

  history(): AgentTurn[] {
    return this.turns.map((turn) => structuredClone(turn));
  }

  clearHistory(): void {
    this.turns.length = 0;
    this.pending.clear();
  }

  responseText(turn: AgentTurn): string {
    return turn.response
      ? responseFitsChannel(turn.response.text, turn.response.channel === "sms" ? "sms" : "call")
      : "";
  }

  nextRepair(text: string): string {
    if (/didn'?t (hear|catch)|repeat/i.test(text)) return "I can repeat that more slowly.";
    if (/slow down|too fast/i.test(text)) return "I will speak in shorter sentences.";
    if (/\?\s*$/.test(text) && text.trim().split(/\s+/).length < 5) {
      return "Could you say a little more so I can help with the right next step?";
    }
    return "I can help with a check-in, a callback, or an operator-approved call.";
  }

  private replaceTurn(turnId: string, update: (turn: AgentTurn) => AgentTurn): AgentTurn {
    const index = this.turns.findIndex((turn) => turn.id === turnId);
    if (index < 0) throw new Error(`Unknown turn ${turnId}`);
    const next = update(structuredClone(this.turns[index]));
    this.turns[index] = structuredClone(next);
    return structuredClone(next);
  }
}

function explain(turn: AgentTurn): string[] {
  const lines = [
    `intent:${turn.intent.name}:${turn.intent.confidence}`,
    `risk:${turn.policy.risk}`,
    `state:${turn.state}`,
    ...turn.policy.reasons.map((reason) => `policy:${reason}`),
  ];
  if (minimizeText(turn.input.text) !== turn.input.text) {
    lines.push("durable-text-minimized");
  }
  return lines;
}

