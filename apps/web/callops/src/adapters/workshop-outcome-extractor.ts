import type { StructuredOutcome } from '../domain/models';
import { DATE_KINDS, DATE_LABELS, formatDate, interpretWorkshopTranscript } from '../domain/workshop-outcome';
import { WORKSHOP_CONTEXT } from '../fixtures/workshop';
import type { ProviderRunStatus } from '../ports/call-provider';
import type { OutcomeExtractor } from '../ports/outcome-extractor';

export class WorkshopOutcomeExtractor implements OutcomeExtractor {
  public extract(status: ProviderRunStatus): StructuredOutcome {
    if (!['COMPLETED', 'FAILED'].includes(status.state)) throw new Error('A terminal simulation is required.');
    const result = interpretWorkshopTranscript(status.transcript, status.state as 'COMPLETED' | 'FAILED', WORKSHOP_CONTEXT);
    return {
      confirmedFacts: DATE_KINDS.flatMap((kind) => {
        const value = result.dates[kind];
        return value.date === null || value.qualification !== 'CONFIRMED' ? [] : [`${DATE_LABELS[kind]}: ${formatDate(value.date)} (confirmed).`];
      }),
      unconfirmedFacts: DATE_KINDS.filter((kind) => result.dates[kind].qualification !== 'CONFIRMED').map((kind) => {
        const value = result.dates[kind];
        return `${DATE_LABELS[kind]}: ${value.date === null ? '' : `${formatDate(value.date)} `}(${value.qualification.toLowerCase()}).`;
      }),
      commitmentsMade: [], commitmentsRefused: [], announcedDelay: null,
      contactOrService: result.reached ? 'Northstar Parts Demo' : null,
      nextActions: [result.expectation === 'SUPPORTED' ? 'Review the customer update before sharing it.' : 'Clarify the device-return date before making a customer promise.'],
      humanDecisionRequired: result.expectation !== 'SUPPORTED', confidence: result.expectation === 'SUPPORTED' ? 'HIGH' : 'LOW',
      citations: result.evidence.map((item) => `${item.id}: ${item.text}`), securitySignals: result.securitySignals,
    };
  }
}
