import { describe, expect, it } from "vitest";

import {
  AGENT_BENCHMARKS,
  AGENT_REPLAY_FIXTURES,
  CallEAIAgentOrchestrator,
  assertAgentReplayInvariants,
  getAgentReplayFixture,
  replayAgentEndToEnd,
  runAgentBenchmarks,
} from "../server/ai-agent";

describe("Call-E AI-agent end-to-end replay", () => {
  it("replays every fixture deterministically", async () => {
    for (const fixture of AGENT_REPLAY_FIXTURES) {
      const first = await replayAgentEndToEnd(fixture);
      const second = await replayAgentEndToEnd(fixture);
      expect(assertAgentReplayInvariants(fixture, first), fixture.id).toEqual([]);
      expect(first.turns.map((turn) => turn.state)).toEqual(second.turns.map((turn) => turn.state));
      expect(first.turns.map((turn) => turn.intent.name)).toEqual(
        second.turns.map((turn) => turn.intent.name),
      );
      expect(JSON.stringify(first.turns).includes("Bearer ")).toBe(false);
    }
  });

  it("places an outbound call only after human approval", async () => {
    const before = await replayAgentEndToEnd(getAgentReplayFixture("replay-agent-place-call"));
    const call = before.turns[0]?.tools.find((tool) => tool.name === "place_outbound_call");
    expect(call?.status).toBe("executed");
    expect(before.approvalStatuses).toEqual(["approved"]);
  });

  it("keeps place_outbound_call unexecuted when approval is denied", async () => {
    const trace = await replayAgentEndToEnd(getAgentReplayFixture("replay-agent-place-call-denied"));
    expect(trace.turns[0]?.state).toBe("blocked");
    expect(
      trace.turns[0]?.tools.find((tool) => tool.name === "place_outbound_call")?.status,
    ).not.toBe("executed");
  });

  it("requires two distinct operators for urgent dual-control", async () => {
    const orchestrator = new CallEAIAgentOrchestrator("assist");
    const first = await orchestrator.handle({
      contact: getAgentReplayFixture("replay-agent-dual-control").contact,
      message: { channel: "sms", text: "Please call her now." },
    });
    expect(first.turn.state).toBe("awaiting_approval");
    expect(first.approvalId).toBeTruthy();
    const ticket = orchestrator.approvals.get(first.approvalId ?? "");
    expect(ticket?.requiredApprovals).toBe(2);

    const halfway = await orchestrator.decideApproval(first.approvalId ?? "", "op-demo-1", "approve");
    expect(halfway.turn.state).toBe("awaiting_approval");
    expect(
      halfway.turn.tools.find((tool) => tool.name === "place_outbound_call")?.status,
    ).toBe("pending_approval");

    const done = await orchestrator.decideApproval(first.approvalId ?? "", "op-demo-2", "approve");
    expect(done.turn.state).toBe("completed");
    expect(done.turn.tools.find((tool) => tool.name === "place_outbound_call")?.status).toBe(
      "executed",
    );
  });

  it("escalates distress without waiting for approval to hand off", async () => {
    const trace = await replayAgentEndToEnd(getAgentReplayFixture("replay-agent-distress"));
    expect(trace.turns[0]?.state).toBe("escalated");
    expect(trace.turns[0]?.handoffId).toBeTruthy();
    expect(trace.approvalStatuses).toEqual(["pending"]);
    expect(JSON.stringify(trace.turns)).not.toContain("chest pain");
  });
});

describe("Call-E AI-agent evaluation benchmarks", () => {
  it("passes the gold benchmark suite", async () => {
    const report = await runAgentBenchmarks(AGENT_BENCHMARKS);
    const failed = report.cases.filter((item) => !item.passed).map((item) => item.id);
    expect(failed, JSON.stringify(report.cases.filter((item) => !item.passed), null, 2)).toEqual([]);
    expect(report.score).toBe(100);
    expect(report.intentAccuracy).toBe(1);
    expect(report.approvalRecall).toBe(1);
    expect(report.approvalPrecision).toBe(1);
    expect(report.leakFreeRate).toBe(1);
  });
});

describe("Call-E AI-agent human approval gates", () => {
  const contact = {
    id: "contact-agent-pat",
    displayName: "Aunty Pat",
    locale: "en",
    consentGranted: true,
    dnc: false,
    triageState: "contact_chw_today" as const,
  };

  it("does not execute a sensitive tool before approval", async () => {
    const agent = new CallEAIAgentOrchestrator("assist");
    const result = await agent.handle({
      contact,
      message: { channel: "sms", text: "Please place a call to follow up." },
    });
    expect(result.turn.state).toBe("awaiting_approval");
    expect(result.approvalId).toBeTruthy();
    expect(
      result.turn.tools.find((tool) => tool.name === "place_outbound_call")?.status,
    ).toBe("pending_approval");
    expect(agent.approvals.pending()).toHaveLength(1);
  });

  it("rejects a second approval from the same operator", async () => {
    const agent = new CallEAIAgentOrchestrator("assist");
    const result = await agent.handle({
      contact: { ...contact, triageState: "urgent_in_person_care" },
      message: { channel: "sms", text: "Please call her now." },
    });
    await agent.decideApproval(result.approvalId ?? "", "op-demo-1", "approve");
    await expect(agent.decideApproval(result.approvalId ?? "", "op-demo-1", "approve")).rejects.toThrow(
      /already approved/i,
    );
  });

  it("expires stale gates and will not resume them", async () => {
    const agent = new CallEAIAgentOrchestrator("assist");
    const result = await agent.handle({
      contact,
      message: { channel: "sms", text: "Please place a call to follow up." },
    });
    expect(agent.approvals.expireDue("2026-09-14T14:00:00.000Z")).toBe(1);
    expect(agent.approvals.get(result.approvalId ?? "")?.status).toBe("expired");
    await expect(
      agent.decideApproval(result.approvalId ?? "", "op-demo-1", "approve"),
    ).rejects.toThrow(/expired/i);
  });
});
