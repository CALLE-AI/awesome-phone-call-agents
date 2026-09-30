import { CallEAIAgentOrchestrator } from "./orchestrator";
import type {
  AgentChannel,
  AgentContact,
  AgentIntentName,
  AgentToolName,
  AgentTurn,
  AgentTurnState,
  ApprovalStatus,
} from "./types";

export type AgentReplayApproval = {
  operatorId: string;
  decision: "approve" | "deny";
  notes?: string;
};

export type AgentReplayStep = {
  id: string;
  text: string;
  channel?: AgentChannel;
  approvals?: AgentReplayApproval[];
};

export type AgentReplayFixture = {
  id: string;
  title: string;
  purpose: string;
  synthetic: true;
  contact: AgentContact;
  steps: readonly AgentReplayStep[];
  expected: {
    terminalState: AgentTurnState;
    intents: AgentIntentName[];
    approvalStatuses?: ApprovalStatus[];
    handoff: boolean;
    outreachSuppressed?: boolean;
    forbiddenSubstrings?: string[];
    executedTools?: AgentToolName[];
    blockedTools?: AgentToolName[];
  };
};

export type AgentReplayTrace = {
  fixtureId: string;
  turns: AgentTurn[];
  approvalStatuses: ApprovalStatus[];
  events: string[];
};

export async function replayAgentEndToEnd(
  fixture: AgentReplayFixture,
  orchestrator = new CallEAIAgentOrchestrator("replay"),
): Promise<AgentReplayTrace> {
  orchestrator.clearHistory();
  const events: string[] = [];

  for (const step of fixture.steps) {
    const result = await orchestrator.handle({
      contact: fixture.contact,
      message: { channel: step.channel ?? "sms", text: step.text },
      mode: "replay",
    });
    events.push(`${step.id}:state=${result.turn.state}:intent=${result.turn.intent.name}`);
    if (result.handoffId) events.push(`${step.id}:handoff=${result.handoffId}`);
    if (result.approvalId) events.push(`${step.id}:approval=${result.approvalId}`);

    for (const approval of step.approvals ?? []) {
      const ticketId = result.approvalId ?? orchestrator.approvals.pending()[0]?.id;
      if (!ticketId) {
        events.push(`${step.id}:approval-missing`);
        continue;
      }
      const decided = await orchestrator.decideApproval(
        ticketId,
        approval.operatorId,
        approval.decision,
        approval.notes,
      );
      events.push(
        `${step.id}:decision=${approval.decision}:${approval.operatorId}:state=${decided.turn.state}`,
      );
    }
  }

  return {
    fixtureId: fixture.id,
    turns: orchestrator.history(),
    approvalStatuses: orchestrator.approvals.list().map((ticket) => ticket.status),
    events,
  };
}

export function assertAgentReplayInvariants(
  fixture: AgentReplayFixture,
  trace: AgentReplayTrace,
): string[] {
  const failures: string[] = [];
  const last = trace.turns[trace.turns.length - 1];
  if (!last) {
    failures.push("replay produced no turns");
    return failures;
  }

  if (last.state !== fixture.expected.terminalState) {
    failures.push(`terminal state ${last.state} != ${fixture.expected.terminalState}`);
  }

  const intents = trace.turns.map((turn) => turn.intent.name);
  if (intents.join(",") !== fixture.expected.intents.join(",")) {
    failures.push(`intents ${intents.join(",")} != ${fixture.expected.intents.join(",")}`);
  }

  const handoff = trace.turns.some((turn) => Boolean(turn.handoffId));
  if (handoff !== fixture.expected.handoff) {
    failures.push(`handoff ${handoff} != ${fixture.expected.handoff}`);
  }

  if (fixture.expected.approvalStatuses) {
    const statuses = trace.approvalStatuses.join(",");
    const expected = fixture.expected.approvalStatuses.join(",");
    if (statuses !== expected) failures.push(`approval statuses ${statuses} != ${expected}`);
  }

  if (fixture.expected.outreachSuppressed != null) {
    const suppressed = last.policy.suppressOutreach;
    if (suppressed !== fixture.expected.outreachSuppressed) {
      failures.push(`suppressOutreach ${suppressed} != ${fixture.expected.outreachSuppressed}`);
    }
  }

  const executed = new Set(
    trace.turns.flatMap((turn) =>
      turn.tools.filter((tool) => tool.status === "executed").map((tool) => tool.name),
    ),
  );
  for (const name of fixture.expected.executedTools ?? []) {
    if (!executed.has(name)) failures.push(`missing executed tool ${name}`);
  }
  for (const name of fixture.expected.blockedTools ?? []) {
    if (executed.has(name)) failures.push(`tool ${name} executed`);
  }

  const serialized = JSON.stringify(trace);
  for (const needle of fixture.expected.forbiddenSubstrings ?? []) {
    if (serialized.includes(needle)) failures.push(`durable replay leaked ${needle}`);
  }
  if (/Bearer /i.test(serialized)) failures.push("event log contains a bearer token");

  return failures;
}
