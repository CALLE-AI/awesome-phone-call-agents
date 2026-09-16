import { ApprovalGateError, SyntheticDataError } from './errors';
import type { SyntheticDataIssue } from './errors';
import type { CallPlan, SupportCase } from './models';

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+[1-9][0-9 .()-]{7,18}[0-9])|(?:\b0[1-9](?:[ .-]?\d{2}){4}\b)/;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;
const PREFIXED_SECRET_PATTERN = /\b(?:sk|pk|api|token|secret|password)[-_][A-Z0-9_-]{12,}\b/i;
const LONG_SECRET_PATTERN = /(?:\b[A-F0-9]{32,}\b)|(?:\b[A-Z0-9+/]{40,}={0,2}\b)/i;
const REAL_DATA_PATTERN = /\[(?:REAL|PRODUCTION)\]|\b(?:REAL CUSTOMER|REAL DATA|PRODUCTION DATA|LIVE CUSTOMER|DONN(?:É|E)E R(?:É|E)ELLE)\b/i;

function inspectString(path: string, value: string): SyntheticDataIssue[] {
  const issues: SyntheticDataIssue[] = [];
  if (EMAIL_PATTERN.test(value)) issues.push({ path, kind: 'EMAIL' });
  if (PHONE_PATTERN.test(value)) issues.push({ path, kind: 'PHONE' });
  if (URL_PATTERN.test(value)) issues.push({ path, kind: 'URL' });
  if (PREFIXED_SECRET_PATTERN.test(value) || LONG_SECRET_PATTERN.test(value)) {
    issues.push({ path, kind: 'SECRET_LIKE' });
  }
  if (REAL_DATA_PATTERN.test(value)) issues.push({ path, kind: 'REAL_DATA_MARKER' });
  return issues;
}

function inspectUnknown(value: unknown, path: string): SyntheticDataIssue[] {
  if (typeof value === 'string') return inspectString(path, value);
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => inspectUnknown(item, `${path}[${String(index)}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => inspectUnknown(item, `${path}.${key}`));
  }
  return [];
}

export function findSyntheticDataIssues(value: unknown): readonly SyntheticDataIssue[] {
  return inspectUnknown(value, '$');
}

export function assertSyntheticData(value: unknown): void {
  const issues = findSyntheticDataIssues(value);
  if (issues.length > 0) throw new SyntheticDataError(issues);
}

export function assertPlanTransmitsNoForbiddenData(
  plan: CallPlan,
  supportCase: SupportCase,
): void {
  const transmitted = plan.transmittedData.map((item) => item.toLocaleLowerCase());
  const collision = supportCase.forbiddenInformation.some((forbidden) => {
    const normalized = forbidden.toLocaleLowerCase().trim();
    return normalized.length > 0 && transmitted.some((item) => item.includes(normalized));
  });
  if (collision) {
    throw new ApprovalGateError(
      'The plan contains information explicitly forbidden by the support case.',
      'FORBIDDEN_DATA_PRESENT',
    );
  }
  assertSyntheticData(plan.transmittedData);
}

export function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
