import { fingerprintPlan } from './canonical';
import { CallOpsError } from './errors';
import { CALL_RUN_STATES, type CallOpsSnapshot } from './models';
import { assertSyntheticData, sameStringList } from './synthetic-data';

type Rule = (value: unknown) => boolean;
const text: Rule = (v) => typeof v === 'string' && v.length <= 2048;
const timestamp: Rule = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v));
const fingerprint: Rule = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const choice = (...values: readonly unknown[]): Rule => (v) => values.includes(v);
const nullable = (rule: Rule): Rule => (v) => v === null || rule(v);
const array = (rule: Rule): Rule => (v) => Array.isArray(v) && v.length <= 200 && v.every(rule);
const strings = array(text);
const state = choice(...CALL_RUN_STATES);
const confidence = choice('LOW', 'MEDIUM', 'HIGH');
const decision = choice('APPROVED', 'REJECTED');
const object = (fields: Readonly<Record<string, Rule>>): Rule => (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const record = v as Record<string, unknown>;
  return Object.keys(record).length === Object.keys(fields).length
    && Object.entries(fields).every(([key, rule]) => Object.hasOwn(record, key) && rule(record[key]));
};

const snapshotShape = object({
  supportCase: nullable(object({
    id: text, organization: text, syntheticReference: text, category: text, context: text,
    desiredOutcome: text, authorizedInformation: strings, forbiddenInformation: strings,
    createdAt: timestamp, status: state,
  })),
  plan: nullable(object({
    id: text, caseId: text, objectiveSummary: text, proposedScript: strings,
    plannedQuestions: strings, transmittedData: strings, prohibitedBehaviors: strings,
    stopConditions: strings, riskEstimate: confidence, provider: choice('MOCK'), createdAt: timestamp,
  })),
  approval: nullable(object({
    decision, decidedAt: timestamp, planFingerprint: fingerprint,
    confirmedTransmittedData: strings, comment: nullable(text),
  })),
  run: nullable(object({
    id: text, caseId: text, planId: text, scenario: choice('NOMINAL', 'AMBIGUOUS', 'CONFLICTING', 'FAILED'),
    provider: choice('MOCK'), state, providerRunId: nullable(text), transcript: strings,
    retryScheduled: choice(false), createdAt: timestamp, updatedAt: timestamp,
  })),
  outcome: nullable(object({
    confirmedFacts: strings, unconfirmedFacts: strings, commitmentsMade: strings,
    commitmentsRefused: strings, announcedDelay: nullable(text), contactOrService: nullable(text),
    nextActions: strings, humanDecisionRequired: choice(true, false), confidence,
    citations: strings, securitySignals: strings,
  })),
  audit: array(object({
    id: text, event: text, at: timestamp, caseId: text, previousState: nullable(state),
    newState: state, reason: text, planFingerprint: nullable(fingerprint),
    providerType: choice('MOCK'), humanDecision: nullable(decision),
  })),
});

export function invalidLocalSnapshot(): CallOpsError {
  return new CallOpsError('The saved local demo cannot be resumed. Reset the demo to continue.', 'INVALID_LOCAL_SNAPSHOT');
}

/** Validate untrusted browser storage before rendering or promoting a temporary write.
 * This checks local consistency; it does not authenticate evidence or authorize a live action.
 */
export async function validateMockSnapshot(value: unknown): Promise<CallOpsSnapshot> {
  if (!snapshotShape(value)) throw invalidLocalSnapshot();
  const snapshot = value as CallOpsSnapshot;
  const { supportCase, plan, run, approval, outcome, audit } = snapshot;
  const require = (condition: boolean): void => { if (!condition) throw invalidLocalSnapshot(); };

  try {
    assertSyntheticData({
      supportCase, plan, run, outcome,
      approvalComment: approval?.comment ?? null,
      confirmedTransmittedData: approval?.confirmedTransmittedData ?? [],
      audit: audit.map(({ planFingerprint: _fingerprint, ...event }) => { void _fingerprint; return event; }),
    });
  } catch { throw invalidLocalSnapshot(); }
  if (supportCase === null) {
    require(plan === null && run === null && approval === null && outcome === null && audit.length === 0);
    return structuredClone(snapshot);
  }
  require(audit.length > 0 && audit.at(-1)?.newState === supportCase.status);
  for (const [index, event] of audit.entries()) {
    require(event.caseId === supportCase.id && event.id === `audit-${String(index + 1).padStart(3, '0')}`);
    require(event.previousState === (index === 0 ? null : audit[index - 1]?.newState));
  }
  if (plan === null) {
    require(supportCase.status === 'DRAFT' && run === null && approval === null && outcome === null);
    return structuredClone(snapshot);
  }
  if (run === null) throw invalidLocalSnapshot();
  require(plan.caseId === supportCase.id && run.caseId === supportCase.id && run.planId === plan.id);
  require(run.id === `run-${plan.id}` && run.state === supportCase.status);
  require(!['DRAFT', 'CANCELLED'].includes(run.state));
  const started = ['QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED'].includes(run.state);
  require(run.providerRunId === (started ? `mock-run-${plan.id}` : null));
  require(started || run.transcript.length === 0);
  const terminal = run.state === 'COMPLETED' || run.state === 'FAILED';
  require(terminal ? outcome !== null && outcome.commitmentsMade.length === 0 : outcome === null);
  if (run.state === 'WAITING_FOR_APPROVAL') {
    require(approval === null);
  } else {
    if (approval === null) throw invalidLocalSnapshot();
    require(approval.decision === (run.state === 'REJECTED' ? 'REJECTED' : 'APPROVED'));
    require(approval.planFingerprint === await fingerprintPlan(plan));
    require(sameStringList(approval.confirmedTransmittedData, approval.decision === 'APPROVED' ? plan.transmittedData : []));
  }
  return structuredClone(snapshot);
}
