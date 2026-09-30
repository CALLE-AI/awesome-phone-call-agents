import type { CallPlan, StructuredOutcome } from '../domain/models';
import type { OutcomeExtractor } from '../ports/outcome-extractor';
import type { ProviderRunStatus } from '../ports/call-provider';

const INDIRECT_INJECTION_PATTERN =
  /(?:ignore|disregard).{0,80}(?:instruction).{0,80}(?:disclose|reveal)/i;

function shortCitation(value: string): string {
  return value.length <= 160 ? value : `${value.slice(0, 157)}...`;
}

export class RuleBasedOutcomeExtractor implements OutcomeExtractor {
  public extract(status: ProviderRunStatus, plan: CallPlan): StructuredOutcome {
    const suspiciousLines = status.transcript.filter((line) =>
      INDIRECT_INJECTION_PATTERN.test(line),
    );
    const securitySignals = suspiciousLines.map(
      () => 'Indirect prompt-injection language retained as untrusted transcript data.',
    );

    if (status.scenario === 'NOMINAL') {
      return {
        confirmedFacts: [
          'The synthetic replacement was validated.',
          'Mock shipment is expected within 3 to 5 business days.',
        ],
        unconfirmedFacts: [],
        commitmentsMade: [],
        commitmentsRefused: [
          'No payment was authorized.',
          'No contractual or reservation change was accepted.',
        ],
        announcedDelay: '3 to 5 business days',
        contactOrService: 'Northstar Repairs Demo service',
        nextActions: ['Wait for the synthetic shipping-status update.'],
        humanDecisionRequired: false,
        confidence: 'HIGH',
        citations: status.transcript.slice(1, 3).map(shortCitation),
        securitySignals,
      };
    }

    if (status.scenario === 'AMBIGUOUS') {
      return {
        confirmedFacts: ['The synthetic case reference was recognized.'],
        unconfirmedFacts: ['No firm replacement or shipping delay was confirmed.'],
        commitmentsMade: [],
        commitmentsRefused: [
          'The transcript could not alter the approved plan or disclose additional data.',
        ],
        announcedDelay: null,
        contactOrService: 'Replacement desk, not yet reached',
        nextActions: [
          `Ask a human to decide whether to follow up under the approved objective: ${plan.objectiveSummary}`,
        ],
        humanDecisionRequired: true,
        confidence: 'MEDIUM',
        citations: status.transcript.slice(1, 3).map(shortCitation),
        securitySignals,
      };
    }

    return {
      confirmedFacts: ['The mock organization was unreachable.'],
      unconfirmedFacts: ['No support-case status or delay was obtained.'],
      commitmentsMade: [],
      commitmentsRefused: ['No automatic retry was scheduled.'],
      announcedDelay: null,
      contactOrService: null,
      nextActions: ['A human may decide whether a later mock attempt is useful.'],
      humanDecisionRequired: true,
      confidence: 'LOW',
      citations: status.transcript.map(shortCitation),
      securitySignals,
    };
  }
}
