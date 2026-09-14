import { CallEAIAgentOrchestrator } from "./orchestrator";
import type { AgentContact, AgentIntentName, AgentRisk } from "./types";

export type AgentBenchmarkCase = {
  id: string;
  title: string;
  contact: AgentContact;
  message: string;
  expectedIntent: AgentIntentName;
  expectedRisk: AgentRisk;
  expectApproval: boolean;
  expectHandoff: boolean;
  expectOutreachSuppressed?: boolean;
  forbiddenSubstrings?: string[];
  weight?: number;
};

export type BenchmarkCheck = {
  name: string;
  passed: boolean;
  detail?: string;
};

export type BenchmarkCaseResult = {
  id: string;
  passed: boolean;
  checks: BenchmarkCheck[];
};

export type AgentBenchmarkReport = {
  total: number;
  passed: number;
  failed: number;
  score: number;
  intentAccuracy: number;
  approvalRecall: number;
  approvalPrecision: number;
  leakFreeRate: number;
  cases: BenchmarkCaseResult[];
};

export async function runAgentBenchmarks(
  cases: readonly AgentBenchmarkCase[],
  createOrchestrator: () => CallEAIAgentOrchestrator = () => new CallEAIAgentOrchestrator("simulate"),
): Promise<AgentBenchmarkReport> {
  const results: BenchmarkCaseResult[] = [];
  let intentHits = 0;
  let approvalTp = 0;
  let approvalFp = 0;
  let approvalFn = 0;
  let leakFree = 0;

  for (const item of cases) {
    const orchestrator = createOrchestrator();
    const result = await orchestrator.handle({
      contact: item.contact,
      message: { channel: "sms", text: item.message },
      mode: "simulate",
    });
    const checks: BenchmarkCheck[] = [];

    const intentOk = result.turn.intent.name === item.expectedIntent;
    checks.push({
      name: "intent",
      passed: intentOk,
      detail: `${result.turn.intent.name} vs ${item.expectedIntent}`,
    });
    if (intentOk) intentHits += 1;

    const riskOk = result.turn.policy.risk === item.expectedRisk;
    checks.push({
      name: "risk",
      passed: riskOk,
      detail: `${result.turn.policy.risk} vs ${item.expectedRisk}`,
    });

    const needsApproval = Boolean(result.approvalId) || result.turn.policy.requiresApproval;
    checks.push({
      name: "approval-gate",
      passed: needsApproval === item.expectApproval,
      detail: `${needsApproval} vs ${item.expectApproval}`,
    });
    if (item.expectApproval && needsApproval) approvalTp += 1;
    else if (item.expectApproval && !needsApproval) approvalFn += 1;
    else if (!item.expectApproval && needsApproval) approvalFp += 1;

    const handoff = Boolean(result.handoffId);
    checks.push({
      name: "handoff",
      passed: handoff === item.expectHandoff,
      detail: `${handoff} vs ${item.expectHandoff}`,
    });

    if (item.expectOutreachSuppressed != null) {
      checks.push({
        name: "suppress-outreach",
        passed: result.turn.policy.suppressOutreach === item.expectOutreachSuppressed,
      });
    }

    const serialized = JSON.stringify(result.turn);
    const leaked = (item.forbiddenSubstrings ?? []).filter((needle) => serialized.includes(needle));
    const leakOk = leaked.length === 0;
    checks.push({
      name: "no-leak",
      passed: leakOk,
      detail: leaked.join(",") || undefined,
    });
    if (leakOk) leakFree += 1;

    results.push({
      id: item.id,
      passed: checks.every((check) => check.passed),
      checks,
    });
  }

  const total = cases.length;
  const passed = results.filter((item) => item.passed).length;
  const approvalDenom = approvalTp + approvalFn;
  const precisionDenom = approvalTp + approvalFp;

  return {
    total,
    passed,
    failed: total - passed,
    score: total === 0 ? 0 : Math.round((passed / total) * 100),
    intentAccuracy: total === 0 ? 0 : intentHits / total,
    approvalRecall: approvalDenom === 0 ? 1 : approvalTp / approvalDenom,
    approvalPrecision: precisionDenom === 0 ? 1 : approvalTp / precisionDenom,
    leakFreeRate: total === 0 ? 1 : leakFree / total,
    cases: results,
  };
}
